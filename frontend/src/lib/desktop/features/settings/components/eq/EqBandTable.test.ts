import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import EqBandTable from './EqBandTable.svelte';
import type { MirrorBand } from '$lib/utils/eqMirror';

// i18n is mocked globally (src/test/setup.ts): t() returns the key.

const bands: MirrorBand[] = [
  { id: 'hp', type: 'HighPass', frequency: 120, q: 0.707, passes: 2 },
  { id: 'pk', type: 'Peaking', frequency: 2400, width: 600, gain: -4 },
];
const types = [
  'HighPass',
  'LowPass',
  'BandReject',
  'BandPass',
  'LowShelf',
  'HighShelf',
  'Peaking',
] as const;

describe('EqBandTable', () => {
  afterEach(() => cleanup());

  it('renders one row per band with gain disabled on cut-only types', () => {
    render(EqBandTable, { props: { bands, types: [...types] } });
    const gains = screen.getAllByLabelText('settings.audio.audioFilters.console.columns.gain');
    expect(gains).toHaveLength(2);
    expect(gains[0]).toBeDisabled();
    expect(gains[0]).toHaveAttribute('title', 'settings.audio.audioFilters.console.noGainForType');
    expect(gains[1]).toBeEnabled();
    const slopes = screen.getAllByLabelText('settings.audio.audioFilters.console.columns.slope');
    expect(slopes[0]).toBeEnabled();
    expect(slopes[1]).toBeDisabled();
  });

  it('emits clamped patches for frequency, bandwidth and bypass', async () => {
    const onChange = vi.fn();
    render(EqBandTable, { props: { bands, types: [...types], onChange } });
    const freqs = screen.getAllByLabelText('settings.audio.audioFilters.console.columns.frequency');
    await fireEvent.change(freqs[0], { target: { value: '5' } });
    expect(onChange).toHaveBeenLastCalledWith(0, { frequency: 20 });
    const width = screen.getByLabelText('settings.audio.audioFilters.console.bandwidth');
    await fireEvent.change(width, { target: { value: '100000' } });
    expect(onChange).toHaveBeenLastCalledWith(1, { width: Math.round(2400 * 1.9) });
    const bypass = screen.getAllByLabelText('settings.audio.audioFilters.console.bypassBand')[1];
    await fireEvent.click(bypass);
    expect(onChange).toHaveBeenLastCalledWith(1, { bypass: true });
  });

  it('keeps the add button disabled with a reason until a type is chosen', async () => {
    const onAdd = vi.fn();
    render(EqBandTable, { props: { bands: [], types: [...types], onAdd } });
    const add = screen.getByText('settings.audio.audioFilters.console.addBand').closest('button');
    if (!add) throw new Error('add button not rendered');
    expect(add).toBeDisabled();
    expect(
      screen.getByText('settings.audio.audioFilters.console.pickTypeFirst')
    ).toBeInTheDocument();
    const select = screen.getByLabelText('settings.audio.audioFilters.newFilterType');
    await fireEvent.change(select, { target: { value: 'LowShelf' } });
    expect(add).toBeEnabled();
    await fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledWith('LowShelf');
  });

  it('shows a saved slope of 0 passes as the single pass the station runs', () => {
    render(EqBandTable, {
      props: {
        bands: [{ id: 'hp0', type: 'HighPass', frequency: 100, q: 0.707, passes: 0 }],
        types: [...types],
      },
    });
    const slope = screen.getByLabelText<HTMLSelectElement>(
      'settings.audio.audioFilters.console.columns.slope'
    );
    expect(slope.value).toBe('1');
  });
});
