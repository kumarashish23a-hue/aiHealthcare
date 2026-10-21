/**
 * auth-server.ts — API authentication for SwasthyaSetu.
 *
 * Production mechanism (docs/AUTH_AND_SCOPING.md):
 * 1. The caller sends a Supabase Auth access token as `Bearer <token>`.
 * 2. The token is verified with Supabase Auth (see supabase-auth.ts).
 *    Demo tokens from the prototype build are explicitly rejected.
 * 3. The caller's ROLE, facility and assigned village come from the
 *    `users` table row for the verified uid — NEVER from the token, and
 *    NEVER from headers such as `x-active-role` (that header is ignored;
 *    it existed only for the demo role switcher, which has been removed).
 * 4. A first verified sign-in creates the users row with the lowest
 *    privilege role (`health_worker`). Role elevation is an admin action
 *    (phc_admin, via the admin user-management API), never self-service.
 * 5. Deactivated accounts (users.is_active = false) are rejected.
 */

import { NextRequest } from 'next/server';
import { getOrCreateUser, getUserByUid } from '../db/repository.ts';
import { isDemoToken, verifySupabaseAccessToken } from './supabase-auth.ts';
import type { AppUser } from './types.ts';

export async function authenticateRequest(req: NextRequest): Promise<AppUser> {
  const authHeader = req.headers.get('authorization') || '';

  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized: Missing Bearer token');
  }

  const token = authHeader.slice('Bearer '.length).trim();

  if (isDemoToken(token)) {
    throw new Error(
      'Unauthorized: Demo tokens are disabled. Sign in with Supabase Auth.'
    );
  }

  const identity = await verifySupabaseAccessToken(token);
  if (!identity) {
    throw new Error('Unauthorized: Invalid authentication token');
  }

  // Role/scope come from the database record for the verified uid.
  let user = await getUserByUid(identity.uid);
  if (!user) {
    user = await getOrCreateUser(
      identity.uid,
      identity.email || 'user@swasthyasetu.org',
      undefined,
      'health_worker'
    );
  }

  if (user.isActive === false) {
    throw new Error('Unauthorized: This account has been deactivated by an administrator');
  }

  return { ...user, isDemo: false };
}

/** Role gate for whole route groups (e.g. /doctor, /admin API actions). */
export function assertRole(user: AppUser, allowed: Array<AppUser['role']>): void {
  if (!allowed.includes(user.role)) {
    throw new Error(
      `AuthorizationError: Role '${user.role}' is not permitted to access this resource.`
    );
  }
}
