/**
 * Ports over the platform BLE stack (Req. 1). Production binds an adapter over
 * a native BLE library (e.g. react-native-ble-plx); tests bind the mock shoe
 * peripheral. Everything above these interfaces is platform-agnostic, which is
 * what lets T9's logic be built and tested before the firmware spec exists.
 */

/**
 * The service UUID the shoe advertises. PLACEHOLDER (16-bit User Data service
 * in the Bluetooth base UUID) until the firmware spec assigns a real custom
 * UUID — tracked with spec.md's open firmware-contract questions.
 */
export const SHOE_SERVICE_UUID = '0000181c-0000-1000-8000-00805f9b34fb';

export type Unsubscribe = () => void;

export interface DiscoveredPeripheral {
  id: string;
  name?: string;
  serviceUuids: readonly string[];
}

/** An open connection to one shoe. */
export interface ShoeConnection {
  /** Subscribe to raw sample packets (BLE notifications). */
  onSamplePacket(listener: (packet: Uint8Array) => void): Unsubscribe;
  /** Fires once when the link drops for any reason. */
  onDisconnect(listener: () => void): Unsubscribe;
  disconnect(): Promise<void>;
}

/** The phone's BLE central role: find shoes, open connections. */
export interface BleCentral {
  /** Peripherals visible within the scan window. */
  scan(timeoutMs: number): Promise<DiscoveredPeripheral[]>;
  /** Connect to a previously discovered peripheral; rejects if unreachable. */
  connect(peripheralId: string): Promise<ShoeConnection>;
}
