import { NextRequest } from 'next/server';
import { adminAuth } from './firebase-admin.ts';
import { getOrCreateUser } from '../db/repository.ts';
import { DEMO_USERS } from './synthetic-fixtures.ts';
import { AppUser, UserRole } from './types.ts';

export async function authenticateRequest(req: NextRequest): Promise<AppUser> {
  const authHeader = req.headers.get('authorization') || '';
  const requestedRoleHeader = req.headers.get('x-active-role') as UserRole | null;

  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized: Missing Bearer token');
  }

  const token = authHeader.slice('Bearer '.length).trim();

  // Support clearly labeled Hackathon Demo Mode session tokens
  if (token === 'demo-session-asha') {
    return DEMO_USERS.health_worker;
  }
  if (token === 'demo-session-doctor') {
    return DEMO_USERS.doctor;
  }

  // Verify real Firebase Auth ID token
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    const activeRole: UserRole =
      requestedRoleHeader === 'doctor' || requestedRoleHeader === 'phc_admin'
        ? requestedRoleHeader
        : 'health_worker';

    const dbUser = await getOrCreateUser(
      decodedToken.uid,
      decodedToken.email || 'user@swasthyasetu.org',
      decodedToken.name || undefined,
      activeRole
    );

    return {
      ...dbUser,
      role: requestedRoleHeader || dbUser.role,
      isDemo: false,
    };
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    throw new Error('Unauthorized: Invalid authentication token');
  }
}
