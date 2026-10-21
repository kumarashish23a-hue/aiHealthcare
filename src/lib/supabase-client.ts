/**
 * supabase-client.ts — browser Supabase client (Auth only).
 *
 * The app talks to its own Next.js API routes for data; Supabase is used
 * in the browser solely for sign-in / sign-up / session handling. Data
 * access stays server-side (Drizzle/pg) where role scoping is enforced.
 *
 * Returns null when the NEXT_PUBLIC_ env vars are not set, so the UI can
 * show an honest "auth is not configured" message instead of faking login.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null | undefined;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    cached = null;
    return cached;
  }
  cached = createClient(url, anonKey);
  return cached;
}

export function isSupabaseBrowserConfigured(): boolean {
  return getSupabaseBrowserClient() !== null;
}
