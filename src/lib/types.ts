export type UserRole = 'health_worker' | 'doctor' | 'phc_admin';

export type LanguageCode = 'en' | 'hi';

export type ScreeningCategory =
  | 'incomplete_information'
  | 'routine_follow_up'
  | 'further_assessment_needed'
  | 'urgent_escalation';

export type ReferralStatus =
  | 'pending'
  | 'acknowledged'
  | 'under_review'
  | 'completed'
  | 'unable_to_complete';

export type FollowUpStatus = 'pending' | 'acknowledged' | 'completed' | 'overdue';

export type SyncState = 'online_synced' | 'offline' | 'pending_sync' | 'syncing' | 'sync_error' | 'conflict';

export interface AppUser {
  uid: string;
  email: string;
  fullName: string;
  role: UserRole;
  facilityName: string;
  preferredLanguage: LanguageCode;
  isDemo?: boolean;
  /** Set from users.is_active (migration 0002). Inactive users are rejected at auth. */
  isActive?: boolean;
  /** Set from users.assigned_village (migration 0002); health-worker scoping key. */
  assignedVillage?: string;
  workerProfile?: {
    workerCode: string;
    assignedVillage: string;
    blockName: string;
    district: string;
    primaryPhc: string;
    phoneLastFour: string;
  };
}

export interface StoredProfile {
  uid: string;
  role: UserRole;
  fullName: string;
  phoneLastFour: string;
  facilityName: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface PatientRecord {
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
  registeredByUid: string;
  isSynthetic: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  syncStatus?: 'synced' | 'pending' | 'syncing' | 'failed' | 'conflict';
}

export interface FlaggedReason {
  code: string;
  field: string;
  severity: 'urgent' | 'moderate' | 'missing' | 'info';
  titleEn: string;
  titleHi: string;
  explanationEn: string;
  explanationHi: string;
  observedValue: string;
  referenceRule: string;
}

export interface RecommendedStep {
  stepOrder: number;
  actionEn: string;
  actionHi: string;
  timeframeEn: string;
  timeframeHi: string;
}

export interface CbacInput {
  ageScore: 0 | 1 | 2; // <30 (0), 30-49 (1), >=50 (2)
  tobaccoScore: 0 | 1 | 2; // Never (0), Past/Occasional (1), Daily (2)
  alcoholScore: 0 | 1; // No (0), Daily/Frequent (1)
  waistScore: 0 | 1 | 2; // Normal (0), High (1), Very High (2)
  physicalActivityScore: 0 | 1; // >=150m/wk (0), <150m/wk (1)
  familyHistoryScore: 0 | 2; // No (0), Yes - BP/DM/Heart (2)
}

export interface CbacEvaluation {
  totalScore: number; // 0 to 10
  isHighNcdRisk: boolean; // score > 4 requires PHC NCD clinic screening
  riskLabelEn: string;
  riskLabelHi: string;
}

export interface VillageClusterAlert {
  village: string;
  clusterType: 'febrile_respiratory' | 'maternal_high_risk' | 'severe_ncd';
  titleEn: string;
  titleHi: string;
  affectedCount: number;
  patientIds: string[];
  severity: 'urgent' | 'moderate';
  recommendationEn: string;
  recommendationHi: string;
}

export interface ScreeningInput {
  patientId: string;
  patientAgeYears?: number;
  patientSex?: 'female' | 'male' | 'other';
  systolicBp?: number | null;
  diastolicBp?: number | null;
  heartRateBpm?: number | null;
  temperatureC?: number | null;
  spo2Percent?: number | null;
  randomBloodGlucoseMgDl?: number | null;
  hemoglobinGDl?: number | null;
  respiratoryRateBpm?: number | null;
  isPregnant?: boolean;
  gestationalWeeks?: number | null;
  symptoms: string[];
  symptomDurationDays: number;
  medicalHistoryNotes?: string;
  cbacInput?: CbacInput;
}

export interface ScreeningEvaluationResult {
  isValid: boolean;
  validationErrors: { field: string; messageEn: string; messageHi: string }[];
  resultCategory: ScreeningCategory;
  missingFields: string[];
  flaggedReasons: FlaggedReason[];
  recommendedNextSteps: RecommendedStep[];
  requiresReferral: boolean;
  requiresFollowUp: boolean;
  suggestedFollowUpDays: number;
  disclaimerEn: string;
  disclaimerHi: string;
  engineVersion: string;
  cbacEvaluation?: CbacEvaluation;
}

export interface ScreeningRecord {
  screeningId: string;
  patientId: string;
  patientName?: string;
  patientVillage?: string;
  patientAge?: number;
  patientSex?: string;
  recordedByUid: string;
  recordedByName: string;
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
  flaggedReasons: FlaggedReason[];
  recommendedNextSteps: RecommendedStep[];
  aiSupplementalNote: string;
  engineVersion: string;
  requiresFollowUp: boolean;
  followUpDueDate: string | null;
  version: number;
  createdAt: string;
  syncStatus?: 'synced' | 'pending' | 'syncing' | 'failed' | 'conflict';
}

export interface ReferralRecord {
  referralId: string;
  patientId: string;
  patientName?: string;
  patientAge?: number;
  patientSex?: string;
  patientVillage?: string;
  screeningId: string;
  priority: ScreeningCategory;
  reasonForReferral: string;
  destinationFacility: string;
  status: ReferralStatus;
  assignedProfessional: string;
  doctorNotes: string;
  followUpPlan: string;
  unableReason: string;
  createdByUid: string;
  createdDate: string;
  updatedDate: string;
  version: number;
  isSimulated: boolean;
  syncStatus?: 'synced' | 'pending' | 'syncing' | 'failed' | 'conflict';
}

export interface FollowUpRecord {
  followUpId: string;
  patientId: string;
  patientName?: string;
  patientVillage?: string;
  screeningId: string;
  referralId: string | null;
  status: FollowUpStatus;
  scheduledDate: string;
  completedDate: string | null;
  notes: string;
  recordedByUid: string;
  recordedByRole: string;
  version: number;
  updatedAt: string;
  syncStatus?: 'synced' | 'pending' | 'syncing' | 'failed' | 'conflict';
}

export interface AuditLogEntry {
  auditId: string;
  actorUid: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  createdAt: string;
}

export interface DashboardMetrics {
  totalPatients: number;
  totalScreenings: number;
  incomingReferrals: number;
  referralsAwaitingReview: number;
  completedReferrals: number;
  unableReferrals: number;
  overdueFollowUps: number;
  pendingFollowUps: number;
  completedFollowUps: number;
  screeningsByCategory: {
    category: ScreeningCategory;
    label: string;
    count: number;
  }[];
  referralsByStatus: {
    status: ReferralStatus;
    label: string;
    count: number;
  }[];
  followUpsByStatus: {
    status: FollowUpStatus;
    label: string;
    count: number;
  }[];
  screeningsByVillage: {
    village: string;
    screenings: number;
    urgentCount: number;
  }[];
}
