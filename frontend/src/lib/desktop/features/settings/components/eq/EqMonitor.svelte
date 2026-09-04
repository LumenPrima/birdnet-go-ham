<!--
  EqMonitor - live listening for the equalizer console.

  Plays one audio source through the browser: either the raw stream with the proposed bands
  applied in Web Audio (instant), or the station's normal stream to confirm what the analysis
  hears after applying. Owns the HLS lifecycle, the analyser graph, RMS/peak meters and the
  waterfall; publishes pre and post spectra for the curve overlay through onSpectra.

  @component
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { Play, Square, Volume2, VolumeX } from '@lucide/svelte';
  import { t } from '$lib/i18n';
  import { hasLiveAudioAccess } from '$lib/stores/appState.svelte';
  import { fetchWithCSRF } from '$lib/utils/api';
  import { loggers } from '$lib/utils/logger';
  import { useHlsStream } from '$lib/utils/useHlsStream.svelte';
  import { useSpectrogramAnalyser } from '$lib/utils/useSpectrogramAnalyser.svelte';
  import type { AnalyserInsert } from '$lib/utils/useSpectrogramAnalyser.svelte';
  import {
    levelFromTimeDomain,
    logBinCenters,
    peakHold,
    spectrumToLogBins,
  } from '$lib/utils/eqAnalysis';
  import SpectrogramCanvas from '$lib/desktop/components/media/SpectrogramCanvas.svelte';

  interface SourceOption {
    id: string;
    name: string;
    type: string;
  }

  interface Props {
    /** Config display name of the source this panel belongs to; when set the picker is pinned to it */
    sourceName?: string;
    /** Insert built by the EQ mirror; applied only on the raw stream */
    insert: AnalyserInsert;
    /** Number of log bins for the published spectra (must match EqCurve) */
    spectrumBins?: number;
    disabled?: boolean;
    onSpectra?: (_pre: Float32Array | null, _post: Float32Array | null) => void;
    onModeChange?: (_mode: 'raw' | 'station') => void;
  }

  let {
    sourceName,
    insert,
    spectrumBins = 200,
    disabled = false,
    onSpectra,
    onModeChange,
  }: Props = $props();

  const logger = loggers.audio;
  const FFT_SIZE = 2048;
  const METER_MIN_DB = -60;
  const PEAK_DECAY_DB = 0.6;
  const SPECTRUM_INTERVAL_MS = 50;

  let sources = $state<SourceOption[]>([]);
  let selectedId = $state('');
  let mode = $state<'raw' | 'station'>('raw');
  let rmsDb = $state(METER_MIN_DB);
  let peakDb = $state(METER_MIN_DB);
  let clipping = $state(false);
  let showWaterfall = $state(true);

  const stream = useHlsStream();
  // Two analyser graphs: the raw stream carries the mirror insert, the station stream none.
  // The insert is wired once when the graph is built; the mirror updates its own nodes later.
  // svelte-ignore state_referenced_locally
  const rawSpectro = useSpectrogramAnalyser({
    fftSize: FFT_SIZE,
    audioOutput: true,
    insert,
    preAnalyser: true,
  });
  const stationSpectro = useSpectrogramAnalyser({ fftSize: FFT_SIZE, audioOutput: true });
  const spectro = $derived(mode === 'raw' ? rawSpectro : stationSpectro);

  const access = $derived(hasLiveAudioAccess());
  const pinned = $derived(sourceName !== undefined);
  const live = $derived(stream.state === 'live');
  const connecting = $derived(stream.state === 'connecting');
  const startReason = $derived.by(() => {
    if (!access) return t('settings.audio.audioFilters.console.monitor.noAccess');
    if (disabled) return t('settings.audio.audioFilters.console.monitor.disabled');
    if (sources.length === 0) return t('settings.audio.audioFilters.console.monitor.noSources');
    if (!selectedId) return t('settings.audio.audioFilters.console.monitor.pickSource');
    return '';
  });

  // The bin count is fixed for the life of the monitor (it must match the curve).
  // svelte-ignore state_referenced_locally
  let heldPre: Float32Array = new Float32Array(spectrumBins).fill(-100);
  // svelte-ignore state_referenced_locally
  let heldPost: Float32Array = new Float32Array(spectrumBins).fill(-100);
  // svelte-ignore state_referenced_locally
  const centers = logBinCenters(spectrumBins);
  let timeDomain = new Uint8Array(FFT_SIZE);
  let ticker: ReturnType<typeof globalThis.setInterval> | null = null;

  async function loadSources() {
    try {
      const data = await fetchWithCSRF<{ sources: SourceOption[] }>('/api/v2/streams/sources');
      sources = data.sources;
      if (pinned) {
        selectedId = sources.find(s => s.name === sourceName)?.id ?? '';
      } else if (!selectedId && sources.length > 0) {
        selectedId = sources[0].id;
      }
    } catch (error) {
      logger.warn('EqMonitor: could not list audio sources', error);
      sources = [];
    }
  }

  async function start() {
    if (startReason) return;
    try {
      const element = await stream.start({ sourceId: selectedId, raw: mode === 'raw' });
      await spectro.connect(element);
      startTicker();
    } catch (error) {
      logger.error('EqMonitor: failed to start monitor', error);
      stop();
    }
  }

  function stop() {
    stopTicker();
    rawSpectro.disconnect();
    stationSpectro.disconnect();
    stream.stop();
    rmsDb = METER_MIN_DB;
    peakDb = METER_MIN_DB;
    clipping = false;
    onSpectra?.(null, null);
  }

  async function switchMode(next: 'raw' | 'station') {
    if (next === mode) return;
    const wasLive = live;
    stop();
    mode = next;
    onModeChange?.(next);
    if (wasLive) await start();
  }

  function tick() {
    const analyser = spectro.analyser;
    if (!analyser) return;
    if (timeDomain.length !== analyser.fftSize) timeDomain = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(timeDomain);
    const level = levelFromTimeDomain(timeDomain);
    rmsDb = Math.max(METER_MIN_DB, level.rmsDb);
    peakDb = Math.max(METER_MIN_DB, level.peakDb);
    clipping = level.peakDb > -0.5;

    analyser.getByteFrequencyData(spectro.frequencyData);
    const post = spectrumToLogBins(
      spectro.frequencyData,
      spectro.sampleRate,
      spectro.fftSize,
      centers
    );
    heldPost = peakHold(post, heldPost, PEAK_DECAY_DB);
    let pre: Float32Array | null = null;
    if (mode === 'raw' && rawSpectro.preAnalyser) {
      rawSpectro.preAnalyser.getByteFrequencyData(rawSpectro.preFrequencyData);
      const p = spectrumToLogBins(
        rawSpectro.preFrequencyData,
        spectro.sampleRate,
        spectro.fftSize,
        centers
      );
      heldPre = peakHold(p, heldPre, PEAK_DECAY_DB);
      pre = heldPre;
    }
    onSpectra?.(pre, heldPost);
  }

  function startTicker() {
    stopTicker();
    ticker = globalThis.setInterval(tick, SPECTRUM_INTERVAL_MS);
  }
  function stopTicker() {
    if (ticker) {
      globalThis.clearInterval(ticker);
      ticker = null;
    }
  }

  function toggleAudio() {
    const next = !spectro.isActive ? true : !audioOn;
    audioOn = next;
    rawSpectro.setAudioOutput(next);
    stationSpectro.setAudioOutput(next);
  }
  let audioOn = $state(true);

  const meterPct = (db: number) =>
    Math.round(((Math.max(METER_MIN_DB, db) - METER_MIN_DB) / -METER_MIN_DB) * 100);

  onMount(() => {
    loadSources();
    return () => stop();
  });
</script>

<div class="rounded-sm border border-[var(--border-100)] bg-[var(--color-base-200)] p-3">
  <div class="flex flex-wrap items-center gap-3">
    {#if pinned}
      <span class="text-sm">
        <span class="text-[var(--text-muted)]"
          >{t('settings.audio.audioFilters.console.monitor.source')}</span
        >
        <span class="font-medium">{sourceName}</span>
        {#if sources.length > 0 && !selectedId}
          <span class="ml-2 text-xs text-[var(--color-warning)]"
            >{t('settings.audio.audioFilters.console.monitor.sourceNotRunning')}</span
          >
        {/if}
      </span>
    {:else}
      <label class="flex items-center gap-2 text-sm">
        <span class="text-[var(--text-muted)]"
          >{t('settings.audio.audioFilters.console.monitor.source')}</span
        >
        <select
          class="rounded-sm border border-[var(--border-200)] bg-[var(--color-base-100)] px-2 py-1 text-sm"
          bind:value={selectedId}
          disabled={disabled || live || connecting}
        >
          {#each sources as s (s.id)}
            <option value={s.id}>{s.name}</option>
          {/each}
        </select>
      </label>
    {/if}

    <div
      class="flex items-center gap-1 rounded-sm border border-[var(--border-200)] p-0.5 text-xs"
      role="group"
      aria-label={t('settings.audio.audioFilters.console.monitor.mode')}
    >
      <button
        type="button"
        class="rounded-sm px-2 py-1 {mode === 'raw'
          ? 'bg-[var(--color-primary)] text-[var(--color-primary-content)]'
          : 'hover:bg-[var(--hover-overlay)]'}"
        aria-pressed={mode === 'raw'}
        title={t('settings.audio.audioFilters.console.monitor.rawHelp')}
        onclick={() => switchMode('raw')}
        >{t('settings.audio.audioFilters.console.monitor.raw')}</button
      >
      <button
        type="button"
        class="rounded-sm px-2 py-1 {mode === 'station'
          ? 'bg-[var(--color-primary)] text-[var(--color-primary-content)]'
          : 'hover:bg-[var(--hover-overlay)]'}"
        aria-pressed={mode === 'station'}
        title={t('settings.audio.audioFilters.console.monitor.stationHelp')}
        onclick={() => switchMode('station')}
        >{t('settings.audio.audioFilters.console.monitor.station')}</button
      >
    </div>

    {#if live || connecting}
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-sm border border-[var(--border-200)] px-2 py-1 text-sm hover:bg-[var(--hover-overlay)]"
        onclick={stop}
      >
        <Square class="size-4" />
        {t('settings.audio.audioFilters.console.monitor.stop')}
      </button>
    {:else}
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-sm bg-[var(--color-primary)] px-2 py-1 text-sm text-[var(--color-primary-content)] disabled:opacity-50"
        disabled={startReason !== ''}
        aria-describedby="eq-monitor-reason"
        title={startReason || undefined}
        onclick={start}
      >
        <Play class="size-4" />
        {t('settings.audio.audioFilters.console.monitor.listen')}
      </button>
    {/if}
    <span id="eq-monitor-reason" class="text-xs text-[var(--text-muted)]">{startReason}</span>

    <button
      type="button"
      class="ml-auto rounded-full p-1 hover:bg-[var(--hover-overlay)] disabled:opacity-50"
      disabled={!live}
      aria-pressed={audioOn}
      aria-label={audioOn ? t('spectrogram.controls.mute') : t('spectrogram.controls.unmute')}
      title={live
        ? audioOn
          ? t('spectrogram.controls.mute')
          : t('spectrogram.controls.unmute')
        : t('settings.audio.audioFilters.console.monitor.notListening')}
      onclick={toggleAudio}
    >
      {#if audioOn}<Volume2 class="size-4" />{:else}<VolumeX class="size-4" />{/if}
    </button>

    <div
      class="flex items-center gap-2"
      role="meter"
      aria-valuemin={METER_MIN_DB}
      aria-valuemax="0"
      aria-valuenow={Math.round(rmsDb)}
      aria-label={t('settings.audio.audioFilters.console.monitor.level')}
    >
      <div class="relative h-2 w-28 overflow-hidden rounded-sm bg-[var(--color-base-300)]">
        <div
          class="absolute inset-y-0 left-0 bg-[var(--color-success)]"
          style:width="{meterPct(rmsDb)}%"
        ></div>
        <div
          class="absolute inset-y-0 w-0.5 bg-[var(--color-base-content)]"
          style:left="{meterPct(peakDb)}%"
        ></div>
      </div>
      <span
        class="w-14 font-mono text-xs tabular-nums {clipping
          ? 'text-[var(--color-error)]'
          : 'text-[var(--text-muted)]'}"
      >
        {live ? `${rmsDb.toFixed(0)} dB` : '—'}
      </span>
    </div>
  </div>

  {#if live}
    <div class="mt-3">
      <button
        type="button"
        class="text-xs text-[var(--text-muted)] hover:underline"
        onclick={() => (showWaterfall = !showWaterfall)}
      >
        {showWaterfall
          ? t('settings.audio.audioFilters.console.monitor.hideWaterfall')
          : t('settings.audio.audioFilters.console.monitor.showWaterfall')}
      </button>
      {#if showWaterfall}
        <div class="mt-1 h-32 overflow-hidden rounded-sm bg-black">
          <SpectrogramCanvas
            analyser={spectro.analyser}
            frequencyData={spectro.frequencyData}
            sampleRate={spectro.sampleRate}
            fftSize={spectro.fftSize}
            isActive={spectro.isActive}
            className="h-full w-full"
          />
        </div>
      {/if}
    </div>
  {/if}
</div>
