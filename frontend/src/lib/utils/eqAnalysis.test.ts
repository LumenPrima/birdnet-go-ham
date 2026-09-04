import { describe, it, expect } from 'vitest';
import {
  ANALYSER_MAX_DB,
  ANALYSER_MIN_DB,
  SILENCE_DB,
  bandToFilterConfig,
  formatDb,
  formatHz,
  levelFromTimeDomain,
  logBinCenters,
  peakHold,
  spectrumToLogBins,
} from './eqAnalysis';

describe('eqAnalysis', () => {
  it('spaces bin centres logarithmically between the bounds', () => {
    const c = logBinCenters(4, 20, 20000);
    expect(c[0]).toBeGreaterThan(20);
    expect(c[3]).toBeLessThan(20000);
    const r1 = c[1] / c[0];
    const r2 = c[2] / c[1];
    expect(r1).toBeCloseTo(r2, 6);
  });

  it('maps a byte spectrum onto log bins as dB, keeping narrow peaks', () => {
    const sampleRate = 48000;
    const fftSize = 1024; // 46.9 Hz per bin
    const data = new Uint8Array(fftSize / 2);
    data[Math.round(1000 / (sampleRate / fftSize))] = 255; // a 1 kHz tone at full scale
    const centers = logBinCenters(64);
    const db = spectrumToLogBins(data, sampleRate, fftSize, centers);
    const loudest = db.indexOf(Math.max(...db));
    expect(centers[loudest]).toBeGreaterThan(800);
    expect(centers[loudest]).toBeLessThan(1250);
    expect(db[loudest]).toBeCloseTo(ANALYSER_MAX_DB, 6);
    expect(db[0]).toBeCloseTo(ANALYSER_MIN_DB, 6);
  });

  it('holds peaks and lets them decay by the given amount', () => {
    const held = peakHold(new Float32Array([-50, -50]), new Float32Array([-40, -60]), 3);
    expect(held[0]).toBeCloseTo(-43, 6); // decaying toward the current -50
    expect(held[1]).toBeCloseTo(-50, 6); // current is louder than held: rises at once
  });

  it('measures RMS and peak from centred bytes', () => {
    const silent = levelFromTimeDomain(new Uint8Array(64).fill(128));
    expect(silent.rmsDb).toBe(SILENCE_DB);
    const square = new Uint8Array(64);
    for (let i = 0; i < 64; i++) square[i] = i % 2 ? 255 : 0;
    const loud = levelFromTimeDomain(square);
    expect(loud.peakDb).toBeCloseTo(0, 1);
    expect(loud.rmsDb).toBeCloseTo(0, 1);
  });

  it('builds a typed filter description per band family', () => {
    expect(
      bandToFilterConfig({ id: 'a', type: 'HighPass', frequency: 100, q: 0.7, passes: 2 })
    ).toEqual({
      type: 'HighPass',
      frequency: 100,
      q: 0.7,
      passes: 2,
    });
    expect(
      bandToFilterConfig({ id: 'b', type: 'Peaking', frequency: 1000, width: 200, gain: -3 })
    ).toMatchObject({
      type: 'Peaking',
      width: 200,
      gain: -3,
    });
  });

  it('formats readouts the way a console does', () => {
    expect(formatHz(120)).toBe('120 Hz');
    expect(formatHz(2400)).toBe('2.4 kHz');
    expect(formatHz(12500)).toBe('12.5 kHz');
    expect(formatDb(3)).toBe('+3.0 dB');
    expect(formatDb(-4.5)).toBe('-4.5 dB');
    expect(formatDb(0)).toBe('0.0 dB');
  });
});
