import { FixedWindowRateLimiter } from '../src/rate-limit';

describe('FixedWindowRateLimiter', () => {
  it('allows up to the limit within a window, then blocks', () => {
    const limiter = new FixedWindowRateLimiter(3, 1000, () => 0);
    expect(limiter.tryAcquire('a')).toBe(true);
    expect(limiter.tryAcquire('a')).toBe(true);
    expect(limiter.tryAcquire('a')).toBe(true);
    expect(limiter.tryAcquire('a')).toBe(false);
  });

  it('resets when the window elapses', () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter(1, 1000, () => now);
    expect(limiter.tryAcquire('a')).toBe(true);
    expect(limiter.tryAcquire('a')).toBe(false);
    now = 1000;
    expect(limiter.tryAcquire('a')).toBe(true);
  });

  it('tracks keys independently — one noisy account cannot exhaust another’s quota', () => {
    const limiter = new FixedWindowRateLimiter(1, 1000, () => 0);
    expect(limiter.tryAcquire('a')).toBe(true);
    expect(limiter.tryAcquire('a')).toBe(false);
    expect(limiter.tryAcquire('b')).toBe(true);
  });

  it('prunes expired windows without disturbing active ones', () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter(2, 1000, () => now);
    limiter.tryAcquire('stale');
    now = 500;
    limiter.tryAcquire('active');
    now = 1600; // 'stale' and 'active' both expired; new key triggers pruning
    expect(limiter.tryAcquire('fresh')).toBe(true);
    expect(limiter.tryAcquire('active')).toBe(true); // gets a fresh window, not a stale count
  });
});
