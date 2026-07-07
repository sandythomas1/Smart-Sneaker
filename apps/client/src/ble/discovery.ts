import { BleCentral, DiscoveredPeripheral, SHOE_SERVICE_UUID } from './types';

/** No shoe was advertising within the scan window — a normal, user-facing condition, not a crash. */
export class ShoeNotFoundError extends Error {
  constructor() {
    super('No shoe found nearby. Make sure the shoe is on and in range, then try again.');
    this.name = 'ShoeNotFoundError';
  }
}

export const DEFAULT_SCAN_TIMEOUT_MS = 5_000;

/**
 * Find a shoe to record from (Req. 1): scan and keep only peripherals
 * advertising the shoe service. Returns the first match — picking between
 * multiple shoes (or pairing left+right, an open spec question) is a UX
 * decision deferred with the dual-shoe question.
 */
export async function discoverShoePeripheral(
  central: BleCentral,
  scanTimeoutMs: number = DEFAULT_SCAN_TIMEOUT_MS,
): Promise<DiscoveredPeripheral> {
  const peripherals = await central.scan(scanTimeoutMs);
  const shoe = peripherals.find((p) => p.serviceUuids.includes(SHOE_SERVICE_UUID));
  if (!shoe) {
    throw new ShoeNotFoundError();
  }
  return shoe;
}
