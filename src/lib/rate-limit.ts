/**
 * rate-limit.ts — dependency-free, in-memory, fixed-window rate limiter.
 *
 * IMPORTANT — single-instance only:
 *   Buckets live in a `Map` in this process's memory. That means:
 *   - Limits are per-instance: with N server instances a caller effectively
 *     gets N x the configured limit, because instances never share buckets.
 *   - All buckets reset on restart / redeploy / cold start.
 *   This is acceptable for a single-instance prototype deployment and as a
 *   cheap first line of defence. For multi-instance production, replace the
 *   bucket store behind `createRateLimiter` with a shared store such as
 *   Redis / Upstash (same result shape, `check` becomes async) — callers and
 *   the {@link RateLimitResult} contract do not need to change.
 *
 * Buckets are cleaned up opportunistically (see `sweepExpired`) so the map
 * cannot grow without bound from one-off keys (e.g. distinct IPs).
 */

export interface RateLimitOptions {
  /** Max requests allowed per window for one key. Must be a positive integer. */
  limit: number;
  /** Window length in milliseconds. Must be positive. */
  windowMs: number;
}

export interface RateLimitResult {
  /** True when the request is within the limit and has been counted. */
  allowed: boolean;
  /** Requests still available in the current window (0 when blocked). */
  remaining: number;
  /** Seconds the caller should wait before retrying (0 when allowed). */
  retryAfterSeconds: number;
  /** Epoch milliseconds at which the current window resets. */
  resetAt: number;
  /** The configured limit that produced this result. */
  limit: number;
}

export interface RateLimiter {
  /**
   * Count one request for `key`. `now` (epoch ms) is injectable for tests;
   * it defaults to `Date.now()`.
   */
  check: (key: string, now?: number) => RateLimitResult;
  /** Forget one key, or every bucket when called with no argument. */
  reset: (key?: string) => void;
  /** Number of live (not-yet-swept) buckets — for tests/diagnostics only. */
  size: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Sweep at most once per interval, and only once the map is non-trivial. */
const SWEEP_MIN_BUCKETS = 128;
const SWEEP_INTERVAL_MS = 60_000;

function assertValidOptions(options: RateLimitOptions): void {
  if (!Number.isInteger(options.limit) || options.limit <= 0) {
    throw new RangeError('rate-limit: `limit` must be a positive integer');
  }
  if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
    throw new RangeError('rate-limit: `windowMs` must be a positive number');
  }
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  assertValidOptions(options);
  const { limit, windowMs } = options;
  const buckets = new Map<string, Bucket>();
  let lastSweepAt = 0;

  function sweepExpired(now: number): void {
    if (buckets.size < SWEEP_MIN_BUCKETS || now - lastSweepAt < SWEEP_INTERVAL_MS) {
      return;
    }
    lastSweepAt = now;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  function check(key: string, now: number = Date.now()): RateLimitResult {
    sweepExpired(now);

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    const resetAt = bucket.resetAt;
    if (bucket.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
        resetAt,
        limit,
      };
    }

    bucket.count += 1;
    return {
      allowed: true,
      remaining: limit - bucket.count,
      retryAfterSeconds: 0,
      resetAt,
      limit,
    };
  }

  function reset(key?: string): void {
    if (key === undefined) buckets.clear();
    else buckets.delete(key);
  }

  return { check, reset, size: () => buckets.size };
}

/** Default limits for the shared convenience limiter below. */
export const DEFAULT_RATE_LIMIT_OPTIONS: RateLimitOptions = {
  limit: 60,
  windowMs: 60_000,
};

/**
 * Shared limiters, one per (limit, windowMs) combination, so callers that
 * pass different options never share buckets by accident.
 */
const sharedLimiters = new Map<string, RateLimiter>();

function sharedLimiterFor(options: RateLimitOptions): RateLimiter {
  const cacheKey = `${options.limit}:${options.windowMs}`;
  let limiter = sharedLimiters.get(cacheKey);
  if (!limiter) {
    limiter = createRateLimiter(options);
    sharedLimiters.set(cacheKey, limiter);
  }
  return limiter;
}

/**
 * Convenience wrapper over a shared in-memory limiter.
 *
 * Coordinator usage (Next route handler):
 *   const result = checkRateLimit(`${getClientIp(req.headers)}:${actor.uid}`,
 *                                 { limit: 60, windowMs: 60_000 });
 *   if (!result.allowed) return NextResponse.json(..., { status: 429,
 *     headers: rateLimitHeaders(result) });
 */
export function checkRateLimit(
  key: string,
  options: RateLimitOptions = DEFAULT_RATE_LIMIT_OPTIONS,
  now?: number,
): RateLimitResult {
  return sharedLimiterFor(options).check(key, now);
}

/** Forget a key on the shared limiter for `options` (mainly for tests). */
export function resetRateLimit(
  key?: string,
  options: RateLimitOptions = DEFAULT_RATE_LIMIT_OPTIONS,
): void {
  sharedLimiterFor(options).reset(key);
}

/** Standard rate-limit response headers for a result (incl. `Retry-After` when blocked). */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };
  if (!result.allowed) headers['Retry-After'] = String(result.retryAfterSeconds);
  return headers;
}

/** Minimal structural type satisfied by `Headers` (and `NextRequest.headers`). */
export type HeaderGetter = Pick<Headers, 'get'>;

/**
 * Best-effort client IP from proxy headers, in order:
 * `x-forwarded-for` (first hop) -> `x-real-ip` -> `cf-connecting-ip`.
 *
 * Only trust these when the app sits behind a proxy that sets/strips them
 * (Vercel does); a directly exposed server can have them spoofed.
 * Returns `'unknown'` when no header carries an address.
 */
export function getClientIp(headers: HeaderGetter): string {
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  return (
    headers.get('x-real-ip')?.trim() ||
    headers.get('cf-connecting-ip')?.trim() ||
    'unknown'
  );
}
