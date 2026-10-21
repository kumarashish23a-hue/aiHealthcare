/**
 * supabase-auth.ts — server-side verification of Supabase Auth access tokens.
 *
 * Mechanism (one, documented in docs/AUTH_AND_SCOPING.md):
 *   Primary: call the Supabase Auth `GET /auth/v1/user` endpoint with the
 *   project anon key as `apikey` and the caller's access token as the
 *   Bearer token. Supabase validates the JWT signature and expiry
 *   server-side and returns the user. This needs no service-role key and
 *   works identically for SQL/in-memory persistence modes.
 *   Alternative: if SUPABASE_URL is not set but SUPABASE_JWKS_URL is, the
 *   token is verified locally as a JWT against that JWKS (via `jose`),
 *   checking signature + expiry + `sub`.
 *
 * This module only proves WHO the caller is (uid + email). The caller's
 * ROLE is never taken from the token or any header — it is read from the
 * `users` table by src/lib/auth-server.ts.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface VerifiedIdentity {
  uid: string;
  email?: string;
}

const DEMO_TOKENS = new Set(['demo-session-asha', 'demo-session-doctor']);

export function isDemoToken(token: string): boolean {
  return DEMO_TOKENS.has(token.trim());
}

function supabaseUrl(): string {
  return (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(
    /\/$/,
    ''
  );
}

function supabaseAnonKey(): string {
  return process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
}

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

async function verifyViaJwks(token: string): Promise<VerifiedIdentity | null> {
  const jwksUrl = process.env.SUPABASE_JWKS_URL;
  if (!jwksUrl) return null;
  try {
    if (!jwksCache) jwksCache = createRemoteJWKSet(new URL(jwksUrl));
    const { payload } = await jwtVerify(token, jwksCache);
    if (!payload.sub) return null;
    return {
      uid: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
    };
  } catch {
    return null;
  }
}

export async function verifySupabaseAccessToken(
  token: string
): Promise<VerifiedIdentity | null> {
  if (!token || isDemoToken(token)) return null;

  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  if (url && anonKey) {
    try {
      const response = await fetch(`${url}/auth/v1/user`, {
        method: 'GET',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { id?: string; email?: string };
      if (!data?.id) return null;
      return { uid: data.id, email: data.email };
    } catch {
      return null;
    }
  }

  // No Auth endpoint configured — try JWKS-only verification.
  return verifyViaJwks(token);
}

export function isSupabaseAuthConfigured(): boolean {
  return Boolean(
    (supabaseUrl() && supabaseAnonKey()) || process.env.SUPABASE_JWKS_URL
  );
}
