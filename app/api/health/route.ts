import { NextResponse } from 'next/server';
import packageJson from '../../../package.json';

// Health state must be evaluated per request, never statically cached.
export const dynamic = 'force-dynamic';

/**
 * GET /api/health — unauthenticated liveness/config probe.
 *
 * Returns only booleans and the app version: no env values, no secrets,
 * no hostnames. `dbConfigured` mirrors the SQL_* check used elsewhere
 * (both SQL_HOST and SQL_DB_NAME must be set for SQL persistence).
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    version: process.env.APP_VERSION || packageJson.version || 'unknown',
    dbConfigured: Boolean(process.env.SQL_HOST && process.env.SQL_DB_NAME),
    timestamp: new Date().toISOString(),
  });
}
