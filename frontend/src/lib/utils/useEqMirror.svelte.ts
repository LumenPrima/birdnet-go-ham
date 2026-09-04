/**
 * A browser-side mirror of the station's equalizer: a cascade of BiquadFilterNodes that
 * plays the listener's proposed bands over a raw monitor stream, so a change is heard at
 * once instead of after the station's HLS delay. It plugs into useSpectrogramAnalyser's
 * insert point (between its rumble filter and its gain).
 *
 * Node parameters are updated in place with short ramps when the band count and types are
 * unchanged, which is the common case while dragging; adding, removing or retyping a band
 * rebuilds the cascade.
 */

import { untrack } from 'svelte';
import { bandsToStages, type BiquadStage, type MirrorBand } from './eqMirror';
import type { AnalyserInsert } from './useSpectrogramAnalyser.svelte';

/** Seconds over which a parameter change is ramped, enough to hide zipper noise. */
const PARAM_RAMP_SECONDS = 0.02;

export function useEqMirror() {
  let bands = $state<MirrorBand[]>([]);
  let enabled = $state(true);
  let stageCountApplied = $state(0);

  let audioContext: AudioContext | null = null;
  let input: GainNode | null = null;
  let output: GainNode | null = null;
  let nodes: BiquadFilterNode[] = [];

  function rebuild(stages: BiquadStage[]): void {
    if (!audioContext || !input || !output) return;
    const ctx = audioContext;
    for (const node of nodes) node.disconnect();
    input.disconnect();
    nodes = stages.map(stage => {
      const node = ctx.createBiquadFilter();
      node.type = stage.type;
      node.frequency.value = stage.frequency;
      node.Q.value = stage.Q;
      node.gain.value = stage.gain;
      return node;
    });
    let previous: AudioNode = input;
    for (const node of nodes) {
      previous.connect(node);
      previous = node;
    }
    previous.connect(output);
    stageCountApplied = nodes.length;
  }

  function sameShape(stages: BiquadStage[]): boolean {
    return stages.length === nodes.length && stages.every((s, i) => nodes.at(i)?.type === s.type);
  }

  function ramp(param: AudioParam, value: number): void {
    if (!audioContext) return;
    const now = audioContext.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + PARAM_RAMP_SECONDS);
  }

  // Callers drive setBands/setEnabled from their own effects; reading the mirror's state
  // here must not subscribe that effect to what it just wrote, or it re-runs forever.
  function currentStages(): BiquadStage[] {
    return untrack(() => bandsToStages(bands, enabled));
  }

  function apply(): void {
    const stages = currentStages();
    if (!audioContext) return;
    if (!sameShape(stages)) {
      rebuild(stages);
      return;
    }
    stages.forEach((stage, i) => {
      const node = nodes.at(i);
      if (!node) return;
      ramp(node.frequency, stage.frequency);
      ramp(node.Q, stage.Q);
      ramp(node.gain, stage.gain);
    });
  }

  /** The insert useSpectrogramAnalyser calls when it builds its graph. */
  const insert: AnalyserInsert = ctx => {
    audioContext = ctx;
    input = ctx.createGain();
    output = ctx.createGain();
    nodes = [];
    rebuild(currentStages());
    return { input, output };
  };

  function setBands(next: MirrorBand[]): void {
    bands = next;
    apply();
  }

  function setEnabled(next: boolean): void {
    enabled = next;
    apply();
  }

  function destroy(): void {
    for (const node of nodes) node.disconnect();
    input?.disconnect();
    output?.disconnect();
    nodes = [];
    input = null;
    output = null;
    audioContext = null;
    stageCountApplied = 0;
  }

  $effect(() => {
    return () => destroy();
  });

  return {
    get bands() {
      return bands;
    },
    get enabled() {
      return enabled;
    },
    /** Number of biquad stages currently in the cascade (0 when bypassed or idle). */
    get stageCount() {
      return stageCountApplied;
    },
    insert,
    setBands,
    setEnabled,
    destroy,
  };
}
