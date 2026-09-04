/**
 * Real-time analyzer helpers for the equalizer console: turning an AnalyserNode's byte
 * spectrum into log-spaced dB bins that line up with a 20 Hz to 20 kHz curve, peak hold,
 * and RMS/peak meters from time-domain samples. Pure functions, unit-tested without audio.
 */

import type { EqualizerFilterType } from '$lib/stores/settings';
import type { FilterConfig } from './audio/dsp';
import type { MirrorBand } from './eqMirror';

/** AnalyserNode defaults for getByteFrequencyData: 0 maps to minDecibels, 255 to maxDecibels. */
export const ANALYSER_MIN_DB = -100;
export const ANALYSER_MAX_DB = -30;

/** Floor used for silence in dB conversions. */
export const SILENCE_DB = -100;

/** Log-spaced centre frequencies from fmin to fmax, n of them. */
export function logBinCenters(n: number, fmin = 20, fmax = 20000): Float32Array {
  const out = new Float32Array(n);
  const ratio = Math.log(fmax / fmin);
  for (let i = 0; i < n; i++) {
    out[i] = fmin * Math.exp((ratio * (i + 0.5)) / n);
  }
  return out;
}

/**
 * Resamples a byte spectrum onto log-spaced bins as dB. Each output bin takes the loudest FFT
 * bin inside its span, so narrow peaks survive at high frequencies where many FFT bins share
 * one log bin, and the nearest FFT bin at low frequencies where a log bin is narrower than
 * the FFT resolution.
 */
export function spectrumToLogBins(
  data: Uint8Array,
  sampleRate: number,
  fftSize: number,
  centers: Float32Array,
  minDb = ANALYSER_MIN_DB,
  maxDb = ANALYSER_MAX_DB
): Float32Array {
  const out = new Float32Array(centers.length);
  const binHz = sampleRate / fftSize;
  const n = centers.length;
  for (let i = 0; i < n; i++) {
    const lower =
      i === 0
        ? centers[0] / Math.sqrt(centers[1] / centers[0])
        : Math.sqrt(centers[i - 1] * centers[i]);
    const upper =
      i === n - 1
        ? centers[i] * Math.sqrt(centers[i] / centers[i - 1])
        : Math.sqrt(centers[i] * centers[i + 1]);
    let from = Math.floor(lower / binHz);
    let to = Math.ceil(upper / binHz);
    if (to <= from) to = from + 1;
    if (from < 0) from = 0;
    if (to > data.length) to = data.length;
    let best = 0;
    for (let b = from; b < to; b++) {
      const v = data.at(b) ?? 0;
      if (v > best) best = v;
    }
    out[i] = from >= data.length ? SILENCE_DB : minDb + (best / 255) * (maxDb - minDb);
  }
  return out;
}

/** Decays a held peak spectrum toward the current one by decayDb per call, rising instantly. */
export function peakHold(current: Float32Array, held: Float32Array, decayDb: number): Float32Array {
  const out = new Float32Array(current.length);
  for (let i = 0; i < current.length; i++) {
    const prev = held.at(i) ?? SILENCE_DB;
    const cur = current[i];
    out[i] = cur >= prev ? cur : Math.max(cur, prev - decayDb);
  }
  return out;
}

/** RMS and peak level in dBFS from byte time-domain samples (128 = zero). */
export function levelFromTimeDomain(data: Uint8Array): { rmsDb: number; peakDb: number } {
  if (data.length === 0) return { rmsDb: SILENCE_DB, peakDb: SILENCE_DB };
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = ((data.at(i) ?? 128) - 128) / 128;
    sum += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const rms = Math.sqrt(sum / data.length);
  const toDb = (x: number) => (x <= 0 ? SILENCE_DB : Math.max(SILENCE_DB, 20 * Math.log10(x)));
  return { rmsDb: toDb(rms), peakDb: toDb(peak) };
}

/** Builds the dsp.ts filter description for a band, by type, without casting. */
export function bandToFilterConfig(band: MirrorBand): FilterConfig {
  const type: EqualizerFilterType = band.type;
  switch (type) {
    case 'LowPass':
    case 'HighPass':
      return { type, frequency: band.frequency, q: band.q, passes: band.passes };
    case 'BandPass':
    case 'BandReject':
      return { type, frequency: band.frequency, width: band.width, q: band.q, passes: band.passes };
    case 'LowShelf':
    case 'HighShelf':
    case 'Peaking':
      return {
        type,
        frequency: band.frequency,
        q: band.q,
        width: band.width,
        gain: band.gain,
        passes: band.passes,
      };
  }
}

/** Formats a frequency for a console readout: 120 Hz, 2.4 kHz. */
export function formatHz(f: number): string {
  if (f >= 1000) {
    const k = f / 1000;
    return `${k >= 10 ? k.toFixed(1) : k.toFixed(2).replace(/0$/, '')} kHz`;
  }
  return `${Math.round(f)} Hz`;
}

/** Formats a dB value with sign: +3.0 dB, -4.5 dB, 0.0 dB. */
export function formatDb(db: number): string {
  const s = db.toFixed(1);
  return `${db > 0 ? '+' : ''}${s} dB`;
}
