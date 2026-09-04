/**
 * One live HLS audio stream from the station, as a reactive composable: start, heartbeat,
 * stop, with hls.js where it is supported and native HLS on Safari. Extracted from the
 * dashboard's live spectrogram widget so the equalizer monitor can share the exact
 * lifecycle, including the `raw` variant that bypasses the station's equalizer.
 *
 * The composable owns the audio element; callers hand it to an analyser after `start`
 * resolves, and must call `stop` (or let the owning component unmount) to release the
 * server-side stream.
 */

import Hls from 'hls.js';
import { fetchWithCSRF } from './api';
import { buildAppUrl } from './urlHelpers';
import { generateSessionId } from './session';
import { loggers } from './logger';
import { HLS_AUDIO_CONFIG } from '$lib/desktop/components/ui/hls-config';

const logger = loggers.audio;

/** Seconds between heartbeats; the server's idle timeout is several times this. */
const HEARTBEAT_INTERVAL_MS = 20000;

export type HlsStreamState = 'idle' | 'connecting' | 'live' | 'error';

export interface HlsStartOptions {
  /** Audio source id as listed by the station. */
  sourceId: string;
  /** Bypass the station's equalizer for this listener (browser-side EQ monitor). */
  raw?: boolean;
}

interface HlsStartResponse {
  status: string;
  stream_token: string;
  playlist_url: string;
  playlist_ready: boolean;
  raw?: boolean;
}

/** Path of the start endpoint for a source, with the raw flag when requested. */
export function hlsStartPath(sourceId: string, raw = false): string {
  const base = `/api/v2/streams/hls/${encodeURIComponent(sourceId)}/start`;
  return raw ? `${base}?raw=true` : base;
}

/** Path of the stop endpoint, matching the raw flag the stream was started with. */
export function hlsStopPath(sourceId: string, raw = false): string {
  const base = `/api/v2/streams/hls/${encodeURIComponent(sourceId)}/stop`;
  return raw ? `${base}?raw=true` : base;
}

export function useHlsStream() {
  const sessionId = generateSessionId();

  let state = $state<HlsStreamState>('idle');
  let audioElement = $state<HTMLAudioElement | null>(null);
  let error = $state<string | null>(null);
  let activeSourceId = $state<string | null>(null);
  let activeRaw = $state(false);

  let hls: Hls | null = null;
  let streamToken: string | null = null;
  let heartbeatTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  let abortController: AbortController | null = null;

  function startHeartbeat(token: string): void {
    stopHeartbeat();
    const send = async () => {
      try {
        await fetchWithCSRF('/api/v2/streams/hls/heartbeat', {
          method: 'POST',
          body: { stream_token: token, session_id: sessionId },
        });
      } catch {
        /* a missed heartbeat is retried on the next tick; the server tolerates several */
      }
    };
    heartbeatTimer = globalThis.setInterval(send, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      globalThis.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  /**
   * Starts the stream and resolves with the audio element once it is playing (or as soon as
   * the manifest is parsed when autoplay is blocked). Rejects when the browser cannot play
   * HLS or the server refuses.
   */
  async function start(options: HlsStartOptions): Promise<HTMLAudioElement> {
    stop();
    state = 'connecting';
    error = null;
    const controller = new AbortController();
    abortController = controller;
    const { signal } = controller;
    const raw = options.raw ?? false;

    activeSourceId = options.sourceId;
    activeRaw = raw;
    const data = await fetchWithCSRF<HlsStartResponse>(hlsStartPath(options.sourceId, raw), {
      method: 'POST',
      signal,
      body: { session_id: sessionId },
    });
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    streamToken = data.stream_token;
    const hlsUrl = buildAppUrl(data.playlist_url);

    const element = new globalThis.Audio();
    // Required for createMediaElementSource on a cross-origin-capable element.
    element.crossOrigin = 'anonymous';
    audioElement = element;

    if (Hls.isSupported()) {
      await new Promise<void>((resolve, reject) => {
        const instance = new Hls(HLS_AUDIO_CONFIG);
        hls = instance;
        instance.on(Hls.Events.MANIFEST_PARSED, () => {
          if (signal.aborted) return;
          element.play().catch(() => {
            /* autoplay blocked until a gesture; the graph still connects */
          });
          resolve();
        });
        instance.on(Hls.Events.ERROR, (_event, info) => {
          if (signal.aborted) return;
          if (info.fatal) {
            logger.error('HLS stream fatal error', { type: info.type, details: info.details });
            error = info.details;
            state = 'error';
            reject(new Error(info.details));
            stopRuntime();
          }
        });
        instance.loadSource(hlsUrl);
        instance.attachMedia(element);
      });
    } else if (element.canPlayType('application/vnd.apple.mpegurl')) {
      element.src = hlsUrl;
      await element.play().catch(() => {
        /* autoplay blocked until a gesture */
      });
    } else {
      stopRuntime();
      state = 'error';
      error = 'unsupported';
      throw new Error('HLS not supported by this browser');
    }
    if (abortController !== controller) throw new DOMException('aborted', 'AbortError');
    startHeartbeat(data.stream_token);
    state = 'live';
    return element;
  }

  function stopRuntime(): void {
    abortController?.abort();
    abortController = null;
    if (activeSourceId) {
      fetchWithCSRF(hlsStopPath(activeSourceId, activeRaw), {
        method: 'POST',
        keepalive: true,
        body: { session_id: sessionId },
      }).catch(() => {});
      activeSourceId = null;
    }
    if (streamToken) {
      fetchWithCSRF('/api/v2/streams/hls/heartbeat?disconnect=true', {
        method: 'POST',
        keepalive: true,
        body: { stream_token: streamToken, session_id: sessionId },
      }).catch(() => {});
      streamToken = null;
    }
    stopHeartbeat();
    if (hls) {
      hls.destroy();
      hls = null;
    }
    if (audioElement) {
      audioElement.pause();
      audioElement.removeAttribute('src');
      audioElement = null;
    }
  }

  function stop(): void {
    stopRuntime();
    state = 'idle';
  }

  $effect(() => {
    return () => stop();
  });

  return {
    get state() {
      return state;
    },
    get error() {
      return error;
    },
    get audioElement() {
      return audioElement;
    },
    get sourceId() {
      return activeSourceId;
    },
    get raw() {
      return activeRaw;
    },
    start,
    stop,
  };
}
