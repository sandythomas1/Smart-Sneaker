/** Per-key request limiter (Abuse Prevention NFR). */
export interface RateLimiter {
  /** True if the caller identified by `key` may proceed; false to reject with 429. */
  tryAcquire(key: string): boolean;
}

/**
 * Fixed-window in-memory limiter. Per-instance only: good enough for the
 * SHOULD-level abuse bound at PoC scale, NOT a shared quota across Cloud Run
 * instances — revisit with a shared store if the Scale NFR's growth arrives.
 */
export class FixedWindowRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { windowStartMs: number; count: number }>();

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs: number,
    private readonly nowMs: () => number = Date.now,
  ) {}

  tryAcquire(key: string): boolean {
    const now = this.nowMs();
    const window = this.windows.get(key);
    if (!window || now - window.windowStartMs >= this.windowMs) {
      this.pruneExpired(now);
      this.windows.set(key, { windowStartMs: now, count: 1 });
      return true;
    }
    if (window.count >= this.maxPerWindow) {
      return false;
    }
    window.count += 1;
    return true;
  }

  /** Drop stale windows so the map can't grow unboundedly across many keys. */
  private pruneExpired(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.windowStartMs >= this.windowMs) {
        this.windows.delete(key);
      }
    }
  }
}

/** No-op limiter for tests that aren't about rate limiting. */
export class AllowAllRateLimiter implements RateLimiter {
  tryAcquire(): boolean {
    return true;
  }
}
