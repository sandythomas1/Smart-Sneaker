import type { DemoCaptureConfig } from '../data/demo-artifact';

/**
 * Pure state derivation for the capture simulation (Req. 4). The view replays
 * the run options of a named seed session — the dropout windows below are the
 * same windows that produced the seeded session's capture gaps, so the
 * "Reconnecting…" moment the demo shows is the seeded data's own story.
 */

export interface CaptureFrame {
  elapsedMs: number;
  done: boolean;
  leftConnected: boolean;
  rightConnected: boolean;
  /** True while any shoe is dropped out mid-run. */
  reconnecting: boolean;
  /** Expected packet rate given the connected feet (per second). */
  packetsPerSecond: number;
}

export function frameAt(config: DemoCaptureConfig, elapsedMs: number): CaptureFrame {
  const clamped = Math.max(0, Math.min(elapsedMs, config.durationMs));
  const droppedOut = (foot: 'left' | 'right'): boolean =>
    config.dropouts.some((d) => d.foot === foot && clamped >= d.startMs && clamped <= d.endMs);

  const done = elapsedMs >= config.durationMs;
  const leftConnected = done || !droppedOut('left');
  const rightConnected = done || !droppedOut('right');
  const perFoot = 1000 / config.sampleIntervalMs;

  return {
    elapsedMs: clamped,
    done,
    leftConnected,
    rightConnected,
    reconnecting: !done && (!leftConnected || !rightConnected),
    packetsPerSecond:
      (done ? 0 : (leftConnected ? perFoot : 0) + (rightConnected ? perFoot : 0)),
  };
}

export function connectionLabel(frame: CaptureFrame): string {
  if (!frame.reconnecting) return 'Connected · Left + Right';
  if (frame.leftConnected) return 'Reconnecting · Right shoe';
  if (frame.rightConnected) return 'Reconnecting · Left shoe';
  return 'Reconnecting · Both shoes';
}
