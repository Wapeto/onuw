export interface RateLimiterOptions {
  capacity: number;
  refillMs: number;
  now?: () => number;
}

export interface RateLimiter {
  tryConsume(): boolean;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { capacity, refillMs, now = Date.now } = options;
  let tokens = capacity;
  let lastRefill = now();

  function refill(): void {
    const elapsed = now() - lastRefill;
    if (elapsed < refillMs) return;
    const refilled = Math.floor(elapsed / refillMs);
    tokens = Math.min(capacity, tokens + refilled);
    lastRefill += refilled * refillMs;
  }

  return {
    tryConsume(): boolean {
      refill();
      if (tokens <= 0) return false;
      tokens -= 1;
      return true;
    },
  };
}
