import { desc, eq, inArray } from 'drizzle-orm';
import { db, isSqlConfigured } from './index.ts';
import {
  auditLogs,
  followUpRecords,
  healthWorkerProfiles,
  patients,
  referrals,
  screeningRecords,
  syncEvents,
  users,
} from './schema.ts';
import {
  AppUser,
  AuditLogEntry,
  FollowUpRecord,
  FollowUpStatus,
  PatientRecord,
  ReferralRecord,
  ReferralStatus,
  ScreeningCategory,
  ScreeningRecord,
  StoredProfile,
  UserRole,
} from '../lib/types.ts';
import {
  DEMO_USERS,
  INITIAL_AUDIT_LOGS,
  INITIAL_SYNTHETIC_FOLLOW_UPS,
  INITIAL_SYNTHETIC_PATIENTS,
  INITIAL_SYNTHETIC_REFERRALS,
  INITIAL_SYNTHETIC_SCREENINGS,
} from '../lib/synthetic-fixtures.ts';
import {
  assertAuthorized,
  calculateDashboardMetrics,
  detectVersionConflict,
} from '../lib/workflow-logic.ts';

let isSeedingComplete = false;

const LEGACY_PRESET_PATIENT_IDS = [
  'PAT-RMP-1001',
  'PAT-RMP-1002',
  'PAT-RMP-1003',
  'PAT-RMP-1004',
  'PAT-RMP-1005',
  'PAT-RMP-1006',
];
const LEGACY_PRESET_SCREENING_IDS = [
  'SCR-2026-8801',
  'SCR-2026-8802',
  'SCR-2026-8803',
  'SCR-2026-8804',
  'SCR-2026-8805',
];
const LEGACY_PRESET_REFERRAL_IDS = ['REF-PHC-5001', 'REF-PHC-5002', 'REF-PHC-5003'];
const LEGACY_PRESET_FOLLOWUP_IDS = [
  'FUP-2026-3001',
  'FUP-2026-3002',
  'FUP-2026-3003',
  'FUP-2026-3004',
];
const LEGACY_PRESET_AUDIT_IDS = ['AUD-101', 'AUD-102', 'AUD-103', 'AUD-104'];

// Robust in-memory store for local execution, tests, and offline resilience
const memoryStore = {
  users: new Map<string, AppUser>([
    [DEMO_USERS.health_worker.uid, { ...DEMO_USERS.health_worker }],
    [DEMO_USERS.doctor.uid, { ...DEMO_USERS.doctor }],
  ]),
  patients: [...INITIAL_SYNTHETIC_PATIENTS],
  screenings: [...INITIAL_SYNTHETIC_SCREENINGS],
  referrals: [...INITIAL_SYNTHETIC_REFERRALS],
  followUps: [...INITIAL_SYNTHETIC_FOLLOW_UPS],
  auditLogs: [...INITIAL_AUDIT_LOGS],
  profiles: [] as StoredProfile[],
  syncEvents: [] as Array<{
    syncEventId: string;
    entityType: string;
    entityId: string;
    action: string;
    status: string;
    deviceUid: string;
    conflictDetails: string;
    createdAt: string;
  }>,
};

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function getOrCreateUser(
  uid: string,
  email: string,
  fullName?: string,
  defaultRole: UserRole = 'health_worker'
): Promise<AppUser> {
  const getFromMemory = (): AppUser => {
    let user = memoryStore.users.get(uid);
    if (!user) {
      user = {
        uid,
        email,
        fullName: fullName || email.split('@')[0] || 'Healthcare User',
        role: defaultRole,
        facilityName:
          defaultRole === 'doctor'
            ? 'Simulated PHC Rampur, Sitapur — Uttar Pradesh (Demo)'
            : 'Sub-Centre Rampur · Sitapur, Uttar Pradesh',
        preferredLanguage: 'en',
        isDemo: true,
      };
      memoryStore.users.set(uid, user);
    }
    return user;
  };

  if (!isSqlConfigured) {
    return getFromMemory();
  }

  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        fullName: fullName || email.split('@')[0] || 'Healthcare User',
        role: defaultRole,
        facilityName:
          defaultRole === 'doctor'
            ? 'Simulated PHC Rampur, Sitapur — Uttar Pradesh (Demo)'
            : 'Sub-Centre Rampur · Sitapur, Uttar Pradesh',
        preferredLanguage: 'en',
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          updatedAt: new Date(),
        },
      })
      .returning();

    const row = result[0];
    return {
      uid: row.uid,
      email: row.email,
      fullName: row.fullName,
      role: row.role as UserRole,
      facilityName: row.facilityName,
      preferredLanguage: (row.preferredLanguage as 'en' | 'hi') || 'en',
    };
  } catch (error) {
    console.warn('Database unavailable in getOrCreateUser, using memory store:', error);
    return getFromMemory();
  }
}

export async function ensureSyntheticDemoSeeded(): Promise<void> {
  if (isSeedingComplete || !isSqlConfigured) {
    isSeedingComplete = true;
    return;
  }

  try {
    // Purge any legacy pre-set synthetic rows so workspace starts clean
    await db.delete(followUpRecords).where(inArray(followUpRecords.followUpId, LEGACY_PRESET_FOLLOWUP_IDS));
    await db.delete(referrals).where(inArray(referrals.referralId, LEGACY_PRESET_REFERRAL_IDS));
    await db.delete(screeningRecords).where(inArray(screeningRecords.screeningId, LEGACY_PRESET_SCREENING_IDS));
    await db.delete(patients).where(inArray(patients.patientId, LEGACY_PRESET_PATIENT_IDS));
    await db.delete(auditLogs).where(inArray(auditLogs.auditId, LEGACY_PRESET_AUDIT_IDS));

    // 1. Seed Demo Users
    for (const key of ['health_worker', 'doctor'] as const) {
      const demoUser = DEMO_USERS[key];
      await db
        .insert(users)
        .values({
          uid: demoUser.uid,
          email: demoUser.email,
          fullName: demoUser.fullName,
          role: demoUser.role,
          facilityName: demoUser.facilityName,
          preferredLanguage: demoUser.preferredLanguage,
        })
        .onConflictDoNothing();
    }

    // 2. Seed ASHA Worker Profile
    const wp = DEMO_USERS.health_worker.workerProfile!;
    await db
      .insert(healthWorkerProfiles)
      .values({
        userUid: DEMO_USERS.health_worker.uid,
        workerCode: wp.workerCode,
        assignedVillage: wp.assignedVillage,
        blockName: wp.blockName,
        district: wp.district,
        primaryPhc: wp.primaryPhc,
        phoneLastFour: wp.phoneLastFour,
      })
      .onConflictDoNothing();

    // 3. Seed Synthetic Patients
    for (const p of INITIAL_SYNTHETIC_PATIENTS) {
      await db
        .insert(patients)
        .values({
          patientId: p.patientId,
          fullName: p.fullName,
          ageYears: p.ageYears,
          sex: p.sex,
          village: p.village,
          blockName: p.blockName,
          phoneLastFour: p.phoneLastFour,
          consentObtained: p.consentObtained,
          consentTimestamp: p.consentTimestamp,
          knownConditions: JSON.stringify(p.knownConditions),
          registeredByUid: p.registeredByUid,
          isSynthetic: true,
          version: p.version,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
        })
        .onConflictDoNothing();
    }

    // 4. Seed Synthetic Screenings
    for (const s of INITIAL_SYNTHETIC_SCREENINGS) {
      await db
        .insert(screeningRecords)
        .values({
          screeningId: s.screeningId,
          patientId: s.patientId,
          recordedByUid: s.recordedByUid,
          recordedByName: s.recordedByName,
          screeningDate: s.screeningDate,
          systolicBp: s.systolicBp,
          diastolicBp: s.diastolicBp,
          heartRateBpm: s.heartRateBpm,
          temperatureC: s.temperatureC != null ? String(s.temperatureC) : null,
          spo2Percent: s.spo2Percent,
          randomBloodGlucoseMgDl: s.randomBloodGlucoseMgDl,
          hemoglobinGDl: s.hemoglobinGDl != null ? String(s.hemoglobinGDl) : null,
          respiratoryRateBpm: s.respiratoryRateBpm,
          isPregnant: s.isPregnant,
          gestationalWeeks: s.gestationalWeeks,
          symptomsJson: JSON.stringify(s.symptoms),
          symptomDurationDays: s.symptomDurationDays,
          medicalHistoryNotes: s.medicalHistoryNotes,
          missingFieldsJson: JSON.stringify(s.missingFields),
          resultCategory: s.resultCategory,
          flaggedReasonsJson: JSON.stringify(s.flaggedReasons),
          recommendedNextStepsJson: JSON.stringify(s.recommendedNextSteps),
          aiSupplementalNote: s.aiSupplementalNote || '',
          engineVersion: s.engineVersion,
          requiresFollowUp: s.requiresFollowUp,
          followUpDueDate: s.followUpDueDate,
          version: s.version,
          createdAt: new Date(s.createdAt),
        })
        .onConflictDoNothing();
    }

    // 5. Seed Synthetic Referrals
    for (const r of INITIAL_SYNTHETIC_REFERRALS) {
      await db
        .insert(referrals)
        .values({
          referralId: r.referralId,
          patientId: r.patientId,
          screeningId: r.screeningId,
          priority: r.priority,
          reasonForReferral: r.reasonForReferral,
          destinationFacility: r.destinationFacility,
          status: r.status,
          assignedProfessional: r.assignedProfessional,
          doctorNotes: r.doctorNotes,
          followUpPlan: r.followUpPlan,
          unableReason: r.unableReason,
          createdByUid: r.createdByUid,
          createdDate: r.createdDate,
          updatedDate: r.updatedDate,
          version: r.version,
          isSimulated: true,
        })
        .onConflictDoNothing();
    }

    // 6. Seed Synthetic Follow-up Tasks
    for (const f of INITIAL_SYNTHETIC_FOLLOW_UPS) {
      await db
        .insert(followUpRecords)
        .values({
          followUpId: f.followUpId,
          patientId: f.patientId,
          screeningId: f.screeningId,
          referralId: f.referralId,
          status: f.status,
          scheduledDate: f.scheduledDate,
          completedDate: f.completedDate,
          notes: f.notes,
          recordedByUid: f.recordedByUid,
          recordedByRole: f.recordedByRole,
          version: f.version,
          createdAt: new Date(f.updatedAt),
          updatedAt: new Date(f.updatedAt),
        })
        .onConflictDoNothing();
    }

    // 7. Seed Initial Audit Logs
    for (const a of INITIAL_AUDIT_LOGS) {
      await db
        .insert(auditLogs)
        .values({
          auditId: a.auditId,
          actorUid: a.actorUid,
          actorRole: a.actorRole,
          action: a.action,
          targetType: a.targetType,
          targetId: a.targetId,
          summary: a.summary,
        })
        .onConflictDoNothing();
    }

    isSeedingComplete = true;
  } catch (error) {
    console.warn('Database seeding notice (using in-memory fallback):', error);
    isSeedingComplete = true;
  }
}

export async function getAllWorkspaceData(referenceDateIso?: string) {
  const getFromMemory = () => ({
    patients: [...memoryStore.patients],
    screenings: [...memoryStore.screenings],
    referrals: [...memoryStore.referrals],
    followUps: [...memoryStore.followUps],
    auditLogs: [...memoryStore.auditLogs],
    profiles: [...memoryStore.profiles].sort((a, b) =>
      b.lastUsedAt.localeCompare(a.lastUsedAt)
    ),
    metrics: calculateDashboardMetrics(
      memoryStore.patients,
      memoryStore.screenings,
      memoryStore.referrals,
      memoryStore.followUps,
      referenceDateIso
    ),
  });

  if (!isSqlConfigured) {
    return getFromMemory();
  }

  try {
    await ensureSyntheticDemoSeeded();

    const [patientRows, screeningRows, referralRows, followUpRows, auditRows] = await Promise.all([
      db.select().from(patients).orderBy(desc(patients.createdAt)),
      db.select().from(screeningRecords).orderBy(desc(screeningRecords.createdAt)),
      db.select().from(referrals).orderBy(desc(referrals.createdAt)),
      db.select().from(followUpRecords).orderBy(desc(followUpRecords.createdAt)),
      db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)),
    ]);

    const mappedPatients: PatientRecord[] = patientRows.map((p) => ({
      patientId: p.patientId,
      fullName: p.fullName,
      ageYears: p.ageYears,
      sex: p.sex as 'female' | 'male' | 'other',
      village: p.village,
      blockName: p.blockName,
      phoneLastFour: p.phoneLastFour,
      consentObtained: p.consentObtained,
      consentTimestamp: p.consentTimestamp,
      knownConditions: safeParseJson<string[]>(p.knownConditions, []),
      registeredByUid: p.registeredByUid,
      isSynthetic: p.isSynthetic,
      version: p.version,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      syncStatus: 'synced',
    }));

    const patientById = new Map(mappedPatients.map((p) => [p.patientId, p]));

    const mappedScreenings: ScreeningRecord[] = screeningRows.map((s) => {
      const pat = patientById.get(s.patientId);
      return {
        screeningId: s.screeningId,
        patientId: s.patientId,
        patientName: pat?.fullName || s.patientId,
        patientVillage: pat?.village || 'Rampur',
        recordedByUid: s.recordedByUid,
        recordedByName: s.recordedByName,
        screeningDate: s.screeningDate,
        systolicBp: s.systolicBp,
        diastolicBp: s.diastolicBp,
        heartRateBpm: s.heartRateBpm,
        temperatureC: s.temperatureC != null ? Number(s.temperatureC) : null,
        spo2Percent: s.spo2Percent,
        randomBloodGlucoseMgDl: s.randomBloodGlucoseMgDl,
        hemoglobinGDl: s.hemoglobinGDl != null ? Number(s.hemoglobinGDl) : null,
        respiratoryRateBpm: s.respiratoryRateBpm,
        isPregnant: s.isPregnant,
        gestationalWeeks: s.gestationalWeeks,
        symptoms: safeParseJson<string[]>(s.symptomsJson, []),
        symptomDurationDays: s.symptomDurationDays,
        medicalHistoryNotes: s.medicalHistoryNotes || '',
        missingFields: safeParseJson<string[]>(s.missingFieldsJson, []),
        resultCategory: s.resultCategory as ScreeningCategory,
        flaggedReasons: safeParseJson(s.flaggedReasonsJson, []),
        recommendedNextSteps: safeParseJson(s.recommendedNextStepsJson, []),
        aiSupplementalNote: s.aiSupplementalNote || '',
        engineVersion: s.engineVersion,
        requiresFollowUp: s.requiresFollowUp,
        followUpDueDate: s.followUpDueDate,
        version: s.version,
        createdAt: s.createdAt.toISOString(),
      };
    });

    const mappedReferrals: ReferralRecord[] = referralRows.map((r) => ({
      referralId: r.referralId,
      patientId: r.patientId,
      screeningId: r.screeningId,
      priority: r.priority as ScreeningCategory,
      reasonForReferral: r.reasonForReferral,
      destinationFacility: r.destinationFacility,
      status: r.status as ReferralStatus,
      assignedProfessional: r.assignedProfessional,
      doctorNotes: r.doctorNotes,
      followUpPlan: r.followUpPlan,
      unableReason: r.unableReason,
      createdByUid: r.createdByUid,
      createdDate: r.createdDate,
      updatedDate: r.updatedDate,
      version: r.version,
      isSimulated: r.isSimulated,
    }));

    const mappedFollowUps: FollowUpRecord[] = followUpRows.map((f) => ({
      followUpId: f.followUpId,
      patientId: f.patientId,
      screeningId: f.screeningId,
      referralId: f.referralId,
      status: f.status as FollowUpStatus,
      scheduledDate: f.scheduledDate,
      completedDate: f.completedDate,
      notes: f.notes,
      recordedByUid: f.recordedByUid,
      recordedByRole: f.recordedByRole as UserRole,
      version: f.version,
      updatedAt: f.updatedAt.toISOString(),
    }));

    const mappedAudit: AuditLogEntry[] = auditRows.map((a) => ({
      auditId: a.auditId,
      actorUid: a.actorUid,
      actorRole: a.actorRole,
      action: a.action,
      targetType: a.targetType,
      targetId: a.targetId,
      summary: a.summary,
      createdAt: a.createdAt.toISOString(),
    }));

    const metrics = calculateDashboardMetrics(
      mappedPatients,
      mappedScreenings,
      mappedReferrals,
      mappedFollowUps,
      referenceDateIso
    );

    return {
      patients: mappedPatients,
      screenings: mappedScreenings,
      referrals: mappedReferrals,
      followUps: mappedFollowUps,
      auditLogs: mappedAudit,
      profiles: [...memoryStore.profiles].sort((a, b) =>
        b.lastUsedAt.localeCompare(a.lastUsedAt)
      ),
      metrics,
    };
  } catch (error) {
    console.warn('Database query failed in getAllWorkspaceData, using in-memory store:', error);
    return getFromMemory();
  }
}

/**
 * Server-side login-profile registry (prototype build, auth switched OFF):
 * login profiles created on ANY device are persisted in the server store so the
 * /admin panel can list all saved ASHA workers, doctors, and PHC admins.
 */
export async function upsertProfileRecord(payload: {
  uid: string;
  role: UserRole;
  fullName: string;
  phoneLastFour: string;
  facilityName: string;
  createdAt: string;
  lastUsedAt: string;
}): Promise<StoredProfile> {
  const clean: StoredProfile = {
    uid: String(payload.uid).trim(),
    role: payload.role,
    fullName: String(payload.fullName).trim(),
    phoneLastFour: String(payload.phoneLastFour).trim(),
    facilityName: String(payload.facilityName).trim(),
    createdAt: payload.createdAt,
    lastUsedAt: payload.lastUsedAt,
  };

  memoryStore.profiles = [
    ...memoryStore.profiles.filter((p) => p.uid !== clean.uid),
    clean,
  ].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));

  await recordAuditLog({
    actorUid: clean.uid,
    actorRole: clean.role,
    action: 'save_profile',
    targetType: 'profile',
    targetId: clean.uid,
    summary: `Login profile saved: ${clean.fullName} (${clean.role}) at ${clean.facilityName}`,
  });

  return clean;
}

export async function recordAuditLog(params: {
  actorUid: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
}): Promise<void> {
  const auditId = `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  memoryStore.auditLogs.unshift({
    auditId,
    actorUid: params.actorUid,
    actorRole: params.actorRole,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    summary: params.summary,
    createdAt: new Date().toISOString(),
  });

  if (!isSqlConfigured) return;

  try {
    await db.insert(auditLogs).values({
      auditId,
      actorUid: params.actorUid,
      actorRole: params.actorRole,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      summary: params.summary,
    });
  } catch (error) {
    console.warn('Failed to write SQL audit log, saved to memory:', error);
  }
}

export async function createPatientRecord(
  actor: { uid: string; role: UserRole },
  payload: {
    patientId: string;
    fullName: string;
    ageYears: number;
    sex: 'female' | 'male' | 'other';
    village: string;
    blockName: string;
    phoneLastFour: string;
    consentObtained: boolean;
    consentTimestamp: string;
    knownConditions: string[];
  }
): Promise<{ record: PatientRecord; duplicatePrevented: boolean }> {
  assertAuthorized(actor.role, 'register_patient');

  const saveToMemory = async (): Promise<{ record: PatientRecord; duplicatePrevented: boolean }> => {
    const existing = memoryStore.patients.find((p) => p.patientId === payload.patientId);
    if (existing) {
      return { duplicatePrevented: true, record: existing };
    }

    const record: PatientRecord = {
      patientId: payload.patientId,
      fullName: payload.fullName,
      ageYears: payload.ageYears,
      sex: payload.sex,
      village: payload.village,
      blockName: payload.blockName,
      phoneLastFour: payload.phoneLastFour,
      consentObtained: payload.consentObtained,
      consentTimestamp: payload.consentTimestamp,
      knownConditions: payload.knownConditions || [],
      registeredByUid: actor.uid,
      isSynthetic: true,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      syncStatus: 'synced',
    };
    memoryStore.patients.unshift(record);

    await recordAuditLog({
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'PATIENT_REGISTERED',
      targetType: 'patient',
      targetId: record.patientId,
      summary: `Registered synthetic patient ${record.patientId} (${record.village}) with documented consent.`,
    });

    return { duplicatePrevented: false, record };
  };

  if (!isSqlConfigured) {
    return saveToMemory();
  }

  try {
    const existing = await db
      .select()
      .from(patients)
      .where(eq(patients.patientId, payload.patientId));

    if (existing.length > 0) {
      const row = existing[0];
      return {
        duplicatePrevented: true,
        record: {
          patientId: row.patientId,
          fullName: row.fullName,
          ageYears: row.ageYears,
          sex: row.sex as 'female' | 'male' | 'other',
          village: row.village,
          blockName: row.blockName,
          phoneLastFour: row.phoneLastFour,
          consentObtained: row.consentObtained,
          consentTimestamp: row.consentTimestamp,
          knownConditions: safeParseJson<string[]>(row.knownConditions, []),
          registeredByUid: row.registeredByUid,
          isSynthetic: row.isSynthetic,
          version: row.version,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          syncStatus: 'synced',
        },
      };
    }

    const inserted = await db
      .insert(patients)
      .values({
        patientId: payload.patientId,
        fullName: payload.fullName,
        ageYears: payload.ageYears,
        sex: payload.sex,
        village: payload.village,
        blockName: payload.blockName,
        phoneLastFour: payload.phoneLastFour,
        consentObtained: payload.consentObtained,
        consentTimestamp: payload.consentTimestamp,
        knownConditions: JSON.stringify(payload.knownConditions || []),
        registeredByUid: actor.uid,
        isSynthetic: true,
        version: 1,
      })
      .returning();

    const row = inserted[0];
    await recordAuditLog({
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'PATIENT_REGISTERED',
      targetType: 'patient',
      targetId: row.patientId,
      summary: `Registered synthetic patient ${row.patientId} (${row.village}) with documented consent.`,
    });

    return {
      duplicatePrevented: false,
      record: {
        patientId: row.patientId,
        fullName: row.fullName,
        ageYears: row.ageYears,
        sex: row.sex as 'female' | 'male' | 'other',
        village: row.village,
        blockName: row.blockName,
        phoneLastFour: row.phoneLastFour,
        consentObtained: row.consentObtained,
        consentTimestamp: row.consentTimestamp,
        knownConditions: safeParseJson<string[]>(row.knownConditions, []),
        registeredByUid: row.registeredByUid,
        isSynthetic: row.isSynthetic,
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        syncStatus: 'synced',
      },
    };
  } catch (error) {
    console.warn('Database query failed in createPatientRecord, falling back to memory store:', error);
    return saveToMemory();
  }
}

export async function createScreeningAndFollowUp(
  actor: { uid: string; role: UserRole; fullName: string },
  payload: {
    screeningId: string;
    patientId: string;
    screeningDate: string;
    systolicBp: number | null;
    diastolicBp: number | null;
    heartRateBpm: number | null;
    temperatureC: number | null;
    spo2Percent: number | null;
    randomBloodGlucoseMgDl: number | null;
    hemoglobinGDl: number | null;
    respiratoryRateBpm: number | null;
    isPregnant: boolean;
    gestationalWeeks: number | null;
    symptoms: string[];
    symptomDurationDays: number;
    medicalHistoryNotes: string;
    missingFields: string[];
    resultCategory: ScreeningCategory;
    flaggedReasons: unknown[];
    recommendedNextSteps: unknown[];
    aiSupplementalNote?: string;
    engineVersion: string;
    requiresFollowUp: boolean;
    followUpDueDate: string | null;
  }
): Promise<{ screeningId: string; duplicatePrevented: boolean }> {
  assertAuthorized(actor.role, 'record_screening');

  const saveToMemory = async (): Promise<{ screeningId: string; duplicatePrevented: boolean }> => {
    const existing = memoryStore.screenings.find((s) => s.screeningId === payload.screeningId);
    if (existing) {
      return { screeningId: existing.screeningId, duplicatePrevented: true };
    }

    const pat = memoryStore.patients.find((p) => p.patientId === payload.patientId);
    const newScreening: ScreeningRecord = {
      screeningId: payload.screeningId,
      patientId: payload.patientId,
      patientName: pat?.fullName || payload.patientId,
      patientVillage: pat?.village || 'Rampur',
      recordedByUid: actor.uid,
      recordedByName: actor.fullName,
      screeningDate: payload.screeningDate,
      systolicBp: payload.systolicBp,
      diastolicBp: payload.diastolicBp,
      heartRateBpm: payload.heartRateBpm,
      temperatureC: payload.temperatureC,
      spo2Percent: payload.spo2Percent,
      randomBloodGlucoseMgDl: payload.randomBloodGlucoseMgDl,
      hemoglobinGDl: payload.hemoglobinGDl,
      respiratoryRateBpm: payload.respiratoryRateBpm,
      isPregnant: payload.isPregnant,
      gestationalWeeks: payload.gestationalWeeks,
      symptoms: payload.symptoms || [],
      symptomDurationDays: payload.symptomDurationDays || 0,
      medicalHistoryNotes: payload.medicalHistoryNotes || '',
      missingFields: payload.missingFields || [],
      resultCategory: payload.resultCategory,
      flaggedReasons: payload.flaggedReasons as any,
      recommendedNextSteps: payload.recommendedNextSteps as any,
      aiSupplementalNote: payload.aiSupplementalNote || '',
      engineVersion: payload.engineVersion,
      requiresFollowUp: payload.requiresFollowUp,
      followUpDueDate: payload.followUpDueDate,
      version: 1,
      createdAt: new Date().toISOString(),
    };
    memoryStore.screenings.unshift(newScreening);

    if (payload.requiresFollowUp && payload.followUpDueDate) {
      const followUpId = `FUP-${payload.screeningId.replace('SCR-', '')}`;
      const newFollowUp: FollowUpRecord = {
        followUpId,
        patientId: payload.patientId,
        screeningId: payload.screeningId,
        referralId: null,
        status: 'pending',
        scheduledDate: payload.followUpDueDate,
        completedDate: null,
        notes: `Automated follow-up scheduled from screening (${payload.resultCategory}).`,
        recordedByUid: actor.uid,
        recordedByRole: actor.role,
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      memoryStore.followUps.unshift(newFollowUp);
    }

    await recordAuditLog({
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'SCREENING_RECORDED',
      targetType: 'screening',
      targetId: payload.screeningId,
      summary: `Screening ${payload.screeningId} for ${payload.patientId} evaluated as ${payload.resultCategory}.`,
    });

    return { screeningId: payload.screeningId, duplicatePrevented: false };
  };

  if (!isSqlConfigured) {
    return saveToMemory();
  }

  try {
    const existing = await db
      .select()
      .from(screeningRecords)
      .where(eq(screeningRecords.screeningId, payload.screeningId));

    if (existing.length > 0) {
      return {
        screeningId: existing[0].screeningId,
        duplicatePrevented: true,
      };
    }

    await db.insert(screeningRecords).values({
      screeningId: payload.screeningId,
      patientId: payload.patientId,
      recordedByUid: actor.uid,
      recordedByName: actor.fullName,
      screeningDate: payload.screeningDate,
      systolicBp: payload.systolicBp,
      diastolicBp: payload.diastolicBp,
      heartRateBpm: payload.heartRateBpm,
      temperatureC: payload.temperatureC != null ? String(payload.temperatureC) : null,
      spo2Percent: payload.spo2Percent,
      randomBloodGlucoseMgDl: payload.randomBloodGlucoseMgDl,
      hemoglobinGDl: payload.hemoglobinGDl != null ? String(payload.hemoglobinGDl) : null,
      respiratoryRateBpm: payload.respiratoryRateBpm,
      isPregnant: payload.isPregnant,
      gestationalWeeks: payload.gestationalWeeks,
      symptomsJson: JSON.stringify(payload.symptoms || []),
      symptomDurationDays: payload.symptomDurationDays || 0,
      medicalHistoryNotes: payload.medicalHistoryNotes || '',
      missingFieldsJson: JSON.stringify(payload.missingFields || []),
      resultCategory: payload.resultCategory,
      flaggedReasonsJson: JSON.stringify(payload.flaggedReasons || []),
      recommendedNextStepsJson: JSON.stringify(payload.recommendedNextSteps || []),
      aiSupplementalNote: payload.aiSupplementalNote || '',
      engineVersion: payload.engineVersion,
      requiresFollowUp: payload.requiresFollowUp,
      followUpDueDate: payload.followUpDueDate,
      version: 1,
    });

    if (payload.requiresFollowUp && payload.followUpDueDate) {
      const followUpId = `FUP-${payload.screeningId.replace('SCR-', '')}`;
      await db
        .insert(followUpRecords)
        .values({
          followUpId,
          patientId: payload.patientId,
          screeningId: payload.screeningId,
          referralId: null,
          status: 'pending',
          scheduledDate: payload.followUpDueDate,
          completedDate: null,
          notes: `Automated follow-up scheduled from screening (${payload.resultCategory}).`,
          recordedByUid: actor.uid,
          recordedByRole: actor.role,
          version: 1,
        })
        .onConflictDoNothing();
    }

    await recordAuditLog({
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'SCREENING_RECORDED',
      targetType: 'screening',
      targetId: payload.screeningId,
      summary: `Screening ${payload.screeningId} for ${payload.patientId} evaluated as ${payload.resultCategory}.`,
    });

    return {
      screeningId: payload.screeningId,
      duplicatePrevented: false,
    };
  } catch (error) {
    console.warn('Database query failed in createScreeningAndFollowUp, falling back to memory store:', error);
    return saveToMemory();
  }
}

export async function createReferralRecord(
  actor: { uid: string; role: UserRole },
  payload: {
    referralId: string;
    patientId: string;
    screeningId: string;
    priority: ScreeningCategory;
    reasonForReferral: string;
    destinationFacility: string;
    createdDate: string;
  }
): Promise<{ referralId: string; duplicatePrevented: boolean }> {
  assertAuthorized(actor.role, 'create_referral');

  const saveToMemory = async (): Promise<{ referralId: string; duplicatePrevented: boolean }> => {
    const existingById = memoryStore.referrals.find((r) => r.referralId === payload.referralId);
    if (existingById) {
      return { referralId: existingById.referralId, duplicatePrevented: true };
    }
    const existingByScreening = memoryStore.referrals.find((r) => r.screeningId === payload.screeningId);
    if (existingByScreening) {
      return { referralId: existingByScreening.referralId, duplicatePrevented: true };
    }

    const newReferral: ReferralRecord = {
      referralId: payload.referralId,
      patientId: payload.patientId,
      screeningId: payload.screeningId,
      priority: payload.priority,
      reasonForReferral: payload.reasonForReferral,
      destinationFacility: payload.destinationFacility,
      status: 'pending',
      assignedProfessional: 'Dr. Rajesh Verma (MO-PHC)',
      doctorNotes: '',
      followUpPlan: '',
      unableReason: '',
      createdByUid: actor.uid,
      createdDate: payload.createdDate,
      updatedDate: payload.createdDate,
      version: 1,
      isSimulated: true,
    };
    memoryStore.referrals.unshift(newReferral);

    await recordAuditLog({
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'REFERRAL_CREATED',
      targetType: 'referral',
      targetId: payload.referralId,
      summary: `Created simulated PHC referral ${payload.referralId} (${payload.priority}) for screening ${payload.screeningId}.`,
    });

    return { referralId: payload.referralId, duplicatePrevented: false };
  };

  if (!isSqlConfigured) {
    return saveToMemory();
  }

  try {
    const existingById = await db
      .select()
      .from(referrals)
      .where(eq(referrals.referralId, payload.referralId));

    if (existingById.length > 0) {
      return {
        referralId: existingById[0].referralId,
        duplicatePrevented: true,
      };
    }

    const existingByScreening = await db
      .select()
      .from(referrals)
      .where(eq(referrals.screeningId, payload.screeningId));

    if (existingByScreening.length > 0) {
      return {
        referralId: existingByScreening[0].referralId,
        duplicatePrevented: true,
      };
    }

    await db.insert(referrals).values({
      referralId: payload.referralId,
      patientId: payload.patientId,
      screeningId: payload.screeningId,
      priority: payload.priority,
      reasonForReferral: payload.reasonForReferral,
      destinationFacility: payload.destinationFacility,
      status: 'pending',
      assignedProfessional: 'Dr. Rajesh Verma (MO-PHC)',
      doctorNotes: '',
      followUpPlan: '',
      unableReason: '',
      createdByUid: actor.uid,
      createdDate: payload.createdDate,
      updatedDate: payload.createdDate,
      version: 1,
      isSimulated: true,
    });

    await recordAuditLog({
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'REFERRAL_CREATED',
      targetType: 'referral',
      targetId: payload.referralId,
      summary: `Created simulated PHC referral ${payload.referralId} (${payload.priority}) for screening ${payload.screeningId}.`,
    });

    return {
      referralId: payload.referralId,
      duplicatePrevented: false,
    };
  } catch (error) {
    console.warn('Database query failed in createReferralRecord, falling back to memory store:', error);
    return saveToMemory();
  }
}

export async function updateReferralByDoctor(
  actor: { uid: string; role: UserRole; fullName: string },
  payload: {
    referralId: string;
    status: ReferralStatus;
    assignedProfessional?: string;
    doctorNotes?: string;
    followUpPlan?: string;
    unableReason?: string;
    expectedVersion: number;
    forceResolveConflict?: boolean;
  }
): Promise<{
  success: boolean;
  conflict?: boolean;
  serverRecord?: ReferralRecord;
  newVersion?: number;
}> {
  assertAuthorized(actor.role, 'review_referral');

  const updateInMemory = async () => {
    const idx = memoryStore.referrals.findIndex((r) => r.referralId === payload.referralId);
    if (idx === -1) {
      throw new Error(`Referral ${payload.referralId} not found.`);
    }

    const current = memoryStore.referrals[idx];
    const conflictCheck = detectVersionConflict(
      { version: current.version },
      payload.expectedVersion
    );

    if (conflictCheck.hasConflict && !payload.forceResolveConflict) {
      return {
        success: false,
        conflict: true,
        serverRecord: { ...current },
      };
    }

    const nextVersion = current.version + 1;
    const todayIso = new Date().toISOString().slice(0, 10);

    const updated: ReferralRecord = {
      ...current,
      status: payload.status,
      assignedProfessional:
        payload.assignedProfessional !== undefined
          ? payload.assignedProfessional
          : current.assignedProfessional || actor.fullName,
      doctorNotes:
        payload.doctorNotes !== undefined ? payload.doctorNotes : current.doctorNotes,
      followUpPlan:
        payload.followUpPlan !== undefined ? payload.followUpPlan : current.followUpPlan,
      unableReason:
        payload.unableReason !== undefined ? payload.unableReason : current.unableReason,
      updatedDate: todayIso,
      version: nextVersion,
    };
    memoryStore.referrals[idx] = updated;

    await recordAuditLog({
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'REFERRAL_STATUS_UPDATED',
      targetType: 'referral',
      targetId: payload.referralId,
      summary: `PHC Referral ${payload.referralId} status updated to '${payload.status}' (v${nextVersion}).`,
    });

    return {
      success: true,
      newVersion: nextVersion,
    };
  };

  if (!isSqlConfigured) {
    return updateInMemory();
  }

  try {
    const existingRows = await db
      .select()
      .from(referrals)
      .where(eq(referrals.referralId, payload.referralId));

    if (existingRows.length === 0) {
      return updateInMemory();
    }

    const current = existingRows[0];
    const conflictCheck = detectVersionConflict(
      { version: current.version },
      payload.expectedVersion
    );

    if (conflictCheck.hasConflict && !payload.forceResolveConflict) {
      return {
        success: false,
        conflict: true,
        serverRecord: {
          referralId: current.referralId,
          patientId: current.patientId,
          screeningId: current.screeningId,
          priority: current.priority as ScreeningCategory,
          reasonForReferral: current.reasonForReferral,
          destinationFacility: current.destinationFacility,
          status: current.status as ReferralStatus,
          assignedProfessional: current.assignedProfessional,
          doctorNotes: current.doctorNotes,
          followUpPlan: current.followUpPlan,
          unableReason: current.unableReason,
          createdByUid: current.createdByUid,
          createdDate: current.createdDate,
          updatedDate: current.updatedDate,
          version: current.version,
          isSimulated: current.isSimulated,
        },
      };
    }

    const nextVersion = current.version + 1;
    const todayIso = new Date().toISOString().slice(0, 10);

    await db
      .update(referrals)
      .set({
        status: payload.status,
        assignedProfessional:
          payload.assignedProfessional !== undefined
            ? payload.assignedProfessional
            : current.assignedProfessional || actor.fullName,
        doctorNotes:
          payload.doctorNotes !== undefined ? payload.doctorNotes : current.doctorNotes,
        followUpPlan:
          payload.followUpPlan !== undefined ? payload.followUpPlan : current.followUpPlan,
        unableReason:
          payload.unableReason !== undefined ? payload.unableReason : current.unableReason,
        updatedDate: todayIso,
        version: nextVersion,
      })
      .where(eq(referrals.referralId, payload.referralId));

    await recordAuditLog({
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'REFERRAL_STATUS_UPDATED',
      targetType: 'referral',
      targetId: payload.referralId,
      summary: `PHC Referral ${payload.referralId} status updated to '${payload.status}' (v${nextVersion}).`,
    });

    return {
      success: true,
      newVersion: nextVersion,
    };
  } catch (error) {
    console.warn('Database query failed in updateReferralByDoctor, using memory store:', error);
    return updateInMemory();
  }
}

export async function updateFollowUpRecord(
  actor: { uid: string; role: UserRole },
  payload: {
    followUpId: string;
    status: FollowUpStatus;
    notes: string;
    completedDate?: string | null;
    expectedVersion: number;
    forceResolveConflict?: boolean;
  }
): Promise<{
  success: boolean;
  conflict?: boolean;
  serverVersion?: number;
  newVersion?: number;
}> {
  assertAuthorized(actor.role, 'record_worker_followup');

  const updateInMemory = async () => {
    const idx = memoryStore.followUps.findIndex((f) => f.followUpId === payload.followUpId);
    if (idx === -1) {
      throw new Error(`Follow-up record ${payload.followUpId} not found.`);
    }

    const current = memoryStore.followUps[idx];
    const conflictCheck = detectVersionConflict(
      { version: current.version },
      payload.expectedVersion
    );

    if (conflictCheck.hasConflict && !payload.forceResolveConflict) {
      return {
        success: false,
        conflict: true,
        serverVersion: current.version,
      };
    }

    const nextVersion = current.version + 1;
    const completedDate =
      payload.status === 'completed'
        ? payload.completedDate || new Date().toISOString().slice(0, 10)
        : null;

    const updated: FollowUpRecord = {
      ...current,
      status: payload.status,
      notes: payload.notes,
      completedDate,
      recordedByUid: actor.uid,
      recordedByRole: actor.role,
      version: nextVersion,
      updatedAt: new Date().toISOString(),
    };
    memoryStore.followUps[idx] = updated;

    await recordAuditLog({
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'FOLLOW_UP_UPDATED',
      targetType: 'follow_up',
      targetId: payload.followUpId,
      summary: `Follow-up ${payload.followUpId} marked '${payload.status}' (v${nextVersion}).`,
    });

    return {
      success: true,
      newVersion: nextVersion,
    };
  };

  if (!isSqlConfigured) {
    return updateInMemory();
  }

  try {
    const existingRows = await db
      .select()
      .from(followUpRecords)
      .where(eq(followUpRecords.followUpId, payload.followUpId));

    if (existingRows.length === 0) {
      return updateInMemory();
    }

    const current = existingRows[0];
    const conflictCheck = detectVersionConflict(
      { version: current.version },
      payload.expectedVersion
    );

    if (conflictCheck.hasConflict && !payload.forceResolveConflict) {
      return {
        success: false,
        conflict: true,
        serverVersion: current.version,
      };
    }

    const nextVersion = current.version + 1;
    const completedDate =
      payload.status === 'completed'
        ? payload.completedDate || new Date().toISOString().slice(0, 10)
        : null;

    await db
      .update(followUpRecords)
      .set({
        status: payload.status,
        notes: payload.notes,
        completedDate,
        recordedByUid: actor.uid,
        recordedByRole: actor.role,
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(followUpRecords.followUpId, payload.followUpId));

    await recordAuditLog({
      actorUid: actor.uid,
      actorRole: actor.role,
      action: 'FOLLOW_UP_UPDATED',
      targetType: 'follow_up',
      targetId: payload.followUpId,
      summary: `Follow-up ${payload.followUpId} marked '${payload.status}' (v${nextVersion}).`,
    });

    return {
      success: true,
      newVersion: nextVersion,
    };
  } catch (error) {
    console.warn('Database query failed in updateFollowUpRecord, using memory store:', error);
    return updateInMemory();
  }
}

export async function logSyncEventInDb(params: {
  syncEventId: string;
  entityType: string;
  entityId: string;
  action: string;
  status: string;
  deviceUid: string;
  conflictDetails?: string;
}) {
  memoryStore.syncEvents.push({
    syncEventId: params.syncEventId,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    status: params.status,
    deviceUid: params.deviceUid,
    conflictDetails: params.conflictDetails || '',
    createdAt: new Date().toISOString(),
  });

  if (!isSqlConfigured) return;

  try {
    await db
      .insert(syncEvents)
      .values({
        syncEventId: params.syncEventId,
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        status: params.status,
        deviceUid: params.deviceUid,
        conflictDetails: params.conflictDetails || '',
      })
      .onConflictDoNothing();
  } catch (error) {
    console.warn('Failed to record sync event in DB:', error);
  }
}
