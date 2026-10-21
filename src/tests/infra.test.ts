import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkRateLimit,
  createRateLimiter,
  getClientIp,
  rateLimitHeaders,
  resetRateLimit,
} from '../lib/rate-limit';
import {
  REQUEST_ID_HEADER,
  formatRequestLog,
  generateRequestId,
  getOrCreateRequestId,
  isValidRequestId,
  type RequestLogContext,
} from '../lib/request-id';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('rate-limit — fixed-window limiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests under the limit and counts remaining down', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    const now = 1_000_000;

    const first = limiter.check('ip:user-1', now);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);
    expect(first.retryAfterSeconds).toBe(0);
    expect(first.resetAt).toBe(now + 60_000);
    expect(first.limit).toBe(3);

    expect(limiter.check('ip:user-1', now).remaining).toBe(1);
    expect(limiter.check('ip:user-1', now).remaining).toBe(0);
  });

  it('blocks requests over the limit with retryAfterSeconds > 0', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    const now = 2_000_000;

    limiter.check('key', now);
    limiter.check('key', now);
    const blocked = limiter.check('key', now);

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBe(60);
    expect(blocked.resetAt).toBe(now + 60_000);

    const later = limiter.check('key', now + 30_000);
    expect(later.allowed).toBe(false);
    expect(later.retryAfterSeconds).toBe(30);
  });

  it('keeps separate keys independent', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    const now = 3_000_000;

    expect(limiter.check('user-a', now).allowed).toBe(true);
    expect(limiter.check('user-a', now).allowed).toBe(false);
    expect(limiter.check('user-b', now).allowed).toBe(true);
  });

  it('resets the window after it elapses (fake timers)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const limiter = createRateLimiter({ limit: 1, windowMs: 10_000 });

    expect(limiter.check('key').allowed).toBe(true);
    expect(limiter.check('key').allowed).toBe(false);

    vi.advanceTimersByTime(10_001);

    const afterReset = limiter.check('key');
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(0);
  });

  it('resets a single key on demand', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    const now = 4_000_000;
    limiter.check('key', now);
    expect(limiter.check('key', now).allowed).toBe(false);
    limiter.reset('key');
    expect(limiter.check('key', now).allowed).toBe(true);
  });

  it('rejects invalid options', () => {
    expect(() => createRateLimiter({ limit: 0, windowMs: 1_000 })).toThrow(RangeError);
    expect(() => createRateLimiter({ limit: 1, windowMs: 0 })).toThrow(RangeError);
  });

  it('shared checkRateLimit is keyed independently and resettable', () => {
    const options = { limit: 1, windowMs: 60_000 };
    resetRateLimit(undefined, options);
    expect(checkRateLimit('shared-a', options).allowed).toBe(true);
    expect(checkRateLimit('shared-a', options).allowed).toBe(false);
    expect(checkRateLimit('shared-b', options).allowed).toBe(true);
    resetRateLimit(undefined, options);
  });

  it('builds rate-limit headers, with Retry-After only when blocked', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    const allowed = rateLimitHeaders(limiter.check('key', 5_000_000));
    expect(allowed['X-RateLimit-Limit']).toBe('1');
    expect(allowed['Retry-After']).toBeUndefined();

    const blocked = rateLimitHeaders(limiter.check('key', 5_000_000));
    expect(blocked['Retry-After']).toBe('60');
  });
});

describe('rate-limit — getClientIp', () => {
  it('takes the first x-forwarded-for hop', () => {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.10, 70.41.3.18, 150.172.238.178',
      'x-real-ip': '198.51.100.20',
    });
    expect(getClientIp(headers)).toBe('203.0.113.10');
  });

  it('falls back to x-real-ip, then cf-connecting-ip, then unknown', () => {
    expect(getClientIp(new Headers({ 'x-real-ip': '198.51.100.20' }))).toBe(
      '198.51.100.20',
    );
    expect(getClientIp(new Headers({ 'cf-connecting-ip': '192.0.2.30' }))).toBe(
      '192.0.2.30',
    );
    expect(getClientIp(new Headers())).toBe('unknown');
  });
});

describe('request-id', () => {
  it('generates UUID-formatted IDs', () => {
    const id = generateRequestId();
    expect(id).toMatch(UUID_PATTERN);
    expect(isValidRequestId(id)).toBe(true);
    expect(generateRequestId()).not.toBe(id);
  });

  it('propagates a well-formed incoming x-request-id header', () => {
    const incoming = '123e4567-e89b-42d3-a456-426614174000';
    const headers = new Headers({ [REQUEST_ID_HEADER]: incoming });
    expect(getOrCreateRequestId(headers)).toBe(incoming);
  });

  it('generates a fresh UUID when the header is absent or malformed', () => {
    expect(getOrCreateRequestId(new Headers())).toMatch(UUID_PATTERN);
    expect(getOrCreateRequestId(null)).toMatch(UUID_PATTERN);
    // A HeaderGetter stub: a real Headers object rejects CRLF at construction,
    // but a hand-rolled header source could still hand us a malformed value.
    expect(
      getOrCreateRequestId({ get: () => 'bad id with spaces!!' }),
    ).toMatch(UUID_PATTERN);
    expect(
      getOrCreateRequestId(new Headers({ [REQUEST_ID_HEADER]: 'short' })),
    ).toMatch(UUID_PATTERN);
  });

  it('log formatter emits only whitelisted fields, never patient fields', () => {
    const context = {
      requestId: generateRequestId(),
      route: '/api/workspace',
      method: 'POST',
      status: 200,
      durationMs: 12.6,
      actorRole: 'doctor',
      actorUid: 'demo-doctor',
      // Stray fields a caller might pass by mistake must be dropped.
      patientName: 'Should Never Be Logged',
      patientId: 'PAT-RMP-1001',
      body: { fullName: 'Should Never Be Logged' },
    } as unknown as RequestLogContext;

    const line = formatRequestLog(context);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      ['actorRole', 'actorUid', 'durationMs', 'method', 'requestId', 'route', 'status'].sort(),
    );
    expect(parsed.durationMs).toBe(13);
    expect(line).not.toContain('Should Never Be Logged');
    expect(line).not.toContain('PAT-RMP-1001');
  });
});
