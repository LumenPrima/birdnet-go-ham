import { describe, it, expect } from 'vitest';
import {
  bandToStages,
  bandsToStages,
  qToWidth,
  stageCount,
  usesGain,
  usesPasses,
  usesWidth,
  widthToQ,
  type MirrorBand,
} from './eqMirror';

const band = (partial: Partial<MirrorBand> & Pick<MirrorBand, 'type'>): MirrorBand => ({
  id: 'b',
  frequency: 1000,
  ...partial,
});

describe('eqMirror band to biquad stages', () => {
  it('maps a high pass to one highpass stage per pass with its Q', () => {
    const stages = bandToStages(band({ type: 'HighPass', frequency: 120, q: 0.707, passes: 2 }));
    expect(stages).toHaveLength(2);
    for (const s of stages) {
      expect(s).toEqual({ type: 'highpass', frequency: 120, Q: 0.707, gain: 0 });
    }
  });

  it('treats zero or missing passes as one, and caps at four', () => {
    expect(stageCount(band({ type: 'LowPass', passes: 0 }))).toBe(1);
    expect(stageCount(band({ type: 'LowPass' }))).toBe(1);
    expect(stageCount(band({ type: 'LowPass', passes: 9 }))).toBe(4);
  });

  it('converts a bandwidth in Hz to Q for notch, band pass and peaking', () => {
    const notch = bandToStages(band({ type: 'BandReject', frequency: 60, width: 4 }));
    expect(notch[0].type).toBe('notch');
    expect(notch[0].Q).toBeCloseTo(15, 6);
    const peak = bandToStages(band({ type: 'Peaking', frequency: 2400, width: 600, gain: -4 }));
    expect(peak).toHaveLength(1);
    expect(peak[0]).toEqual({ type: 'peaking', frequency: 2400, Q: 4, gain: -4 });
    expect(widthToQ(1000, 0)).toBe(1000);
    expect(qToWidth(2400, 4)).toBeCloseTo(600, 6);
  });

  it('gives shelves their gain and a single stage regardless of passes', () => {
    const shelf = bandToStages(
      band({ type: 'HighShelf', frequency: 8000, q: 0.707, gain: 3, passes: 4 })
    );
    expect(shelf).toHaveLength(1);
    expect(shelf[0]).toEqual({ type: 'highshelf', frequency: 8000, Q: 0.707, gain: 3 });
  });

  it('drops a bypassed band and an entire disabled equalizer', () => {
    const bands = [
      band({ type: 'HighPass', frequency: 100, passes: 1 }),
      band({ type: 'Peaking', frequency: 1000, width: 200, gain: 2, bypass: true }),
      band({ type: 'LowPass', frequency: 15000, passes: 2 }),
    ];
    const stages = bandsToStages(bands);
    expect(stages.map(s => s.type)).toEqual(['highpass', 'lowpass', 'lowpass']);
    expect(bandsToStages(bands, false)).toEqual([]);
  });

  it('classifies which parameters each type takes', () => {
    expect(usesWidth('Peaking')).toBe(true);
    expect(usesWidth('HighPass')).toBe(false);
    expect(usesGain('LowShelf')).toBe(true);
    expect(usesGain('BandReject')).toBe(false);
    expect(usesPasses('BandReject')).toBe(true);
    expect(usesPasses('Peaking')).toBe(false);
  });
});
