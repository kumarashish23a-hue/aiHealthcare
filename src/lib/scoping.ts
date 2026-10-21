/**
 * scoping.ts — server-side data scoping for the workspace API.
 *
 * This is the enforcement point for "who can see what" on the API path
 * (the Drizzle/pg connection bypasses Postgres RLS by design; RLS
 * policies in supabase/migrations/0002 protect direct Supabase access —
 * see docs/AUTH_AND_SCOPING.md). This function is pure and runs in the
 * repository before any data leaves the server:
 *
 * - phc_admin: everything.
 * - doctor: referrals whose destination facility matches the doctor's
 *   own facility (facility core-name match), plus the patients,
 *   screenings and follow-ups linked to those referrals / patients,
 *   plus anything the doctor recorded personally.
 * - health_worker: patients she registered or whose village matches her
 *   assigned village (users.assigned_village or her health-worker
 *   profile), plus the screenings/referrals/follow-ups linked to those
 *   patients or recorded by her.
 * - audit logs: phc_admin sees all; doctor sees the scoped workspace's
 *   entries for scoped patients/referrals plus his own; health_worker
 *   sees only her own entries.
 * - profiles: phc_admin sees all; everyone else only their own profile.
 */

import type {
  AppUser,
  AuditLogEntry,
  FollowUpRecord,
  PatientRecord,
  ReferralRecord,
  ScreeningRecord,
  StoredProfile,
} from './types';

export interface WorkspaceData {
  patients: PatientRecord[];
  screenings: ScreeningRecord[];
  referrals: ReferralRecord[];
  followUps: FollowUpRecord[];
  auditLogs: AuditLogEntry[];
  profiles: StoredProfile[];
}

/** Reduce a facility string to its comparable core, e.g.
 *  "Simulated PHC Rampur, Sitapur — Uttar Pradesh (Demo)" -> "phc rampur"
 *  "PHC Rampur · Sitapur, Uttar Pradesh" -> "phc rampur" */
export function facilityCore(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\(demo\)/g, '')
    .split(/[·,—]/)[0]
    .replace(/^simulated\s+/, '')
    .trim();
}

export function actorAssignedVillage(actor: AppUser): string | null {
  return actor.assignedVillage || actor.workerProfile?.assignedVillage || null;
}

export function scopeWorkspaceData(actor: AppUser, data: WorkspaceData): WorkspaceData {
  if (actor.role === 'phc_admin') {
    return data;
  }

  if (actor.role === 'doctor') {
    const myFacility = facilityCore(actor.facilityName);
    const scopedReferrals = data.referrals.filter((r) => {
      const dest = facilityCore(r.destinationFacility);
      return (
        r.createdByUid === actor.uid ||
        (myFacility !== '' && dest !== '' && (dest === myFacility || dest.includes(myFacility) || myFacility.includes(dest)))
      );
    });
    const patientIds = new Set(scopedReferrals.map((r) => r.patientId));
    const screeningIds = new Set(scopedReferrals.map((r) => r.screeningId));
    // Patients linked to scoped referrals, plus patients the doctor registered.
    const scopedPatients = data.patients.filter(
      (p) => patientIds.has(p.patientId) || p.registeredByUid === actor.uid
    );
    scopedPatients.forEach((p) => patientIds.add(p.patientId));
    const scopedScreenings = data.screenings.filter(
      (s) =>
        screeningIds.has(s.screeningId) ||
        patientIds.has(s.patientId) ||
        s.recordedByUid === actor.uid
    );
    scopedScreenings.forEach((s) => screeningIds.add(s.screeningId));
    const scopedFollowUps = data.followUps.filter(
      (f) =>
        patientIds.has(f.patientId) ||
        screeningIds.has(f.screeningId) ||
        f.recordedByUid === actor.uid
    );
    const scopedTargetIds = new Set<string>([
      ...patientIds,
      ...screeningIds,
      ...scopedReferrals.map((r) => r.referralId),
      ...scopedFollowUps.map((f) => f.followUpId),
    ]);
    const scopedAudit = data.auditLogs.filter(
      (a) => a.actorUid === actor.uid || scopedTargetIds.has(a.targetId)
    );
    return {
      patients: scopedPatients,
      screenings: scopedScreenings,
      referrals: scopedReferrals,
      followUps: scopedFollowUps,
      auditLogs: scopedAudit,
      profiles: data.profiles.filter((p) => p.uid === actor.uid),
    };
  }

  // health_worker
  const village = actorAssignedVillage(actor);
  const scopedPatients = data.patients.filter(
    (p) =>
      p.registeredByUid === actor.uid ||
      (village !== null && p.village.toLowerCase() === village.toLowerCase())
  );
  const patientIds = new Set(scopedPatients.map((p) => p.patientId));
  const scopedScreenings = data.screenings.filter(
    (s) => patientIds.has(s.patientId) || s.recordedByUid === actor.uid
  );
  const screeningIds = new Set(scopedScreenings.map((s) => s.screeningId));
  const scopedReferrals = data.referrals.filter(
    (r) =>
      patientIds.has(r.patientId) ||
      screeningIds.has(r.screeningId) ||
      r.createdByUid === actor.uid
  );
  const scopedFollowUps = data.followUps.filter(
    (f) =>
      patientIds.has(f.patientId) ||
      screeningIds.has(f.screeningId) ||
      f.recordedByUid === actor.uid
  );
  return {
    patients: scopedPatients,
    screenings: scopedScreenings,
    referrals: scopedReferrals,
    followUps: scopedFollowUps,
    auditLogs: data.auditLogs.filter((a) => a.actorUid === actor.uid),
    profiles: data.profiles.filter((p) => p.uid === actor.uid),
  };
}

/** Can this actor access this one patient? Used to guard mutations. */
export function canAccessPatient(
  actor: AppUser,
  patient: Pick<PatientRecord, 'registeredByUid' | 'village'>
): boolean {
  if (actor.role === 'phc_admin' || actor.role === 'doctor') return true;
  if (patient.registeredByUid === actor.uid) return true;
  const village = actorAssignedVillage(actor);
  return village !== null && patient.village.toLowerCase() === village.toLowerCase();
}
