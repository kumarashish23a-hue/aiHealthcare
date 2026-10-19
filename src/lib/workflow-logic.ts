import {
  DashboardMetrics,
  FollowUpRecord,
  FollowUpStatus,
  PatientRecord,
  ReferralRecord,
  ReferralStatus,
  ScreeningCategory,
  ScreeningRecord,
  UserRole,
} from './types';
import { formatCategoryLabel, formatFollowUpStatus, formatReferralStatus } from './i18n';

export type ProtectedAction =
  | 'register_patient'
  | 'record_screening'
  | 'create_referral'
  | 'record_worker_followup'
  | 'acknowledge_referral'
  | 'review_referral'
  | 'complete_referral'
  | 'record_doctor_plan'
  | 'access_phc_dashboard';

const ROLE_PERMISSIONS: Record<UserRole, ProtectedAction[]> = {
  health_worker: [
    'register_patient',
    'record_screening',
    'create_referral',
    'record_worker_followup',
  ],
  doctor: [
    'register_patient',
    'record_screening',
    'create_referral',
    'record_worker_followup',
    'acknowledge_referral',
    'review_referral',
    'complete_referral',
    'record_doctor_plan',
    'access_phc_dashboard',
  ],
  phc_admin: [
    'register_patient',
    'record_screening',
    'create_referral',
    'record_worker_followup',
    'acknowledge_referral',
    'review_referral',
    'complete_referral',
    'record_doctor_plan',
    'access_phc_dashboard',
  ],
};

export function isAuthorizedForAction(role: UserRole, action: ProtectedAction): boolean {
  const allowed = ROLE_PERMISSIONS[role] || [];
  return allowed.includes(action);
}

export function assertAuthorized(role: UserRole, action: ProtectedAction): void {
  if (!isAuthorizedForAction(role, action)) {
    throw new Error(
      `AuthorizationError: Role '${role}' is not permitted to perform '${action}'.`
    );
  }
}

export function detectDuplicateReferral(
  existingReferrals: ReferralRecord[],
  newReferral: { referralId: string; screeningId: string }
): { isDuplicate: boolean; existingRecord?: ReferralRecord; reason?: string } {
  const byId = existingReferrals.find((r) => r.referralId === newReferral.referralId);
  if (byId) {
    return {
      isDuplicate: true,
      existingRecord: byId,
      reason: `Referral ID ${newReferral.referralId} already exists.`,
    };
  }
  const byScreening = existingReferrals.find((r) => r.screeningId === newReferral.screeningId);
  if (byScreening) {
    return {
      isDuplicate: true,
      existingRecord: byScreening,
      reason: `A referral (${byScreening.referralId}) already exists for screening ${newReferral.screeningId}.`,
    };
  }
  return { isDuplicate: false };
}

export function detectVersionConflict<T extends { version: number }>(
  serverRecord: T,
  clientExpectedVersion: number
): { hasConflict: boolean; serverVersion: number; clientVersion: number; message?: string } {
  if (clientExpectedVersion < serverRecord.version) {
    return {
      hasConflict: true,
      serverVersion: serverRecord.version,
      clientVersion: clientExpectedVersion,
      message: `Conflict detected: Server record is at version ${serverRecord.version}, but update was based on version ${clientExpectedVersion}.`,
    };
  }
  return {
    hasConflict: false,
    serverVersion: serverRecord.version,
    clientVersion: clientExpectedVersion,
  };
}

export function calculateDashboardMetrics(
  patientsList: PatientRecord[],
  screeningsList: ScreeningRecord[],
  referralsList: ReferralRecord[],
  followUpsList: FollowUpRecord[],
  referenceDateIso: string = new Date().toISOString().slice(0, 10)
): DashboardMetrics {
  // Dynamically evaluate overdue status if a pending/acknowledged followUp is past scheduledDate
  const normalizedFollowUps: FollowUpRecord[] = followUpsList.map((f) => {
    if (
      (f.status === 'pending' || f.status === 'acknowledged') &&
      f.scheduledDate < referenceDateIso
    ) {
      return { ...f, status: 'overdue' as FollowUpStatus };
    }
    return f;
  });

  const totalPatients = patientsList.length;
  const totalScreenings = screeningsList.length;
  const incomingReferrals = referralsList.length;
  const referralsAwaitingReview = referralsList.filter(
    (r) => r.status === 'pending' || r.status === 'acknowledged' || r.status === 'under_review'
  ).length;
  const completedReferrals = referralsList.filter((r) => r.status === 'completed').length;
  const unableReferrals = referralsList.filter((r) => r.status === 'unable_to_complete').length;

  const overdueFollowUps = normalizedFollowUps.filter((f) => f.status === 'overdue').length;
  const pendingFollowUps = normalizedFollowUps.filter(
    (f) => f.status === 'pending' || f.status === 'acknowledged'
  ).length;
  const completedFollowUps = normalizedFollowUps.filter((f) => f.status === 'completed').length;

  const categories: ScreeningCategory[] = [
    'urgent_escalation',
    'further_assessment_needed',
    'routine_follow_up',
    'incomplete_information',
  ];

  const screeningsByCategory = categories.map((category) => ({
    category,
    label: formatCategoryLabel(category, 'en'),
    count: screeningsList.filter((s) => s.resultCategory === category).length,
  }));

  const refStatuses: ReferralStatus[] = [
    'pending',
    'acknowledged',
    'under_review',
    'completed',
    'unable_to_complete',
  ];

  const referralsByStatus = refStatuses.map((status) => ({
    status,
    label: formatReferralStatus(status, 'en'),
    count: referralsList.filter((r) => r.status === status).length,
  }));

  const fupStatuses: FollowUpStatus[] = ['overdue', 'pending', 'acknowledged', 'completed'];
  const followUpsByStatus = fupStatuses.map((status) => ({
    status,
    label: formatFollowUpStatus(status, 'en'),
    count: normalizedFollowUps.filter((f) => f.status === status).length,
  }));

  // Group screenings by patient village
  const patientMap = new Map(patientsList.map((p) => [p.patientId, p]));
  const villageStatsMap = new Map<string, { screenings: number; urgentCount: number }>();

  for (const s of screeningsList) {
    const village = s.patientVillage || patientMap.get(s.patientId)?.village || 'Rampur';
    const current = villageStatsMap.get(village) || { screenings: 0, urgentCount: 0 };
    current.screenings += 1;
    if (s.resultCategory === 'urgent_escalation') {
      current.urgentCount += 1;
    }
    villageStatsMap.set(village, current);
  }

  const screeningsByVillage = Array.from(villageStatsMap.entries()).map(([village, stats]) => ({
    village,
    screenings: stats.screenings,
    urgentCount: stats.urgentCount,
  }));

  return {
    totalPatients,
    totalScreenings,
    incomingReferrals,
    referralsAwaitingReview,
    completedReferrals,
    unableReferrals,
    overdueFollowUps,
    pendingFollowUps,
    completedFollowUps,
    screeningsByCategory,
    referralsByStatus,
    followUpsByStatus,
    screeningsByVillage,
  };
}
