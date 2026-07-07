import { generateSyntheticRun } from '@smart-sneaker/insights-engine';
import { decodeSamplePacket, encodeSamplePacket } from '../src/ble/packet';
import { discoverShoePeripheral, ShoeNotFoundError } from '../src/ble/discovery';
import {
  DEFAULT_DISCONNECT_TOLERANCE_MS,
  RecordingFailedError,
  SessionRecorder,
} from '../src/ble/session-recorder';
import { InMemoryLocalSessionStore } from '../src/storage/session-store';
import { BleCentral, SHOE_SERVICE_UUID } from '../src/ble/types';
import { MockShoePeripheral } from './mock-peripheral';

/** ~171 steps/min, 200ms contacts, 100 Hz, dual foot — the engine fixtures' clean-run shape. */
const CLEAN_RUN = {
  durationMs: 10_000,
  strideIntervalMs: 700,
  contactMs: 200,
  sampleIntervalMs: 10,
  rightFootOffsetMs: 350,
};

const SESSION_ID = '4c1f8a6e-2b3d-4e5f-8a9b-0c1d2e3f4a5b';

/** Deterministic time: sleeping advances the clock, nothing waits on real timers. */
class FakeClock {
  private t = 1_750_000_000_000;
  readonly now = (): number => this.t;
  readonly sleep = async (ms: number): Promise<void> => {
    this.t += ms;
  };
}

function buildRecorder(central: BleCentral, clock = new FakeClock()) {
  return new SessionRecorder({
    central,
    sportProfileId: 'running-v1',
    now: clock.now,
    sleep: clock.sleep,
    newSessionId: () => SESSION_ID,
  });
}

/** Let the recorder's async reconnect loop make progress until it reaches `status`. */
async function waitForStatus(recorder: SessionRecorder, status: string): Promise<void> {
  for (let i = 0; i < 10_000; i++) {
    if (recorder.status === status) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`recorder never reached status "${status}" (still "${recorder.status}")`);
}

describe('sample packet codec (placeholder wire format)', () => {
  const sample = generateSyntheticRun(CLEAN_RUN).session.samples[0]!;

  it('round-trips a sample', () => {
    expect(decodeSamplePacket(encodeSamplePacket(sample))).toEqual({ ok: true, data: sample });
  });

  it.each([
    ['not UTF-8', new Uint8Array([0xff, 0xfe, 0x00, 0xff])],
    ['not JSON', new TextEncoder().encode('{{{{')],
    ['contract-invalid', new TextEncoder().encode(JSON.stringify({ timestampMs: -1 }))],
  ])('rejects a %s packet with issues instead of throwing', (_label, packet) => {
    const result = decodeSamplePacket(packet);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe('shoe discovery', () => {
  it('finds the peripheral advertising the shoe service among others', async () => {
    const shoe = new MockShoePeripheral([]);
    const found = await discoverShoePeripheral(shoe);
    expect(found.id).toBe(shoe.id);
    expect(found.serviceUuids).toContain(SHOE_SERVICE_UUID);
  });

  it('throws an actionable error when no shoe is in range', async () => {
    const central: BleCentral = {
      scan: async () => [{ id: 'x', serviceUuids: ['0000110b-0000-1000-8000-00805f9b34fb'] }],
      connect: async () => {
        throw new Error('unused');
      },
    };
    await expect(discoverShoePeripheral(central)).rejects.toThrow(ShoeNotFoundError);
  });
});

describe('session recording (Req. 1-2, 5, 8)', () => {
  it('reconstructs a complete, time-ordered session from a full simulated stream', async () => {
    const run = generateSyntheticRun(CLEAN_RUN);
    const shoe = new MockShoePeripheral(run.session.samples);
    const recorder = buildRecorder(shoe);

    await recorder.start(shoe.id);
    shoe.deliverUpTo(CLEAN_RUN.durationMs);
    const recording = await recorder.stop();

    expect(recording.endedBy).toBe('stop-requested');
    expect(recording.droppedPacketCount).toBe(0);
    expect(recording.session.sessionId).toBe(SESSION_ID);
    expect(recording.session.samples).toHaveLength(run.session.samples.length);
    const timestamps = recording.session.samples.map((s) => s.timestampMs);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  it('survives a disconnect within tolerance without losing or corrupting the session', async () => {
    const run = generateSyntheticRun(CLEAN_RUN);
    const shoe = new MockShoePeripheral(run.session.samples);
    const clock = new FakeClock();
    const recorder = buildRecorder(shoe, clock);

    await recorder.start(shoe.id);
    shoe.deliverUpTo(3_000);

    // Link drops; the first two reconnect attempts fail (~0.5s simulated outage).
    shoe.dropConnection(2);
    // The shoe keeps sampling while unreachable — these buffer on-shoe.
    shoe.deliverUpTo(6_000);
    await waitForStatus(recorder, 'recording');

    // Post-reconnect, the buffer has been replayed; stream the rest live.
    shoe.deliverUpTo(CLEAN_RUN.durationMs);
    const recording = await recorder.stop();

    expect(recording.session.samples).toHaveLength(run.session.samples.length);
    const timestamps = recording.session.samples.map((s) => s.timestampMs);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    // No duplicates from the replay: (foot, timestamp) pairs are unique.
    const keys = recording.session.samples.map((s) => `${s.foot}|${s.timestampMs}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ends the recording, preserving received data, when the outage exceeds the 30s tolerance', async () => {
    const run = generateSyntheticRun(CLEAN_RUN);
    const shoe = new MockShoePeripheral(run.session.samples);
    const clock = new FakeClock();
    const recorder = buildRecorder(shoe, clock);

    await recorder.start(shoe.id);
    shoe.deliverUpTo(3_000);
    const deliveredSoFar = recorder.sampleCount;

    shoe.dropConnection(Number.MAX_SAFE_INTEGER);
    await waitForStatus(recorder, 'ended');

    const recording = await recorder.stop();
    expect(recording.endedBy).toBe('disconnect-tolerance-exceeded');
    expect(recording.warnings.join(' ')).toContain(`${DEFAULT_DISCONNECT_TOLERANCE_MS}ms`);
    // Everything received before the outage is intact.
    expect(recording.session.samples).toHaveLength(deliveredSoFar);
  });

  it('drops corrupt packets and reports them, without aborting the session', async () => {
    const run = generateSyntheticRun(CLEAN_RUN);
    const shoe = new MockShoePeripheral(run.session.samples);
    const recorder = buildRecorder(shoe);

    await recorder.start(shoe.id);
    shoe.deliverUpTo(2_000);
    shoe.transmitRaw(new TextEncoder().encode('garbage'));
    shoe.deliverUpTo(CLEAN_RUN.durationMs);
    const recording = await recorder.stop();

    expect(recording.droppedPacketCount).toBe(1);
    expect(recording.warnings.join(' ')).toContain('failed validation');
    expect(recording.session.samples).toHaveLength(run.session.samples.length);
  });

  it('tags a recording with labels/known conditions (Req. 8)', async () => {
    const shoe = new MockShoePeripheral(generateSyntheticRun(CLEAN_RUN).session.samples);
    const recorder = buildRecorder(shoe);

    await recorder.start(shoe.id);
    shoe.deliverUpTo(CLEAN_RUN.durationMs);
    const recording = await recorder.stop({
      labels: { conditions: ['favor-left-leg', 'pace-5min-km'], notes: 'protocol run 3' },
    });

    expect(recording.session.labels).toEqual({
      conditions: ['favor-left-leg', 'pace-5min-km'],
      notes: 'protocol run 3',
    });
  });

  it('rejects contract-invalid labels with a descriptive error', async () => {
    const shoe = new MockShoePeripheral(generateSyntheticRun(CLEAN_RUN).session.samples);
    const recorder = buildRecorder(shoe);
    await recorder.start(shoe.id);
    shoe.deliverUpTo(CLEAN_RUN.durationMs);

    await expect(recorder.stop({ labels: { conditions: [] } })).rejects.toThrow(
      RecordingFailedError,
    );
  });

  it('fails loudly when nothing was received, and guards against reuse', async () => {
    const shoe = new MockShoePeripheral([]);
    const recorder = buildRecorder(shoe);
    await expect(recorder.stop()).rejects.toThrow('never started');

    await recorder.start(shoe.id);
    await expect(recorder.start(shoe.id)).rejects.toThrow('already started');
    await expect(recorder.stop()).rejects.toThrow('no samples were received');
  });
});

describe('local session persistence (Req. 5)', () => {
  it('holds sessions until explicitly removed after confirmed sync', async () => {
    const store = new InMemoryLocalSessionStore();
    const first = generateSyntheticRun(CLEAN_RUN).session;
    const second = {
      ...generateSyntheticRun(CLEAN_RUN).session,
      sessionId: '9a8b7c6d-5e4f-4a3b-8c9d-0e1f2a3b4c5d',
      startedAtMs: first.startedAtMs + 86_400_000,
    };

    await store.save(second);
    await store.save(first);
    expect(await store.get(first.sessionId)).toEqual(first);
    expect((await store.list()).map((s) => s.sessionId)).toEqual([
      first.sessionId,
      second.sessionId,
    ]);

    await store.remove(first.sessionId);
    expect(await store.get(first.sessionId)).toBeNull();
  });
});
