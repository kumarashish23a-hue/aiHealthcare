/**
 * pin.ts — user-set session-lock PIN.
 *
 * The PIN is chosen by the user on first sign-in (set + confirm). Only a
 * salted SHA-256 hash is stored (localStorage, key below) — never the PIN
 * itself, and there is NO default or demo PIN anywhere. Verification
 * re-hashes the candidate with the stored salt and compares.
 *
 * This is a screen lock for a shared device, not an authentication
 * factor: real authentication is Supabase Auth. The hash uses WebCrypto
 * (available in browsers and Node >= 19).
 */

export const SESSION_PIN_STORAGE_KEY = 'swasthya-session-pin-v1';

export interface PinRecord {
  salt: string;
  hash: string;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateSalt(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

export async function createPinRecord(pin: string): Promise<PinRecord> {
  const salt = generateSalt();
  return { salt, hash: await hashPin(pin, salt) };
}

export async function verifyPin(pin: string, record: PinRecord): Promise<boolean> {
  const candidate = await hashPin(pin, record.salt);
  // Constant-length hex compare; a timing-safe compare is unnecessary
  // for a local screen lock, but avoid early-exit on first mismatch.
  if (candidate.length !== record.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ record.hash.charCodeAt(i);
  }
  return diff === 0;
}

export function loadPinRecord(): PinRecord | null {
  try {
    const raw = window.localStorage.getItem(SESSION_PIN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PinRecord;
    if (typeof parsed.salt === 'string' && typeof parsed.hash === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

export function savePinRecord(record: PinRecord): void {
  try {
    window.localStorage.setItem(SESSION_PIN_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage unavailable: lock will require setting a PIN each session.
  }
}

export function clearPinRecord(): void {
  try {
    window.localStorage.removeItem(SESSION_PIN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}
