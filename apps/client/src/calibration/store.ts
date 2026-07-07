import type { Calibration } from '@smart-sneaker/data-contracts';

/**
 * Local persistence for calibrations (Req. 13): one current calibration per
 * capture device; re-running the routine replaces it. Production binds a
 * React Native storage adapter alongside the session store's; tests and
 * development use the in-memory store.
 */
export interface CalibrationStore {
  save(calibration: Calibration): Promise<void>;
  getForDevice(deviceId: string): Promise<Calibration | null>;
}

/** In-memory CalibrationStore for unit tests and local development. */
export class InMemoryCalibrationStore implements CalibrationStore {
  private readonly byDevice = new Map<string, Calibration>();

  async save(calibration: Calibration): Promise<void> {
    this.byDevice.set(calibration.deviceId, calibration);
  }

  async getForDevice(deviceId: string): Promise<Calibration | null> {
    return this.byDevice.get(deviceId) ?? null;
  }
}
