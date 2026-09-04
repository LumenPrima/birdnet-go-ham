<!--
  EqCurve - the equalizer's frequency response as an interactive d3 SVG chart.

  Draws every band's own response faintly, the combined response solid, and a real-time
  spectrum (pre and post) behind them on the same log frequency axis. Each band has a
  handle: drag horizontally for frequency, vertically for gain (gain types only), scroll
  or use the arrow keys to nudge; shift with the arrows changes Q or bandwidth.

  @component
-->
<script lang="ts">
  /* global PointerEvent, WheelEvent, Element, ResizeObserver */
  import { scaleLog, scaleLinear } from 'd3-scale';
  import { line as d3Line, area as d3Area, curveMonotoneX } from 'd3-shape';
  import { t } from '$lib/i18n';
  import { calculateCombinedResponse, calculateFilterResponse } from '$lib/utils/audio/dsp';
  import { bandToFilterConfig, formatDb, formatHz, logBinCenters } from '$lib/utils/eqAnalysis';
  import { usesGain, usesWidth, type MirrorBand } from '$lib/utils/eqMirror';

  interface Props {
    bands: MirrorBand[];
    enabled?: boolean;
    sampleRate?: number;
    /** dB per log bin (see eqAnalysis.spectrumToLogBins); null when the monitor is off */
    preSpectrum?: Float32Array | null;
    postSpectrum?: Float32Array | null;
    /** Number of log bins the spectra use (must match the analyser helper) */
    spectrumBins?: number;
    selectedIndex?: number | null;
    height?: number;
    onSelect?: (_index: number | null) => void;
    onBandChange?: (_index: number, _patch: Partial<MirrorBand>) => void;
  }

  let {
    bands,
    enabled = true,
    sampleRate = 48000,
    preSpectrum = null,
    postSpectrum = null,
    spectrumBins = 200,
    selectedIndex = null,
    height = 260,
    onSelect,
    onBandChange,
  }: Props = $props();

  const F_MIN = 20;
  const F_MAX = 20000;
  const DB_MIN = -24;
  const DB_MAX = 24;
  const RTA_MIN_DB = -100;
  const RTA_MAX_DB = -30;
  const CURVE_POINTS = 240;
  const MARGIN = { top: 12, right: 16, bottom: 26, left: 40 };
  const HANDLE_RADIUS = 7;
  const FREQ_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const DB_TICKS = [-24, -12, 0, 12, 24];
  const NUDGE_FREQ_RATIO = 1.02;
  const NUDGE_GAIN_DB = 0.5;
  const NUDGE_Q_RATIO = 1.1;
  const MIN_Q = 0.1;
  const MAX_Q = 10;
  const MIN_WIDTH_HZ = 1;

  let container: HTMLDivElement | undefined = $state();
  let width = $state(720);
  let hover = $state<{ x: number; y: number; freq: number; db: number } | null>(null);
  let dragging = $state<number | null>(null);

  const plotW = $derived(Math.max(100, width - MARGIN.left - MARGIN.right));
  const plotH = $derived(height - MARGIN.top - MARGIN.bottom);
  const x = $derived(scaleLog().domain([F_MIN, F_MAX]).range([0, plotW]).clamp(true));
  const y = $derived(scaleLinear().domain([DB_MIN, DB_MAX]).range([plotH, 0]).clamp(true));
  const yRta = $derived(
    scaleLinear().domain([RTA_MIN_DB, RTA_MAX_DB]).range([plotH, 0]).clamp(true)
  );

  const curveFreqs = $derived(Array.from(logBinCenters(CURVE_POINTS, F_MIN, F_MAX)));
  const activeConfigs = $derived(bands.filter(b => !b.bypass).map(bandToFilterConfig));

  const combinedPath = $derived.by(() => {
    if (!enabled || activeConfigs.length === 0) {
      return (
        d3Line<number>()
          .x(f => x(f))
          .y(() => y(0))(curveFreqs) ?? ''
      );
    }
    const pts = curveFreqs.map(
      f => [f, calculateCombinedResponse(activeConfigs, f, sampleRate)] as const
    );
    return (
      d3Line<readonly [number, number]>()
        .x(p => x(p[0]))
        .y(p => y(p[1]))
        .curve(curveMonotoneX)(pts) ?? ''
    );
  });

  const bandPaths = $derived(
    bands.map(band => {
      if (band.bypass || !enabled) return '';
      const cfg = bandToFilterConfig(band);
      const pts = curveFreqs.map(f => [f, calculateFilterResponse(cfg, f, sampleRate)] as const);
      return (
        d3Line<readonly [number, number]>()
          .x(p => x(p[0]))
          .y(p => y(p[1]))
          .curve(curveMonotoneX)(pts) ?? ''
      );
    })
  );

  function spectrumPath(spec: Float32Array | null): string {
    if (!spec || spec.length === 0) return '';
    const centers = logBinCenters(spectrumBins, F_MIN, F_MAX);
    const pts = Array.from(spec, (db, i) => [centers.at(i) ?? F_MIN, db] as const);
    return (
      d3Area<readonly [number, number]>()
        .x(p => x(p[0]))
        .y0(() => plotH)
        .y1(p => yRta(p[1]))
        .curve(curveMonotoneX)(pts) ?? ''
    );
  }
  const prePath = $derived(spectrumPath(preSpectrum));
  const postPath = $derived(spectrumPath(postSpectrum));

  function handleY(band: MirrorBand): number {
    return usesGain(band.type) ? y(band.gain ?? 0) : y(0);
  }

  function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
  }

  function pointerToPlot(event: PointerEvent, svg: SVGSVGElement): { fx: number; fy: number } {
    const rect = svg.getBoundingClientRect();
    return {
      fx: event.clientX - rect.left - MARGIN.left,
      fy: event.clientY - rect.top - MARGIN.top,
    };
  }

  function onHandleDown(event: PointerEvent, index: number) {
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    dragging = index;
    onSelect?.(index);
  }

  function onHandleMove(event: PointerEvent, index: number, svg: SVGSVGElement) {
    if (dragging !== index) return;
    const band = bands.at(index);
    if (!band) return;
    const { fx, fy } = pointerToPlot(event, svg);
    const frequency = Math.round(clamp(x.invert(clamp(fx, 0, plotW)), F_MIN, F_MAX));
    const patch: Partial<MirrorBand> = { frequency };
    if (usesGain(band.type)) {
      patch.gain = Math.round(clamp(y.invert(clamp(fy, 0, plotH)), DB_MIN, DB_MAX) * 2) / 2;
    }
    onBandChange?.(index, patch);
  }

  function onHandleUp(event: PointerEvent) {
    (event.currentTarget as Element).releasePointerCapture(event.pointerId);
    dragging = null;
  }

  /** Scroll on a handle sharpens or widens the band. */
  function onHandleWheel(event: WheelEvent, index: number) {
    const band = bands.at(index);
    if (!band) return;
    event.preventDefault();
    const sharpen = event.deltaY < 0;
    onBandChange?.(index, sharpnessPatch(band, sharpen));
  }

  function sharpnessPatch(band: MirrorBand, sharpen: boolean): Partial<MirrorBand> {
    if (usesWidth(band.type)) {
      const width = band.width ?? band.frequency / 2;
      const next = clamp(
        sharpen ? width / NUDGE_Q_RATIO : width * NUDGE_Q_RATIO,
        MIN_WIDTH_HZ,
        band.frequency * 1.9
      );
      return { width: Math.round(next) };
    }
    const q = band.q ?? 0.707;
    const next = clamp(sharpen ? q * NUDGE_Q_RATIO : q / NUDGE_Q_RATIO, MIN_Q, MAX_Q);
    return { q: Math.round(next * 100) / 100 };
  }

  function onHandleKey(event: KeyboardEvent, index: number) {
    const band = bands.at(index);
    if (!band) return;
    let patch: Partial<MirrorBand> | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        patch = { frequency: Math.round(clamp(band.frequency / NUDGE_FREQ_RATIO, F_MIN, F_MAX)) };
        break;
      case 'ArrowRight':
        patch = { frequency: Math.round(clamp(band.frequency * NUDGE_FREQ_RATIO, F_MIN, F_MAX)) };
        break;
      case 'ArrowUp':
        patch = event.shiftKey
          ? sharpnessPatch(band, true)
          : usesGain(band.type)
            ? { gain: clamp((band.gain ?? 0) + NUDGE_GAIN_DB, DB_MIN, DB_MAX) }
            : null;
        break;
      case 'ArrowDown':
        patch = event.shiftKey
          ? sharpnessPatch(band, false)
          : usesGain(band.type)
            ? { gain: clamp((band.gain ?? 0) - NUDGE_GAIN_DB, DB_MIN, DB_MAX) }
            : null;
        break;
      default:
        return;
    }
    if (patch) {
      event.preventDefault();
      onBandChange?.(index, patch);
    }
  }

  function onPlotMove(event: PointerEvent, svg: SVGSVGElement) {
    if (dragging !== null) return;
    const { fx, fy } = pointerToPlot(event, svg);
    if (fx < 0 || fx > plotW || fy < 0 || fy > plotH) {
      hover = null;
      return;
    }
    const freq = x.invert(fx);
    const db =
      enabled && activeConfigs.length
        ? calculateCombinedResponse(activeConfigs, freq, sampleRate)
        : 0;
    hover = { x: fx, y: y(db), freq, db };
  }

  $effect(() => {
    if (!container) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) width = w;
    });
    ro.observe(container);
    return () => ro.disconnect();
  });

  const tickLabel = (f: number) => (f >= 1000 ? `${f / 1000}k` : `${f}`);
</script>

<div bind:this={container} class="w-full select-none">
  <svg
    {width}
    {height}
    viewBox="0 0 {width} {height}"
    class="block w-full touch-none"
    role="img"
    aria-label={t('settings.audio.audioFilters.console.curveLabel')}
    onpointermove={e => onPlotMove(e, e.currentTarget)}
    onpointerleave={() => (hover = null)}
  >
    <g transform="translate({MARGIN.left},{MARGIN.top})">
      <!-- grid -->
      {#each FREQ_TICKS as f (f)}
        <line
          x1={x(f)}
          x2={x(f)}
          y1="0"
          y2={plotH}
          stroke="var(--color-base-300)"
          stroke-width="1"
        />
        <text x={x(f)} y={plotH + 16} text-anchor="middle" font-size="10" fill="var(--text-muted)"
          >{tickLabel(f)}</text
        >
      {/each}
      {#each DB_TICKS as d (d)}
        <line
          x1="0"
          x2={plotW}
          y1={y(d)}
          y2={y(d)}
          stroke="var(--color-base-300)"
          stroke-width={d === 0 ? 1.5 : 1}
        />
        <text x="-8" y={y(d) + 3} text-anchor="end" font-size="10" fill="var(--text-muted)"
          >{d > 0 ? `+${d}` : d}</text
        >
      {/each}

      <!-- real-time spectra, pre behind post -->
      {#if prePath}
        <path d={prePath} fill="var(--text-muted)" fill-opacity="0.18" />
      {/if}
      {#if postPath}
        <path d={postPath} fill="var(--color-primary)" fill-opacity="0.25" />
      {/if}

      <!-- per-band responses -->
      {#each bandPaths as p, i (bands.at(i)?.id ?? i)}
        {#if p}
          <path
            d={p}
            fill="none"
            stroke="var(--color-primary)"
            stroke-opacity={selectedIndex === i ? 0.6 : 0.25}
            stroke-width="1"
          />
        {/if}
      {/each}

      <!-- combined response -->
      <path d={combinedPath} fill="none" stroke="var(--color-primary)" stroke-width="2.25" />

      <!-- hover readout -->
      {#if hover}
        <line
          x1={hover.x}
          x2={hover.x}
          y1="0"
          y2={plotH}
          stroke="var(--text-muted)"
          stroke-dasharray="3 3"
        />
        <circle cx={hover.x} cy={hover.y} r="3" fill="var(--color-primary)" />
        <text
          x={hover.x + (hover.x > plotW - 90 ? -8 : 8)}
          y="12"
          text-anchor={hover.x > plotW - 90 ? 'end' : 'start'}
          font-size="11"
          fill="var(--color-base-content)"
        >
          {formatHz(hover.freq)} · {formatDb(hover.db)}
        </text>
      {/if}

      <!-- band handles -->
      {#each bands as band, i (band.id)}
        <g
          role="slider"
          tabindex="0"
          aria-label={t('settings.audio.audioFilters.console.handleLabel', {
            index: i + 1,
            type: band.type,
            frequency: formatHz(band.frequency),
          })}
          aria-valuenow={band.frequency}
          aria-valuemin={F_MIN}
          aria-valuemax={F_MAX}
          class="cursor-grab focus:outline-none [&:focus>circle]:stroke-[3]"
          onpointerdown={e => onHandleDown(e, i)}
          onpointermove={e => onHandleMove(e, i, e.currentTarget.ownerSVGElement!)}
          onpointerup={onHandleUp}
          onpointercancel={onHandleUp}
          onwheel={e => onHandleWheel(e, i)}
          onkeydown={e => onHandleKey(e, i)}
          onclick={() => onSelect?.(i)}
        >
          <circle
            cx={x(band.frequency)}
            cy={handleY(band)}
            r={HANDLE_RADIUS}
            fill={band.bypass ? 'var(--color-base-200)' : 'var(--color-primary)'}
            fill-opacity={band.bypass ? 0.6 : 0.9}
            stroke={selectedIndex === i ? 'var(--color-base-content)' : 'var(--color-base-100)'}
            stroke-width="2"
          />
          <text
            x={x(band.frequency)}
            y={handleY(band) + 3.5}
            text-anchor="middle"
            font-size="9"
            font-weight="600"
            fill="var(--color-base-100)"
            pointer-events="none">{i + 1}</text
          >
        </g>
      {/each}
    </g>
  </svg>
</div>
