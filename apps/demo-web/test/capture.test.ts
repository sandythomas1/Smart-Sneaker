import type { DemoCaptureConfig } from '../src/data/demo-artifact';
import { connectionLabel, frameAt } from '../src/capture/replay';

const CONFIG: DemoCaptureConfig = {
  sourceSlug: 'fixture-capture',
  durationMs: 45_000,
  strideIntervalMs: 700,
  contactMs: 250,
  sampleIntervalMs: 10,
  rightFootOffsetMs: 350,
  dropouts: [{ foot: 'right', startMs: 20_000, endMs: 22_000 }],
};

describe('capture replay frames', () => {
  it('reports both shoes connected at full packet rate outside dropouts', () => {
    const frame = frameAt(CONFIG, 5_000);
    expect(frame).toMatchObject({
      leftConnected: true,
      rightConnected: true,
      reconnecting: false,
      done: false,
    });
    expect(frame.packetsPerSecond).toBe(200); // 100 Hz × 2 feet
    expect(connectionLabel(frame)).toBe('Connected · Left + Right');
  });

  it('enters the reconnecting state during the seeded dropout window', () => {
    const frame = frameAt(CONFIG, 21_000);
    expect(frame.rightConnected).toBe(false);
    expect(frame.leftConnected).toBe(true);
    expect(frame.reconnecting).toBe(true);
    expect(frame.packetsPerSecond).toBe(100);
    expect(connectionLabel(frame)).toBe('Reconnecting · Right shoe');
  });

  it('recovers after the dropout ends', () => {
    expect(frameAt(CONFIG, 22_500).reconnecting).toBe(false);
  });

  it('completes at the seeded duration and clamps elapsed time', () => {
    const frame = frameAt(CONFIG, 60_000);
    expect(frame.done).toBe(true);
    expect(frame.elapsedMs).toBe(45_000);
    expect(frame.reconnecting).toBe(false);
    expect(frame.packetsPerSecond).toBe(0);
  });

  it('never returns a negative elapsed time', () => {
    expect(frameAt(CONFIG, -100).elapsedMs).toBe(0);
  });
});
