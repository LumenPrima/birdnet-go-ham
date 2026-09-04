import { describe, it, expect } from 'vitest';
import { hlsStartPath, hlsStopPath } from './useHlsStream.svelte';

describe('useHlsStream endpoint paths', () => {
  it('encodes the source id and adds the raw flag only when asked', () => {
    const src = 'rtsp://10.0.0.5:8554/north_birdnet';
    expect(hlsStartPath(src)).toBe(`/api/v2/streams/hls/${encodeURIComponent(src)}/start`);
    expect(hlsStartPath(src, true)).toBe(
      `/api/v2/streams/hls/${encodeURIComponent(src)}/start?raw=true`
    );
    expect(hlsStopPath(src, true)).toBe(
      `/api/v2/streams/hls/${encodeURIComponent(src)}/stop?raw=true`
    );
    expect(hlsStopPath(src, false)).not.toContain('raw');
  });
});
