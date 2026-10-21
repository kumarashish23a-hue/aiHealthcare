/**
 * request-id.ts — generate / propagate a request ID per API request.
 *
 * The ID travels in the `x-request-id` header: an incoming ID from a trusted
 * caller/proxy is propagated (so logs can be correlated end-to-end),
 * otherwise a fresh UUID is generated. Coordinator usage (Next route handler):
 *
 *   const requestId = getOrCreateRequestId(req.headers);
 *   // ... handle ...
 *   const res = NextResponse.json(body, { status });
 *   res.headers.set(REQUEST_ID_HEADER, requestId);
 *   logRequest({ requestId, route: '/api/workspace', method: req.method,
 *                status, durationMs: elapsedMs(startedAt),
 *                actorRole: actor.role, actorUid: actor.uid });
 *
 * PRIVACY: {@link logRequest} / {@link formatRequestLog} only ever emit the
 * whitelisted fields below. Never pass a request body, a patient record, or
 * any patient-identifying field into them — the formatter builds a fresh
 * object from the whitelist, so stray extra properties are dropped, not logged.
 */

import type { HeaderGetter } from './rate-limit';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Accepted shape for a propagated ID: a UUID or a short opaque token
 * (letters, digits, `-`, `_`, `.`, 8-128 chars). Anything else (whitespace,
 * header-injection attempts, oversized values) is rejected and replaced.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

export function generateRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export function isValidRequestId(value: string): boolean {
  return REQUEST_ID_PATTERN.test(value);
}

/**
 * Return the incoming `x-request-id` when present and well-formed,
 * otherwise generate a new UUID. `headers` may be `Headers`,
 * `NextRequest.headers`, or null/undefined (always generates).
 */
export function getOrCreateRequestId(
  headers: HeaderGetter | null | undefined,
): string {
  const incoming = headers?.get(REQUEST_ID_HEADER)?.trim();
  if (incoming && isValidRequestId(incoming)) return incoming;
  return generateRequestId();
}

/** A fresh `Headers` copy with `x-request-id` set — never mutates the input. */
export function withRequestIdHeader(headers: Headers, requestId: string): Headers {
  const copy = new Headers(headers);
  copy.set(REQUEST_ID_HEADER, requestId);
  return copy;
}

/** Whitelisted log context. Deliberately has no body/patient fields. */
export interface RequestLogContext {
  requestId: string;
  /** Route path only, e.g. '/api/workspace' — no query string, no IDs in it. */
  route: string;
  method?: string;
  status?: number;
  durationMs?: number;
  /** Actor's role (e.g. 'health_worker' | 'doctor' | 'phc_admin'), if known. */
  actorRole?: string;
  /** Actor's internal uid, if known. Not a patient identifier. */
  actorUid?: string;
}

/**
 * Build the single-line JSON log record from the whitelist only.
 * Pure (no console output) so it is unit-testable; {@link logRequest} logs it.
 */
export function formatRequestLog(context: RequestLogContext): string {
  const record: Record<string, string | number> = {
    requestId: context.requestId,
    route: context.route,
  };
  if (context.method !== undefined) record.method = context.method;
  if (context.status !== undefined) record.status = context.status;
  if (context.durationMs !== undefined) {
    record.durationMs = Math.round(context.durationMs);
  }
  if (context.actorRole !== undefined) record.actorRole = context.actorRole;
  if (context.actorUid !== undefined) record.actorUid = context.actorUid;
  return JSON.stringify(record);
}

/** Emit one structured log line for a request. See privacy note above. */
export function logRequest(context: RequestLogContext): void {
  console.info(formatRequestLog(context));
}

/** Milliseconds elapsed since a `performance.now()`/timer start value. */
export function elapsedMs(startedAt: number, now: number = performance.now()): number {
  return Math.max(0, now - startedAt);
}
