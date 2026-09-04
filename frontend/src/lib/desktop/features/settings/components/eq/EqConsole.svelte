<!--
  EqConsole - the advanced equalizer editor.

  Holds a proposed band list separate from the saved one, hears it at once through the
  monitor's raw stream (browser-side mirror), and only on "Apply to station" writes it to the
  settings store and saves, which hot-swaps the station's filter chains. Reset returns to the
  saved set; A/B flips the mirror between saved and proposed without touching either.

  @component
-->
<script lang="ts">
  import { t } from '$lib/i18n';
  import { toastActions } from '$lib/stores/toast';
  import { settingsActions } from '$lib/stores/settings';
  import type { EqualizerFilter, EqualizerFilterType } from '$lib/stores/settings';
  import { loggers } from '$lib/utils/logger';
  import { useEqMirror } from '$lib/utils/useEqMirror.svelte';
  import type { MirrorBand } from '$lib/utils/eqMirror';
  import EqCurve from './EqCurve.svelte';
  import EqBandTable from './EqBandTable.svelte';
  import EqMonitor from './EqMonitor.svelte';

  /** The basic form's filter shape: ids are assigned by the page, so they may be missing here. */
  type FilterLike = Omit<EqualizerFilter, 'id'> & { id?: string };

  interface EqualizerSettingsLike {
    enabled: boolean;
    filters: FilterLike[];
  }

  interface Props {
    equalizerSettings: EqualizerSettingsLike;
    /** Filter types the station offers (from the equalizer config endpoint) */
    types: EqualizerFilterType[];
    /** Config display name when editing a per-source equalizer */
    sourceName?: string;
    disabled?: boolean;
    /** Hands the proposed set to the page's settings plumbing (same contract as the basic form) */
    onUpdate: (_updated: EqualizerSettingsLike) => void;
  }

  let { equalizerSettings, types, sourceName, disabled = false, onUpdate }: Props = $props();

  const logger = loggers.settings;
  const SPECTRUM_BINS = 200;

  /** Sensible starting values for a new band of each type. */
  function defaultsFor(type: EqualizerFilterType): Partial<EqualizerFilter> {
    switch (type) {
      case 'HighPass':
        return { frequency: 100, q: 0.707, passes: 2 };
      case 'LowPass':
        return { frequency: 15000, q: 0.707, passes: 2 };
      case 'BandReject':
        return { frequency: 60, width: 4, passes: 1 };
      case 'BandPass':
        return { frequency: 2000, width: 2000, passes: 1 };
      case 'LowShelf':
        return { frequency: 200, q: 0.707, gain: 0 };
      case 'HighShelf':
        return { frequency: 8000, q: 0.707, gain: 0 };
      case 'Peaking':
        return { frequency: 1000, width: 400, gain: 0 };
    }
  }

  const newId = () => `band-${Math.random().toString(36).slice(2, 10)}`;

  function fromSaved(filters: FilterLike[]): MirrorBand[] {
    return filters.map(f => ({ ...f, id: f.id ?? newId(), bypass: false }));
  }
  function toSaved(bands: MirrorBand[]): EqualizerFilter[] {
    return bands.map(({ bypass: _bypass, ...rest }) => rest);
  }

  // The proposed set is seeded once from the saved one and then edited locally; Reset re-seeds
  // it on demand, so following the prop reactively is not wanted.
  // svelte-ignore state_referenced_locally
  let proposed = $state<MirrorBand[]>(fromSaved(equalizerSettings.filters));
  // svelte-ignore state_referenced_locally
  let proposedEnabled = $state(equalizerSettings.enabled);
  let selected = $state<number | null>(null);
  let listenTo = $state<'proposed' | 'saved'>('proposed');
  let monitorMode = $state<'raw' | 'station'>('raw');
  let preSpectrum = $state<Float32Array | null>(null);
  let postSpectrum = $state<Float32Array | null>(null);
  let applying = $state(false);

  const mirror = useEqMirror();

  const savedBands = $derived(fromSaved(equalizerSettings.filters));
  const dirty = $derived(
    proposedEnabled !== equalizerSettings.enabled ||
      JSON.stringify(toSaved(proposed)) !== JSON.stringify(equalizerSettings.filters)
  );
  const shownBands = $derived(listenTo === 'proposed' ? proposed : savedBands);
  const shownEnabled = $derived(
    listenTo === 'proposed' ? proposedEnabled : equalizerSettings.enabled
  );

  // The mirror always plays what the curve shows; on the station stream it is silent.
  $effect(() => {
    mirror.setBands(monitorMode === 'raw' ? shownBands : []);
    mirror.setEnabled(monitorMode === 'raw' && shownEnabled);
  });

  function change(index: number, patch: Partial<MirrorBand>) {
    proposed = proposed.map((b, i) => (i === index ? { ...b, ...patch } : b));
    listenTo = 'proposed';
  }
  function remove(index: number) {
    proposed = proposed.filter((_, i) => i !== index);
    if (selected === index) selected = null;
  }
  function add(type: EqualizerFilterType) {
    proposed = [
      ...proposed,
      { id: newId(), type, frequency: 1000, ...defaultsFor(type), bypass: false },
    ];
    selected = proposed.length - 1;
    listenTo = 'proposed';
  }
  function reset() {
    proposed = fromSaved(equalizerSettings.filters);
    proposedEnabled = equalizerSettings.enabled;
    selected = null;
  }

  async function apply() {
    applying = true;
    try {
      onUpdate({ enabled: proposedEnabled, filters: toSaved(proposed) });
      await settingsActions.saveSettings();
      toastActions.success(t('notifications.content.settings.equalizerUpdated'));
    } catch (error) {
      logger.error('Failed to apply equalizer', error);
      toastActions.error(t('notifications.content.settings.equalizerUpdateFailed'));
    } finally {
      applying = false;
    }
  }

  const applyReason = $derived.by(() => {
    if (disabled || applying) return t('settings.audio.audioFilters.console.applying');
    if (!dirty) return t('settings.audio.audioFilters.console.nothingToApply');
    return '';
  });
</script>

<div class="space-y-4">
  <EqMonitor
    {sourceName}
    insert={mirror.insert}
    spectrumBins={SPECTRUM_BINS}
    {disabled}
    onSpectra={(pre, post) => {
      preSpectrum = pre;
      postSpectrum = post;
    }}
    onModeChange={m => (monitorMode = m)}
  />

  <div class="flex flex-wrap items-center gap-3 text-sm">
    <label class="inline-flex items-center gap-2">
      <input
        type="checkbox"
        class="size-4 accent-[var(--color-primary)]"
        bind:checked={proposedEnabled}
        {disabled}
      />
      {t('settings.audio.audioFilters.console.bandsActive')}
    </label>
    <div
      class="ml-auto inline-flex items-center gap-1 rounded-sm border border-[var(--border-200)] p-0.5 text-xs"
      role="group"
      aria-label={t('settings.audio.audioFilters.console.compare')}
    >
      <button
        type="button"
        class="rounded-sm px-2 py-1 {listenTo === 'saved'
          ? 'bg-[var(--color-primary)] text-[var(--color-primary-content)]'
          : 'hover:bg-[var(--hover-overlay)]'}"
        aria-pressed={listenTo === 'saved'}
        onclick={() => (listenTo = 'saved')}
        >{t('settings.audio.audioFilters.console.saved')}</button
      >
      <button
        type="button"
        class="rounded-sm px-2 py-1 {listenTo === 'proposed'
          ? 'bg-[var(--color-primary)] text-[var(--color-primary-content)]'
          : 'hover:bg-[var(--hover-overlay)]'}"
        aria-pressed={listenTo === 'proposed'}
        onclick={() => (listenTo = 'proposed')}
        >{t('settings.audio.audioFilters.console.proposed')}</button
      >
    </div>
  </div>

  <EqCurve
    bands={shownBands}
    enabled={shownEnabled}
    {preSpectrum}
    {postSpectrum}
    spectrumBins={SPECTRUM_BINS}
    selectedIndex={listenTo === 'proposed' ? selected : null}
    onSelect={i => (selected = i)}
    onBandChange={change}
  />

  <EqBandTable
    bands={proposed}
    {types}
    selectedIndex={selected}
    disabled={disabled || listenTo === 'saved'}
    onSelect={i => (selected = i)}
    onChange={change}
    onRemove={remove}
    onAdd={add}
  />

  <div class="flex flex-wrap items-center justify-end gap-2">
    <span class="mr-auto text-xs text-[var(--text-muted)]">
      {dirty
        ? t('settings.audio.audioFilters.console.unapplied')
        : t('settings.audio.audioFilters.console.matchesStation')}
    </span>
    <button
      type="button"
      class="rounded-sm border border-[var(--border-200)] px-3 py-1 text-sm hover:bg-[var(--hover-overlay)] disabled:opacity-50"
      disabled={disabled || !dirty}
      title={!dirty ? t('settings.audio.audioFilters.console.nothingToApply') : undefined}
      onclick={reset}>{t('settings.audio.audioFilters.console.reset')}</button
    >
    <button
      type="button"
      class="rounded-sm bg-[var(--color-primary)] px-3 py-1 text-sm text-[var(--color-primary-content)] disabled:opacity-50"
      disabled={applyReason !== ''}
      aria-describedby="eq-apply-reason"
      title={applyReason || undefined}
      onclick={apply}>{t('settings.audio.audioFilters.console.apply')}</button
    >
    <span id="eq-apply-reason" class="sr-only">{applyReason}</span>
  </div>
</div>
