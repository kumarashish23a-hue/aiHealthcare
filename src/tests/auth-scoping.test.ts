/**
 * Phase 1/2/3/5 tests: Supabase Auth verification behaviour, role-from-DB
 * (header spoofing rejected), repository scoping, RBAC on referral
 * updates, production persistence guard, user-set PIN hashing, and the
 * Gemini deterministic fallback.
 *
 * The Supabase token verifier is mocked — no network, no live account.
 * Repository functions run against the in-memory store (no SQL env in
 * the test environment), which is the same code path used for scoping.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../lib/supabase-auth.ts', () => ({
  isDemoToken: (t: string) => t === 'demo-session-asha' || t === 'demo-session-doctor',
  verifySupabaseAccessToken: async (t: string) => {
    if (t === 'valid-token-worker') return { uid: 'user-worker-1', email: 'worker@example.org' };
    if (t === 'valid-token-doctor') return { uid: 'user-doctor-1', email: 'doctor@example.org' };
    if (t === 'valid-token-admin') return { uid: 'user-admin-1', email: 'admin@example.org' };
    if (t === 'valid-token-off') return { uid: 'user-deactivated-1', email: 'off@example.org' };
    return null;
  },
  isSupabaseAuthConfigured: () => true,
}));

import { authenticateRequest } from '../lib/auth-server';
import {
  createReferralRecord,
  getOrCreateUser,
  setUserActive,
  updateReferralByDoctor,
} from '../db/repository';
import { scopeWorkspaceData, type WorkspaceData } from '../lib/scoping';
import { assertProductionPersistence, getPersistenceMode } from '../db/index';
import { createPinRecord, isValidPinFormat, verifyPin } from '../lib/pin';
import type { AppUser, PatientRecord } from '../lib/types';

function reqWith(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/workspace', { headers });
}

const workerAppUser: AppUser = {
  uid: 'user-worker-1',
  email: 'worker@example.org',
  fullName: 'Worker One',
  role: 'health_worker',
  facilityName: 'Sub-Centre Rampur · Sitapur, Uttar Pradesh',
  preferredLanguage: 'en',
  assignedVillage: 'Rampur',
};

function patient(patientId: string, village: string, registeredByUid: string): PatientRecord {
  return {
    patientId,
    fullName: `Patient ${patientId}`,
    ageYears: 30,
    sex: 'female',
    village,
    blockName: 'Sitapur',
    phoneLastFour: '0000',
    consentObtained: true,
    consentTimestamp: '2026-01-01T00:00:00.000Z',
    knownConditions: [],
    registeredByUid,
    isSynthetic: false,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('Phase 1 — authentication', () => {
  beforeAll(async () => {
    // Create account rows in the in-memory store with known roles.
    await getOrCreateUser('user-worker-1', 'worker@example.org', 'Worker One', 'health_worker');
    await getOrCreateUser('user-doctor-1', 'doctor@example.org', 'Doctor One', 'doctor');
    await getOrCreateUser('user-admin-1', 'admin@example.org', 'Admin One', 'phc_admin');
  });

  it('rejects a request with no Authorization header (401 path)', async () => {
    await expect(authenticateRequest(reqWith({}))).rejects.toThrow(/Unauthorized/);
  });

  it('rejects the old demo tokens explicitly', async () => {
    await expect(
      authenticateRequest(reqWith({ authorization: 'Bearer demo-session-doctor' }))
    ).rejects.toThrow(/Demo tokens are disabled/);
    await expect(
      authenticateRequest(reqWith({ authorization: 'Bearer demo-session-asha' }))
    ).rejects.toThrow(/Demo tokens are disabled/);
  });

  it('rejects an invalid token', async () => {
    await expect(
      authenticateRequest(reqWith({ authorization: 'Bearer not-a-real-token' }))
    ).rejects.toThrow(/Unauthorized: Invalid authentication token/);
  });

  it('ignores x-active-role: role comes from the DB record, not the header', async () => {
    const user = await authenticateRequest(
      reqWith({
        authorization: 'Bearer valid-token-worker',
        'x-active-role': 'doctor',
      })
    );
    expect(user.uid).toBe('user-worker-1');
    expect(user.role).toBe('health_worker');
  });

  it('returns the doctor role for a doctor account regardless of header', async () => {
    const user = await authenticateRequest(
      reqWith({
        authorization: 'Bearer valid-token-doctor',
        'x-active-role': 'health_worker',
      })
    );
    expect(user.role).toBe('doctor');
  });

  it('rejects a deactivated account', async () => {
    const admin = await authenticateRequest(
      reqWith({ authorization: 'Bearer valid-token-admin' })
    );
    await getOrCreateUser('user-deactivated-1', 'off@example.org', 'Off User', 'health_worker');
    await setUserActive(admin, 'user-deactivated-1', false);
    await expect(
      authenticateRequest(reqWith({ authorization: 'Bearer valid-token-off' }))
    ).rejects.toThrow(/deactivated/);
  });

});

describe('Phase 1 — workspace scoping', () => {
  const data: WorkspaceData = {
    patients: [
      patient('P-OWN-OTHER-VILLAGE', 'OtherVillage', 'user-worker-1'),
      patient('P-VILLAGE-OTHER-WORKER', 'Rampur', 'someone-else'),
      patient('P-OUT-OF-SCOPE', 'FarVillage', 'someone-else'),
    ],
    screenings: [],
    referrals: [],
    followUps: [],
    auditLogs: [],
    profiles: [],
  };

  it('health_worker sees own-registered + assigned-village patients only', () => {
    const scoped = scopeWorkspaceData(workerAppUser, data);
    const ids = scoped.patients.map((p) => p.patientId).sort();
    expect(ids).toEqual(['P-OWN-OTHER-VILLAGE', 'P-VILLAGE-OTHER-WORKER']);
    expect(ids).not.toContain('P-OUT-OF-SCOPE');
  });

  it('phc_admin sees everything', () => {
    const admin: AppUser = { ...workerAppUser, uid: 'user-admin-1', role: 'phc_admin' };
    expect(scopeWorkspaceData(admin, data).patients).toHaveLength(3);
  });

  it('doctor sees patients linked to referrals for his facility only', () => {
    const doctor: AppUser = {
      ...workerAppUser,
      uid: 'user-doctor-1',
      role: 'doctor',
      facilityName: 'PHC Rampur, Sitapur, Uttar Pradesh',
    };
    const withReferrals: WorkspaceData = {
      ...data,
      referrals: [
        {
          referralId: 'R-1',
          patientId: 'P-OUT-OF-SCOPE',
          screeningId: 'S-1',
          priority: 'urgent_escalation',
          reasonForReferral: 'test',
          destinationFacility: 'PHC Rampur, Sitapur, Sitapur, Uttar Pradesh',
          status: 'pending',
          assignedProfessional: '',
          doctorNotes: '',
          followUpPlan: '',
          unableReason: '',
          createdByUid: 'someone-else',
          createdDate: '2026-01-01',
          updatedDate: '2026-01-01',
          version: 1,
          isSimulated: false,
        },
        {
          referralId: 'R-2',
          patientId: 'P-VILLAGE-OTHER-WORKER',
          screeningId: 'S-2',
          priority: 'routine_follow_up',
          reasonForReferral: 'test',
          destinationFacility: 'CHC Sitapur, Sitapur, Sitapur, Uttar Pradesh',
          status: 'pending',
          assignedProfessional: '',
          doctorNotes: '',
          followUpPlan: '',
          unableReason: '',
          createdByUid: 'someone-else',
          createdDate: '2026-01-01',
          updatedDate: '2026-01-01',
          version: 1,
          isSimulated: false,
        },
      ],
    };
    const scoped = scopeWorkspaceData(doctor, withReferrals);
    expect(scoped.referrals.map((r) => r.referralId)).toEqual(['R-1']);
    expect(scoped.patients.map((p) => p.patientId)).toEqual(['P-OUT-OF-SCOPE']);
  });
});

describe('Phase 1 — RBAC on mutations', () => {
  it('health_worker is blocked from update_referral (review_referral)', async () => {
    const doctor = await getOrCreateUser(
      'user-doctor-1',
      'doctor@example.org',
      'Doctor One',
      'doctor'
    );
    await createReferralRecord(
      { uid: doctor.uid, role: doctor.role },
      {
        referralId: 'REF-TEST-1',
        patientId: 'P-X',
        screeningId: 'SCR-X',
        priority: 'urgent_escalation',
        reasonForReferral: 'test',
        destinationFacility: 'PHC Rampur, Sitapur, Uttar Pradesh',
        createdDate: '2026-01-01',
      }
    );
    await expect(
      updateReferralByDoctor(
        { uid: 'user-worker-1', role: 'health_worker', fullName: 'Worker One' },
        { referralId: 'REF-TEST-1', status: 'completed', expectedVersion: 1 }
      )
    ).rejects.toThrow(/AuthorizationError/);
  });

  it('non-admin is blocked from user management', async () => {
    await expect(
      setUserActive(workerAppUser, 'user-doctor-1', false)
    ).rejects.toThrow(/AuthorizationError/);
  });
});

describe('Phase 2 — production persistence guard', () => {
  it('throws in production without SQL configured', () => {
    expect(() =>
      assertProductionPersistence({ nodeEnv: 'production', sqlConfigured: false })
    ).toThrow(/ConfigurationError/);
  });
  it('allows production with SQL, and dev without SQL', () => {
    expect(() =>
      assertProductionPersistence({ nodeEnv: 'production', sqlConfigured: true })
    ).not.toThrow();
    expect(() =>
      assertProductionPersistence({ nodeEnv: 'development', sqlConfigured: false })
    ).not.toThrow();
    expect(getPersistenceMode({ nodeEnv: 'production', sqlConfigured: false })).toBe(
      'in_memory_dev_only'
    );
  });
});

describe('Phase 3 — user-set PIN', () => {
  it('hashes with a salt and verifies only the correct PIN', async () => {
    const record = await createPinRecord('4821');
    expect(record.hash).not.toContain('4821');
    expect(record.salt.length).toBeGreaterThanOrEqual(16);
    await expect(verifyPin('4821', record)).resolves.toBe(true);
    await expect(verifyPin('0000', record)).resolves.toBe(false);
    const other = await createPinRecord('4821');
    expect(other.hash).not.toBe(record.hash); // different salt
  });
  it('validates PIN format (4-6 digits)', () => {
    expect(isValidPinFormat('1234')).toBe(true);
    expect(isValidPinFormat('123456')).toBe(true);
    expect(isValidPinFormat('123')).toBe(false);
    expect(isValidPinFormat('12a4')).toBe(false);
  });
});

describe('Phase 5 — Gemini deterministic fallback (no API key)', () => {
  it('returns the deterministic fallback and the locked category', async () => {
    delete process.env.GEMINI_API_KEY;
    const { POST } = await import('../../app/api/ai-explain/route');
    const req = new NextRequest('http://localhost/api/ai-explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'en',
        screeningInput: {
          patientId: 'P-1',
          systolicBp: 190,
          diastolicBp: 120,
          heartRateBpm: 88,
          temperatureC: 37,
          spo2Percent: 98,
          symptoms: [],
          symptomDurationDays: 0,
        },
      }),
    });
    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.source).toBe('deterministic_fallback');
    expect(data.finalCategory).toBe('urgent_escalation');
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });
});
