<!--
  EqBandTable - one row per equalizer band: type, frequency, gain, Q or bandwidth, slope,
  bypass and remove, plus an add-band control. Native inputs styled with the theme tokens;
  every disabled field says why through its title and an aria-describedby note.

  @component
-->
<script lang="ts">
  import { Plus, Trash2, Power } from '@lucide/svelte';
  import { t } from '$lib/i18n';
  import type { EqualizerFilterType } from '$lib/stores/settings';
  import {
    qToWidth,
    usesGain,
    usesPasses,
    usesWidth,
    widthToQ,
    type MirrorBand,
  } from '$lib/utils/eqMirror';
  import { formatDb, formatHz } from '$lib/utils/eqAnalysis';

  interface Props {
    bands: MirrorBand[];
    types: EqualizerFilterType[];
    selectedIndex?: number | null;
    disabled?: boolean;
    onSelect?: (_index: number | null) => void;
    onChange?: (_index: number, _patch: Partial<MirrorBand>) => void;
    onRemove?: (_index: number) => void;
    onAdd?: (_type: EqualizerFilterType) => void;
  }

  let {
    bands,
    types,
    selectedIndex = null,
    disabled = false,
    onSelect,
    onChange,
    onRemove,
    onAdd,
  }: Props = $props();

  const SLOPES = [
    { passes: 1, label: '12 dB/oct' },
    { passes: 2, label: '24 dB/oct' },
    { passes: 3, label: '36 dB/oct' },
    { passes: 4, label: '48 dB/oct' },
  ];
  const F_MIN = 20;
  const F_MAX = 20000;
  const GAIN_MAX = 30;
  const Q_MIN = 0.1;
  const Q_MAX = 10;

  let addType = $state<EqualizerFilterType | ''>('');

  const typeLabel = (type: EqualizerFilterType) =>
    t(`settings.audio.audioFilters.console.types.${type}`);

  function num(event: Event): number | null {
    const v = Number((event.currentTarget as HTMLInputElement).value);
    return Number.isFinite(v) ? v : null;
  }

  function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
  }

  function changeFrequency(i: number, event: Event) {
    const v = num(event);
    if (v !== null) onChange?.(i, { frequency: Math.round(clamp(v, F_MIN, F_MAX)) });
  }
  function changeGain(i: number, event: Event) {
    const v = num(event);
    if (v !== null) onChange?.(i, { gain: clamp(v, -GAIN_MAX, GAIN_MAX) });
  }
  function changeQ(i: number, band: MirrorBand, event: Event) {
    const v = num(event);
    if (v === null) return;
    if (usesWidth(band.type)) {
      onChange?.(i, { width: Math.round(clamp(v, 1, band.frequency * 1.9)) });
    } else {
      onChange?.(i, { q: clamp(v, Q_MIN, Q_MAX) });
    }
  }
  function changeSlope(i: number, event: Event) {
    const v = Number((event.currentTarget as HTMLSelectElement).value);
    onChange?.(i, { passes: clamp(Math.round(v), 1, 4) });
  }
  function changeType(i: number, event: Event) {
    const v = (event.currentTarget as HTMLSelectElement).value;
    const type = types.find(x => x === v);
    if (type) onChange?.(i, { type });
  }
  function add() {
    if (addType === '') return;
    onAdd?.(addType);
    addType = '';
  }

  const inputClass =
    'w-full rounded-sm border border-[var(--border-200)] bg-[var(--color-base-100)] px-2 py-1 font-mono text-sm text-[var(--color-base-content)] tabular-nums focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] disabled:opacity-50';
  const selectClass = inputClass;
</script>

<div class="overflow-x-auto">
  <table class="w-full text-sm">
    <thead>
      <tr class="text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
        <th class="py-1 pr-2 font-medium">#</th>
        <th class="py-1 pr-2 font-medium"
          >{t('settings.audio.audioFilters.console.columns.type')}</th
        >
        <th class="py-1 pr-2 font-medium"
          >{t('settings.audio.audioFilters.console.columns.frequency')}</th
        >
        <th class="py-1 pr-2 font-medium"
          >{t('settings.audio.audioFilters.console.columns.gain')}</th
        >
        <th class="py-1 pr-2 font-medium"
          >{t('settings.audio.audioFilters.console.columns.shape')}</th
        >
        <th class="py-1 pr-2 font-medium"
          >{t('settings.audio.audioFilters.console.columns.slope')}</th
        >
        <th class="py-1 pr-2 font-medium">{t('settings.audio.audioFilters.console.columns.on')}</th>
        <th class="py-1 font-medium"
          ><span class="sr-only">{t('settings.audio.audioFilters.remove')}</span></th
        >
      </tr>
    </thead>
    <tbody>
      {#each bands as band, i (band.id)}
        {@const gainOff = !usesGain(band.type)}
        {@const slopeOff = !usesPasses(band.type)}
        {@const shapeIsWidth = usesWidth(band.type)}
        <tr
          class="border-t border-[var(--border-100)]"
          class:bg-[var(--hover-overlay)]={selectedIndex === i}
          class:opacity-60={band.bypass}
          onclick={() => onSelect?.(i)}
        >
          <td class="py-1.5 pr-2 font-mono text-[var(--text-muted)]">{i + 1}</td>
          <td class="py-1.5 pr-2">
            <select
              class={selectClass}
              value={band.type}
              {disabled}
              aria-label={t('settings.audio.audioFilters.filterType')}
              onchange={e => changeType(i, e)}
            >
              {#each types as type (type)}
                <option value={type}>{typeLabel(type)}</option>
              {/each}
            </select>
          </td>
          <td class="py-1.5 pr-2">
            <input
              type="number"
              class={inputClass}
              value={band.frequency}
              min={F_MIN}
              max={F_MAX}
              step="1"
              {disabled}
              aria-label={t('settings.audio.audioFilters.console.columns.frequency')}
              title={formatHz(band.frequency)}
              onchange={e => changeFrequency(i, e)}
            />
          </td>
          <td class="py-1.5 pr-2">
            <input
              type="number"
              class={inputClass}
              value={gainOff ? 0 : (band.gain ?? 0)}
              min={-GAIN_MAX}
              max={GAIN_MAX}
              step="0.5"
              disabled={disabled || gainOff}
              aria-label={t('settings.audio.audioFilters.console.columns.gain')}
              aria-describedby={gainOff ? `eq-gain-note-${band.id}` : undefined}
              title={gainOff
                ? t('settings.audio.audioFilters.console.noGainForType')
                : formatDb(band.gain ?? 0)}
              onchange={e => changeGain(i, e)}
            />
            {#if gainOff}
              <span id="eq-gain-note-{band.id}" class="sr-only"
                >{t('settings.audio.audioFilters.console.noGainForType')}</span
              >
            {/if}
          </td>
          <td class="py-1.5 pr-2">
            <div class="flex items-center gap-1">
              <input
                type="number"
                class={inputClass}
                value={shapeIsWidth
                  ? (band.width ?? Math.round(band.frequency / 2))
                  : (band.q ?? 0.707)}
                min={shapeIsWidth ? 1 : Q_MIN}
                max={shapeIsWidth ? Math.round(band.frequency * 1.9) : Q_MAX}
                step={shapeIsWidth ? 1 : 0.01}
                {disabled}
                aria-label={shapeIsWidth
                  ? t('settings.audio.audioFilters.console.bandwidth')
                  : t('settings.audio.audioFilters.qFactor')}
                title={shapeIsWidth
                  ? `Q ≈ ${widthToQ(band.frequency, band.width ?? band.frequency / 2).toFixed(2)}`
                  : `≈ ${formatHz(qToWidth(band.frequency, band.q ?? 0.707))} ${t('settings.audio.audioFilters.console.wide')}`}
                onchange={e => changeQ(i, band, e)}
              />
              <span class="w-6 shrink-0 text-xs text-[var(--text-muted)]"
                >{shapeIsWidth ? 'Hz' : 'Q'}</span
              >
            </div>
          </td>
          <td class="py-1.5 pr-2">
            <select
              class={selectClass}
              value={slopeOff ? 1 : (band.passes ?? 1)}
              disabled={disabled || slopeOff}
              aria-label={t('settings.audio.audioFilters.console.columns.slope')}
              aria-describedby={slopeOff ? `eq-slope-note-${band.id}` : undefined}
              title={slopeOff ? t('settings.audio.audioFilters.console.noSlopeForType') : undefined}
              onchange={e => changeSlope(i, e)}
            >
              {#each SLOPES as s (s.passes)}
                <option value={s.passes}>{s.label}</option>
              {/each}
            </select>
            {#if slopeOff}
              <span id="eq-slope-note-{band.id}" class="sr-only"
                >{t('settings.audio.audioFilters.console.noSlopeForType')}</span
              >
            {/if}
          </td>
          <td class="py-1.5 pr-2">
            <button
              type="button"
              class="rounded-full p-1 {band.bypass
                ? 'text-[var(--text-muted)]'
                : 'text-[var(--color-success)]'} hover:bg-[var(--hover-overlay)] disabled:opacity-50"
              {disabled}
              aria-pressed={!band.bypass}
              aria-label={band.bypass
                ? t('settings.audio.audioFilters.console.enableBand')
                : t('settings.audio.audioFilters.console.bypassBand')}
              title={band.bypass
                ? t('settings.audio.audioFilters.console.enableBand')
                : t('settings.audio.audioFilters.console.bypassBand')}
              onclick={e => {
                e.stopPropagation();
                onChange?.(i, { bypass: !band.bypass });
              }}
            >
              <Power class="size-4" />
            </button>
          </td>
          <td class="py-1.5">
            <button
              type="button"
              class="rounded-full p-1 text-[var(--text-muted)] hover:bg-[var(--hover-overlay)] hover:text-[var(--color-error)] disabled:opacity-50"
              {disabled}
              aria-label={t('settings.audio.audioFilters.remove')}
              title={t('settings.audio.audioFilters.remove')}
              onclick={e => {
                e.stopPropagation();
                onRemove?.(i);
              }}
            >
              <Trash2 class="size-4" />
            </button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  <div class="mt-3 flex items-center gap-2">
    <select
      class="{selectClass} w-auto"
      bind:value={addType}
      {disabled}
      aria-label={t('settings.audio.audioFilters.newFilterType')}
    >
      <option value="">{t('settings.audio.audioFilters.selectFilterType')}</option>
      {#each types as type (type)}
        <option value={type}>{typeLabel(type)}</option>
      {/each}
    </select>
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-sm border border-[var(--border-200)] px-2 py-1 text-sm hover:bg-[var(--hover-overlay)] disabled:opacity-50"
      disabled={disabled || addType === ''}
      aria-describedby="eq-add-note"
      title={addType === '' ? t('settings.audio.audioFilters.console.pickTypeFirst') : undefined}
      onclick={add}
    >
      <Plus class="size-4" />
      {t('settings.audio.audioFilters.console.addBand')}
    </button>
    <span id="eq-add-note" class="text-xs text-[var(--text-muted)]">
      {addType === '' ? t('settings.audio.audioFilters.console.pickTypeFirst') : ''}
    </span>
  </div>
</div>
