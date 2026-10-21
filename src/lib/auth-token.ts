/**
 * auth-token.ts — mirrors the current Supabase access token in
 * sessionStorage so the app's many synchronous fetch call sites can build
 * Authorization headers without becoming async.
 *
 * The token is a short-lived Supabase Auth JWT. It is kept in
 * sessionStorage (cleared when the tab closes), never in localStorage,
 * and never sent anywhere except this app's own API routes. The Supabase
 * SDK remains the source of truth for the session; LoginPanel and
 * SwasthyaSetuApp keep this mirror updated on sign-in and on
 * onAuthStateChange (token refresh).
 */

export const ACCESS_TOKEN_STORAGE_KEY = 'swasthya-access-token-v1';

export function setAccessToken(token: string | null): void {
  try {
    if (token) {
      window.sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable (private mode): headers will carry no token and
    // the API will answer 401, which the UI surfaces as a sign-in prompt.
  }
}

export function getAccessToken(): string | null {
  try {
    return window.sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function buildAuthHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? getAccessToken() : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
