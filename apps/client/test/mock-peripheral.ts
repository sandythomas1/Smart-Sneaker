import type { SensorSample } from '@smart-sneaker/data-contracts';
import { encodeSamplePacket } from '../src/ble/packet';
import {
  BleCentral,
  DiscoveredPeripheral,
  SHOE_SERVICE_UUID,
  ShoeConnection,
  Unsubscribe,
} from '../src/ble/types';

/**
 * A simulated shoe (T9's soft-block workaround): a BleCentral over exactly one
 * peripheral that advertises the shoe service and streams the T1 Sample schema
 * as JSON packets. Mirrors the firmware behavior the spec implies:
 *
 * - `deliverUpTo(t)` transmits every scripted sample with timestampMs ≤ t.
 * - While disconnected, "transmitted" samples accumulate in an on-shoe buffer
 *   and are replayed on the next subscription (buffer/resume, Req. 2).
 * - `dropConnection(n)` severs the link and refuses the next n connect
 *   attempts, so tests control how long the outage lasts.
 */
export class MockShoePeripheral implements BleCentral {
  readonly id = 'mock-shoe-1';

  private readonly script: SensorSample[];
  private deliveredCount = 0;
  private onShoeBuffer: SensorSample[] = [];
  private packetListeners: Array<(packet: Uint8Array) => void> = [];
  private disconnectListeners: Array<() => void> = [];
  private connected = false;
  private connectRefusalsLeft = 0;
  connectAttempts = 0;

  constructor(script: readonly SensorSample[]) {
    this.script = [...script].sort((a, b) => a.timestampMs - b.timestampMs);
  }

  async scan(_timeoutMs: number): Promise<DiscoveredPeripheral[]> {
    return [
      { id: 'headphones-7', name: 'Headphones', serviceUuids: ['0000110b-0000-1000-8000-00805f9b34fb'] },
      { id: this.id, name: 'SmartSneaker', serviceUuids: [SHOE_SERVICE_UUID] },
    ];
  }

  async connect(peripheralId: string): Promise<ShoeConnection> {
    this.connectAttempts += 1;
    if (peripheralId !== this.id) {
      throw new Error(`unknown peripheral ${peripheralId}`);
    }
    if (this.connectRefusalsLeft > 0) {
      this.connectRefusalsLeft -= 1;
      throw new Error('shoe unreachable');
    }
    this.connected = true;
    return {
      onSamplePacket: (listener): Unsubscribe => {
        this.packetListeners.push(listener);
        this.flushOnShoeBuffer(); // firmware replays what it buffered while unreachable
        return () => {
          this.packetListeners = this.packetListeners.filter((l) => l !== listener);
        };
      },
      onDisconnect: (listener): Unsubscribe => {
        this.disconnectListeners.push(listener);
        return () => {
          this.disconnectListeners = this.disconnectListeners.filter((l) => l !== listener);
        };
      },
      disconnect: async () => {
        this.connected = false;
        this.packetListeners = [];
        this.disconnectListeners = [];
      },
    };
  }

  /** Transmit all scripted samples up to and including tMs (session-relative). */
  deliverUpTo(tMs: number): void {
    while (this.deliveredCount < this.script.length) {
      const sample = this.script[this.deliveredCount];
      if (!sample || sample.timestampMs > tMs) break;
      this.deliveredCount += 1;
      this.transmit(sample);
    }
  }

  /** Sever the link; the next `refuseConnectAttempts` reconnects fail. */
  dropConnection(refuseConnectAttempts = 0): void {
    this.connected = false;
    this.connectRefusalsLeft = refuseConnectAttempts;
    const listeners = this.disconnectListeners;
    this.packetListeners = [];
    this.disconnectListeners = [];
    for (const listener of listeners) listener();
  }

  /** Inject an arbitrary (e.g. corrupt) packet, bypassing the sample script. */
  transmitRaw(packet: Uint8Array): void {
    if (!this.connected) return;
    for (const listener of this.packetListeners) listener(packet);
  }

  private transmit(sample: SensorSample): void {
    if (this.connected && this.packetListeners.length > 0) {
      const packet = encodeSamplePacket(sample);
      for (const listener of this.packetListeners) listener(packet);
    } else {
      this.onShoeBuffer.push(sample);
    }
  }

  private flushOnShoeBuffer(): void {
    const buffered = this.onShoeBuffer;
    this.onShoeBuffer = [];
    for (const sample of buffered) {
      this.transmit(sample);
    }
  }
}
