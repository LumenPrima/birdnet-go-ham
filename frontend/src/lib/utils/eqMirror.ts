/**
 * Maps BirdNET-Go equalizer bands onto Web Audio biquad parameters.
 *
 * The station runs RBJ cookbook biquads (internal/audiocore/equalizer); Web Audio's
 * BiquadFilterNode implements the same cookbook, so one band becomes one node per pass
 * with the same type, centre frequency, Q and gain. Two conversions are needed:
 *  - band-pass, notch and peaking bands carry their bandwidth in Hz, which becomes Q = fc / width
 *    (the station converts Hz to octaves the same way the response graph does);
 *  - passes cascade, so a 24 dB/oct cut is two identical nodes in series.
 *
 * Pure functions only, so they are unit-testable without an AudioContext.
 */

import type { EqualizerFilter, EqualizerFilterType } from '$lib/stores/settings';

/** Web Audio node parameters for one biquad stage. */
export interface BiquadStage {
  type: BiquadFilterType;
  frequency: number;
  Q: number;
  gain: number;
}

/** A band as the mirror sees it: the stored filter plus a per-band bypass. */
export interface MirrorBand extends EqualizerFilter {
  bypass?: boolean;
}

const BUTTERWORTH_Q = 0.707;
const MIN_WIDTH_HZ = 1;
const MAX_PASSES = 4;

/** The Web Audio biquad type for a station filter type. */
export function nodeType(type: EqualizerFilterType): BiquadFilterType {
  switch (type) {
    case 'LowPass':
      return 'lowpass';
    case 'HighPass':
      return 'highpass';
    case 'BandPass':
      return 'bandpass';
    case 'BandReject':
      return 'notch';
    case 'LowShelf':
      return 'lowshelf';
    case 'HighShelf':
      return 'highshelf';
    case 'Peaking':
      return 'peaking';
  }
}

/** Types whose sharpness is given as a bandwidth in Hz rather than a Q. */
export function usesWidth(type: EqualizerFilterType): boolean {
  return type === 'BandPass' || type === 'BandReject' || type === 'Peaking';
}

/** Types that apply a dB gain. */
export function usesGain(type: EqualizerFilterType): boolean {
  return type === 'LowShelf' || type === 'HighShelf' || type === 'Peaking';
}

/** Types whose slope is set by cascading passes. */
export function usesPasses(type: EqualizerFilterType): boolean {
  return type === 'LowPass' || type === 'HighPass' || type === 'BandPass' || type === 'BandReject';
}

/** Q for a band given in Hz, as the station computes it. */
export function widthToQ(frequency: number, width: number): number {
  return frequency / Math.max(MIN_WIDTH_HZ, width);
}

/** Bandwidth in Hz for a Q, the inverse of widthToQ. */
export function qToWidth(frequency: number, q: number): number {
  return frequency / Math.max(q, 1e-6);
}

/** Number of biquad stages a band occupies: 1 for gain types, the pass count for cuts. */
export function stageCount(band: MirrorBand): number {
  if (!usesPasses(band.type)) return 1;
  const passes = band.passes ?? 1;
  return Math.min(MAX_PASSES, Math.max(1, passes));
}

/**
 * The biquad stages for one band, in series. Returns an empty list for a bypassed band, so a
 * caller can lay out the chain by concatenation.
 */
export function bandToStages(band: MirrorBand): BiquadStage[] {
  if (band.bypass) return [];
  const type = nodeType(band.type);
  const frequency = band.frequency;
  const Q = usesWidth(band.type)
    ? widthToQ(frequency, band.width ?? frequency)
    : (band.q ?? BUTTERWORTH_Q);
  const gain = usesGain(band.type) ? (band.gain ?? 0) : 0;
  const stage: BiquadStage = { type, frequency, Q, gain };
  return Array.from({ length: stageCount(band) }, () => ({ ...stage }));
}

/** Every stage of an equalizer, bands in order, bypassed bands skipped. */
export function bandsToStages(bands: MirrorBand[], enabled = true): BiquadStage[] {
  if (!enabled) return [];
  return bands.flatMap(bandToStages);
}
