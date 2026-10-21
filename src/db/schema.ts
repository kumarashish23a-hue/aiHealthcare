import { relations } from 'drizzle-orm';
import { boolean, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  fullName: text('full_name').notNull().default('ASHA Health Worker'),
  role: text('role').notNull().default('health_worker'), // 'health_worker' | 'doctor' | 'phc_admin'
  facilityName: text('facility_name').notNull().default('PHC Rampur, Sitapur, Uttar Pradesh'),
  preferredLanguage: text('preferred_language').notNull().default('en'),
  // Added in migration 0002: account activation + health-worker scoping.
  isActive: boolean('is_active').notNull().default(true),
  assignedVillage: text('assigned_village'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const facilities = pgTable('facilities', {
  id: serial('id').primaryKey(),
  facilityId: text('facility_id').notNull().unique(),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'PHC' | 'CHC' | 'SubCentre' | 'DistrictHospital'
  village: text('village'),
  blockName: text('block_name').notNull(),
  district: text('district').notNull(),
  state: text('state').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const healthWorkerProfiles = pgTable('health_worker_profiles', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .references(() => users.uid)
    .notNull()
    .unique(),
  workerCode: text('worker_code').notNull().unique(),
  assignedVillage: text('assigned_village').notNull(),
  blockName: text('block_name').notNull(),
  district: text('district').notNull(),
  primaryPhc: text('primary_phc').notNull(),
  phoneLastFour: text('phone_last_four').notNull(),
  activeStatus: boolean('active_status').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const patients = pgTable('patients', {
  id: serial('id').primaryKey(),
  patientId: text('patient_id').notNull().unique(),
  fullName: text('full_name').notNull(),
  ageYears: integer('age_years').notNull(),
  sex: text('sex').notNull(), // 'female' | 'male' | 'other'
  village: text('village').notNull(),
  blockName: text('block_name').notNull(),
  phoneLastFour: text('phone_last_four').notNull(),
  consentObtained: boolean('consent_obtained').notNull(),
  consentTimestamp: text('consent_timestamp').notNull(),
  knownConditions: text('known_conditions').notNull().default(''),
  registeredByUid: text('registered_by_uid').notNull(),
  isSynthetic: boolean('is_synthetic').notNull().default(true),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const screeningRecords = pgTable('screening_records', {
  id: serial('id').primaryKey(),
  screeningId: text('screening_id').notNull().unique(),
  patientId: text('patient_id')
    .references(() => patients.patientId)
    .notNull(),
  recordedByUid: text('recorded_by_uid').notNull(),
  recordedByName: text('recorded_by_name').notNull(),
  screeningDate: text('screening_date').notNull(),
  systolicBp: integer('systolic_bp'),
  diastolicBp: integer('diastolic_bp'),
  heartRateBpm: integer('heart_rate_bpm'),
  temperatureC: text('temperature_c'),
  spo2Percent: integer('spo2_percent'),
  randomBloodGlucoseMgDl: integer('random_blood_glucose_mg_dl'),
  hemoglobinGDl: text('hemoglobin_g_dl'),
  respiratoryRateBpm: integer('respiratory_rate_bpm'),
  isPregnant: boolean('is_pregnant').notNull().default(false),
  gestationalWeeks: integer('gestational_weeks'),
  symptomsJson: text('symptoms_json').notNull(),
  symptomDurationDays: integer('symptom_duration_days').notNull().default(0),
  medicalHistoryNotes: text('medical_history_notes').notNull().default(''),
  missingFieldsJson: text('missing_fields_json').notNull().default('[]'),
  resultCategory: text('result_category').notNull(), // 'incomplete_information' | 'routine_follow_up' | 'further_assessment_needed' | 'urgent_escalation'
  flaggedReasonsJson: text('flagged_reasons_json').notNull(),
  recommendedNextStepsJson: text('recommended_next_steps_json').notNull(),
  aiSupplementalNote: text('ai_supplemental_note').notNull().default(''),
  engineVersion: text('engine_version').notNull().default('PROTOTYPE-RULES-v1.0'),
  requiresFollowUp: boolean('requires_follow_up').notNull().default(false),
  followUpDueDate: text('follow_up_due_date'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const referrals = pgTable('referrals', {
  id: serial('id').primaryKey(),
  referralId: text('referral_id').notNull().unique(),
  patientId: text('patient_id')
    .references(() => patients.patientId)
    .notNull(),
  screeningId: text('screening_id')
    .references(() => screeningRecords.screeningId)
    .notNull()
    .unique(),
  priority: text('priority').notNull(), // 'urgent_escalation' | 'further_assessment_needed' | 'routine_follow_up'
  reasonForReferral: text('reason_for_referral').notNull(),
  destinationFacility: text('destination_facility').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'acknowledged' | 'under_review' | 'completed' | 'unable_to_complete'
  assignedProfessional: text('assigned_professional').notNull().default(''),
  doctorNotes: text('doctor_notes').notNull().default(''),
  followUpPlan: text('follow_up_plan').notNull().default(''),
  unableReason: text('unable_reason').notNull().default(''),
  createdByUid: text('created_by_uid').notNull(),
  createdDate: text('created_date').notNull(),
  updatedDate: text('updated_date').notNull(),
  version: integer('version').notNull().default(1),
  isSimulated: boolean('is_simulated').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const followUpRecords = pgTable('follow_up_records', {
  id: serial('id').primaryKey(),
  followUpId: text('follow_up_id').notNull().unique(),
  patientId: text('patient_id')
    .references(() => patients.patientId)
    .notNull(),
  screeningId: text('screening_id')
    .references(() => screeningRecords.screeningId)
    .notNull(),
  referralId: text('referral_id'),
  status: text('status').notNull().default('pending'), // 'pending' | 'acknowledged' | 'completed' | 'overdue'
  scheduledDate: text('scheduled_date').notNull(),
  completedDate: text('completed_date'),
  notes: text('notes').notNull().default(''),
  recordedByUid: text('recorded_by_uid').notNull(),
  recordedByRole: text('recorded_by_role').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const syncEvents = pgTable('sync_events', {
  id: serial('id').primaryKey(),
  syncEventId: text('sync_event_id').notNull().unique(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  status: text('status').notNull(),
  deviceUid: text('device_uid').notNull(),
  conflictDetails: text('conflict_details').notNull().default(''),
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  auditId: text('audit_id').notNull().unique(),
  actorUid: text('actor_uid').notNull(),
  actorRole: text('actor_role').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  summary: text('summary').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ one }) => ({
  profile: one(healthWorkerProfiles, {
    fields: [users.uid],
    references: [healthWorkerProfiles.userUid],
  }),
}));

export const patientsRelations = relations(patients, ({ many }) => ({
  screenings: many(screeningRecords),
  referrals: many(referrals),
  followUps: many(followUpRecords),
}));

export const screeningRecordsRelations = relations(screeningRecords, ({ one, many }) => ({
  patient: one(patients, {
    fields: [screeningRecords.patientId],
    references: [patients.patientId],
  }),
  referral: one(referrals, {
    fields: [screeningRecords.screeningId],
    references: [referrals.screeningId],
  }),
  followUps: many(followUpRecords),
}));

export const referralsRelations = relations(referrals, ({ one }) => ({
  patient: one(patients, {
    fields: [referrals.patientId],
    references: [patients.patientId],
  }),
  screening: one(screeningRecords, {
    fields: [referrals.screeningId],
    references: [screeningRecords.screeningId],
  }),
}));

export const followUpRecordsRelations = relations(followUpRecords, ({ one }) => ({
  patient: one(patients, {
    fields: [followUpRecords.patientId],
    references: [patients.patientId],
  }),
  screening: one(screeningRecords, {
    fields: [followUpRecords.screeningId],
    references: [screeningRecords.screeningId],
  }),
}));
