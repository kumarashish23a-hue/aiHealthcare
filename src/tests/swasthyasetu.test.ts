import { describe, expect, it } from 'vitest';
import {
  enforceSafetyGuardrailOnAiOutput,
  evaluateScreening,
  patientRegistrationSchema,
} from '../lib/screening-engine';
import {
  assertAuthorized,
  calculateDashboardMetrics,
  detectDuplicateReferral,
  detectVersionConflict,
  isAuthorizedForAction,
} from '../lib/workflow-logic';
import { enqueueOfflineMutation, QueuedSyncMutation } from '../lib/offline-db';
import { processSyncQueue } from '../lib/sync-engine';
import {
  FollowUpRecord,
  PatientRecord,
  ReferralRecord,
  ScreeningRecord,
} from '../lib/types';

describe('SwasthyaSetu AI — Comprehensive Clinical, Security & Offline Suite', () => {
  // 1. Input Validation
  describe('1. Input Validation', () => {
    it('validates patient registration with consent and 4-digit phone minimization', () => {
      const valid = patientRegistrationSchema.safeParse({
        patientId: 'PAT-RMP-2001',
        fullName: 'Sunita Kumari (Synthetic)',
        ageYears: 34,
        sex: 'female',
        village: 'Rampur',
        blockName: 'Sitapur Rural',
        phoneLastFour: '4912',
        consentObtained: true,
        knownConditions: ['Anemia'],
      });
      expect(valid.success).toBe(true);

      const missingConsent = patientRegistrationSchema.safeParse({
        patientId: 'PAT-RMP-2002',
        fullName: 'Sunita Kumari',
        ageYears: 34,
        sex: 'female',
        village: 'Rampur',
        blockName: 'Sitapur Rural',
        phoneLastFour: '4912',
        consentObtained: false,
      });
      expect(missingConsent.success).toBe(false);
    });

    it('rejects out-of-range measurements and logically inverted blood pressure', () => {
      const invertedBp = evaluateScreening({
        patientId: 'PAT-RMP-1001',
        systolicBp: 85,
        diastolicBp: 95,
        temperatureC: 37.0,
        spo2Percent: 98,
        symptoms: [],
        symptomDurationDays: 0,
      });
      expect(invertedBp.isValid).toBe(false);
      expect(invertedBp.validationErrors.some((e) => e.field === 'bloodPressure')).toBe(true);

      const invalidSpo2 = evaluateScreening({
        patientId: 'PAT-RMP-1001',
        systolicBp: 120,
        diastolicBp: 80,
        temperatureC: 37.0,
        spo2Percent: 108,
        symptoms: [],
        symptomDurationDays: 0,
      });
      expect(invalidSpo2.isValid).toBe(false);
      expect(invalidSpo2.validationErrors.some((e) => e.field === 'spo2Percent')).toBe(true);
    });
  });

  // 2. Screening Result Generation & AI Guardrails
  describe('2. Screening Result Generation & Safety Guardrails', () => {
    it('classifies urgent escalation for severe BP or hypoxia or red-flag symptoms', () => {
      const urgentResult = evaluateScreening({
        patientId: 'PAT-RMP-1001',
        systolicBp: 186,
        diastolicBp: 114,
        temperatureC: 37.2,
        spo2Percent: 90,
        symptoms: ['chest_pain'],
        symptomDurationDays: 1,
      });
      expect(urgentResult.isValid).toBe(true);
      expect(urgentResult.resultCategory).toBe('urgent_escalation');
      expect(urgentResult.requiresReferral).toBe(true);
      expect(urgentResult.flaggedReasons.length).toBeGreaterThanOrEqual(3);
      expect(urgentResult.disclaimerEn).toContain('NOT a clinical diagnosis');
    });

    it('classifies further_assessment_needed for moderate hypertension or persistent cough > 14d', () => {
      const moderateResult = evaluateScreening({
        patientId: 'PAT-RMP-1002',
        systolicBp: 148,
        diastolicBp: 94,
        temperatureC: 37.1,
        spo2Percent: 96,
        symptoms: ['persistent_cough_2w'],
        symptomDurationDays: 16,
      });
      expect(moderateResult.resultCategory).toBe('further_assessment_needed');
      expect(moderateResult.requiresReferral).toBe(true);
    });

    it('classifies routine_follow_up when all core vitals are present and within bounds', () => {
      const routineResult = evaluateScreening({
        patientId: 'PAT-RMP-1005',
        systolicBp: 118,
        diastolicBp: 76,
        temperatureC: 36.8,
        spo2Percent: 98,
        symptoms: [],
        symptomDurationDays: 0,
      });
      expect(routineResult.resultCategory).toBe('routine_follow_up');
      expect(routineResult.requiresReferral).toBe(false);
    });

    it('prevents an AI language model from overriding urgent_escalation or claiming diagnosis', () => {
      const urgentEval = evaluateScreening({
        patientId: 'PAT-RMP-1001',
        systolicBp: 190,
        diastolicBp: 120,
        temperatureC: 37.0,
        spo2Percent: 96,
        symptoms: [],
        symptomDurationDays: 0,
      });

      const guarded = enforceSafetyGuardrailOnAiOutput(
        urgentEval,
        'Patient has a confirmed diagnosis of mild stress and can stay home.',
        'routine_follow_up'
      );
      expect(guarded.finalCategory).toBe('urgent_escalation');
      expect(guarded.overrideBlocked).toBe(true);
      expect(guarded.safeSupplementalNote).not.toContain('confirmed diagnosis');
    });
  });

  // 3. Missing Data Handling
  describe('3. Missing Data Handling', () => {
    it('never interprets missing core measurements as normal (returns incomplete_information)', () => {
      const missingResult = evaluateScreening({
        patientId: 'PAT-RMP-1004',
        systolicBp: 122,
        diastolicBp: 78,
        temperatureC: null,
        spo2Percent: null,
        symptoms: [],
        symptomDurationDays: 0,
      });
      expect(missingResult.resultCategory).toBe('incomplete_information');
      expect(missingResult.missingFields).toContain('temperatureC');
      expect(missingResult.missingFields).toContain('spo2Percent');
    });

    it('prioritizes urgent_escalation even if another measurement is missing', () => {
      const urgentWithMissing = evaluateScreening({
        patientId: 'PAT-RMP-1004',
        systolicBp: 122,
        diastolicBp: 78,
        temperatureC: null,
        spo2Percent: 88, // critical hypoxia
        symptoms: ['severe_breathlessness'],
        symptomDurationDays: 1,
      });
      expect(urgentWithMissing.resultCategory).toBe('urgent_escalation');
      expect(urgentWithMissing.missingFields).toContain('temperatureC');
    });
  });

  // 4 & 8. Referral Creation, Updates, and Duplicate Prevention
  describe('4 & 8. Referral Lifecycle & Duplicate Prevention', () => {
    const existingReferrals: ReferralRecord[] = [
      {
        referralId: 'REF-PHC-5001',
        patientId: 'PAT-RMP-1001',
        screeningId: 'SCR-2026-8801',
        priority: 'urgent_escalation',
        reasonForReferral: 'BP 186/114',
        destinationFacility: 'Simulated PHC Rampur (Demo)',
        status: 'pending',
        assignedProfessional: 'Dr. R. Verma',
        doctorNotes: '',
        followUpPlan: '',
        unableReason: '',
        createdByUid: 'demo-asha-01',
        createdDate: '2026-10-18',
        updatedDate: '2026-10-18',
        version: 1,
        isSimulated: true,
      },
    ];

    it('blocks duplicate referrals with the same referralId or screeningId', () => {
      const dupByScreening = detectDuplicateReferral(existingReferrals, {
        referralId: 'REF-PHC-9999',
        screeningId: 'SCR-2026-8801',
      });
      expect(dupByScreening.isDuplicate).toBe(true);

      const uniqueRef = detectDuplicateReferral(existingReferrals, {
        referralId: 'REF-PHC-5002',
        screeningId: 'SCR-2026-8802',
      });
      expect(uniqueRef.isDuplicate).toBe(false);
    });
  });

  // 5. Authorization and Access Restrictions (RBAC)
  describe('5. Authorization and Role-Based Access Restrictions', () => {
    it('allows health_worker to register patients and record screenings but blocks PHC doctor actions', () => {
      expect(isAuthorizedForAction('health_worker', 'register_patient')).toBe(true);
      expect(isAuthorizedForAction('health_worker', 'record_screening')).toBe(true);
      expect(isAuthorizedForAction('health_worker', 'review_referral')).toBe(false);
      expect(isAuthorizedForAction('health_worker', 'complete_referral')).toBe(false);
      expect(() => assertAuthorized('health_worker', 'review_referral')).toThrow(
        /AuthorizationError/
      );
    });

    it('allows doctor and phc_admin to review and complete referrals', () => {
      expect(isAuthorizedForAction('doctor', 'review_referral')).toBe(true);
      expect(isAuthorizedForAction('doctor', 'complete_referral')).toBe(true);
      expect(isAuthorizedForAction('phc_admin', 'access_phc_dashboard')).toBe(true);
    });
  });

  // 6, 7 & 9. Offline Record Queueing, Sync Retries & Conflict Handling
  describe('6, 7 & 9. Offline Queueing, Synchronization Retries & Conflict Handling', () => {
    it('enqueues offline records, deduplicates repeated mutations, retries on failure, and requires serverConfirmed', async () => {
      const queue: QueuedSyncMutation[] = [];

      const { queued: firstItem, deduplicated: firstDedup } = await enqueueOfflineMutation(
        {
          syncEventId: 'SYNC-1',
          entityType: 'patient',
          entityId: 'PAT-RMP-3001',
          action: 'register_patient',
          payload: { patientId: 'PAT-RMP-3001', fullName: 'Test Offline Patient' },
        },
        queue
      );
      expect(firstDedup).toBe(false);
      expect(firstItem.status).toBe('pending');
      queue.push(firstItem);

      // Duplicate mutation for same entityId and action is deduplicated
      const { deduplicated: secondDedup } = await enqueueOfflineMutation(
        {
          syncEventId: 'SYNC-2',
          entityType: 'patient',
          entityId: 'PAT-RMP-3001',
          action: 'register_patient',
          payload: { patientId: 'PAT-RMP-3001', fullName: 'Test Offline Patient Updated' },
        },
        queue
      );
      expect(secondDedup).toBe(true);

      // Simulate failed network attempt #1 -> status becomes 'failed', retryCount = 1, NOT 'synced'
      const attempt1 = await processSyncQueue(queue, async () => {
        throw new Error('Simulated offline network timeout');
      });
      expect(attempt1.failedCount).toBe(1);
      expect(attempt1.syncedCount).toBe(0);
      expect(attempt1.updatedQueue[0].status).toBe('failed');
      expect(attempt1.updatedQueue[0].retryCount).toBe(1);

      // Simulate response without serverConfirmed -> must NOT mark as synced
      const attemptUnconfirmed = await processSyncQueue(attempt1.updatedQueue, async () => ({
        ok: true,
        serverConfirmed: false,
      }));
      expect(attemptUnconfirmed.syncedCount).toBe(0);
      expect(attemptUnconfirmed.updatedQueue[0].status).toBe('failed');

      // Simulate retry when connectivity returns with serverConfirmed: true -> marks 'synced'
      const attempt2 = await processSyncQueue(attempt1.updatedQueue, async () => ({
        ok: true,
        serverConfirmed: true,
      }));
      expect(attempt2.syncedCount).toBe(1);
      expect(attempt2.updatedQueue[0].status).toBe('synced');
    });

    it('detects version conflicts explicitly without silently overwriting server data', async () => {
      const check = detectVersionConflict({ version: 3 }, 1);
      expect(check.hasConflict).toBe(true);
      expect(check.serverVersion).toBe(3);

      const conflictQueueItem: QueuedSyncMutation = {
        syncEventId: 'SYNC-REF-CONFLICT',
        entityType: 'referral',
        entityId: 'REF-PHC-5001',
        action: 'update_referral',
        payload: { referralId: 'REF-PHC-5001', status: 'completed', expectedVersion: 1 },
        status: 'pending',
        retryCount: 0,
        createdAt: '2026-10-18T10:00:00Z',
        updatedAt: '2026-10-18T10:00:00Z',
      };

      const syncRes = await processSyncQueue([conflictQueueItem], async () => ({
        ok: false,
        conflict: true,
        error: 'Version conflict',
        serverRecord: { referralId: 'REF-PHC-5001', version: 2, status: 'under_review' },
      }));

      expect(syncRes.conflictCount).toBe(1);
      expect(syncRes.updatedQueue[0].status).toBe('conflict');
      expect(syncRes.updatedQueue[0].serverConflictRecord).toEqual({
        referralId: 'REF-PHC-5001',
        version: 2,
        status: 'under_review',
      });
    });
  });

  // 10. End-to-End Workflow & Dashboard Metric Calculations
  describe('10. End-to-End Workflow & Dashboard Metric Calculations', () => {
    it('executes complete lifecycle: register patient -> screen -> create referral -> doctor review -> follow-up -> dashboard update', () => {
      const patients: PatientRecord[] = [
        {
          patientId: 'PAT-RMP-9001',
          fullName: 'Lakshmi Devi (Synthetic)',
          ageYears: 54,
          sex: 'female',
          village: 'Rampur',
          blockName: 'Sitapur Rural',
          phoneLastFour: '1122',
          consentObtained: true,
          consentTimestamp: '2026-10-18T08:00:00Z',
          knownConditions: ['Hypertension'],
          registeredByUid: 'demo-asha-01',
          isSynthetic: true,
          version: 1,
          createdAt: '2026-10-18T08:00:00Z',
          updatedAt: '2026-10-18T08:00:00Z',
        },
      ];

      // Step 2: Health worker completes screening
      const evalRes = evaluateScreening({
        patientId: 'PAT-RMP-9001',
        systolicBp: 184,
        diastolicBp: 112,
        temperatureC: 37.1,
        spo2Percent: 91,
        symptoms: ['chest_pain'],
        symptomDurationDays: 2,
      });
      expect(evalRes.resultCategory).toBe('urgent_escalation');

      const screenings: ScreeningRecord[] = [
        {
          screeningId: 'SCR-2026-9001',
          patientId: 'PAT-RMP-9001',
          patientName: 'Lakshmi Devi (Synthetic)',
          patientVillage: 'Rampur',
          recordedByUid: 'demo-asha-01',
          recordedByName: 'Sunita Devi',
          screeningDate: '2026-10-18',
          systolicBp: 184,
          diastolicBp: 112,
          heartRateBpm: 96,
          temperatureC: 37.1,
          spo2Percent: 91,
          randomBloodGlucoseMgDl: 140,
          hemoglobinGDl: 11.5,
          respiratoryRateBpm: 22,
          isPregnant: false,
          gestationalWeeks: null,
          symptoms: ['chest_pain'],
          symptomDurationDays: 2,
          medicalHistoryNotes: 'Urgent chest tightness and BP 184/112',
          missingFields: evalRes.missingFields,
          resultCategory: evalRes.resultCategory,
          flaggedReasons: evalRes.flaggedReasons,
          recommendedNextSteps: evalRes.recommendedNextSteps,
          aiSupplementalNote: '',
          engineVersion: evalRes.engineVersion,
          requiresFollowUp: true,
          followUpDueDate: '2026-10-19',
          version: 1,
          createdAt: '2026-10-18T08:10:00Z',
        },
      ];

      // Step 3: Health worker creates referral
      const referrals: ReferralRecord[] = [
        {
          referralId: 'REF-PHC-9001',
          patientId: 'PAT-RMP-9001',
          screeningId: 'SCR-2026-9001',
          priority: 'urgent_escalation',
          reasonForReferral: 'BP 184/112 and SpO2 91%',
          destinationFacility: 'Simulated PHC Rampur (Demo)',
          status: 'pending',
          assignedProfessional: 'Dr. R. Verma',
          doctorNotes: '',
          followUpPlan: '',
          unableReason: '',
          createdByUid: 'demo-asha-01',
          createdDate: '2026-10-18',
          updatedDate: '2026-10-18',
          version: 1,
          isSimulated: true,
        },
      ];

      const followUps: FollowUpRecord[] = [
        {
          followUpId: 'FUP-2026-9001',
          patientId: 'PAT-RMP-9001',
          screeningId: 'SCR-2026-9001',
          referralId: 'REF-PHC-9001',
          status: 'pending',
          scheduledDate: '2026-10-17', // past date -> should compute as overdue
          completedDate: null,
          notes: 'Check PHC attendance',
          recordedByUid: 'demo-asha-01',
          recordedByRole: 'health_worker',
          version: 1,
          updatedAt: '2026-10-18T08:10:00Z',
        },
      ];

      // Initial metrics before doctor review
      const initialMetrics = calculateDashboardMetrics(
        patients,
        screenings,
        referrals,
        followUps,
        '2026-10-18'
      );
      expect(initialMetrics.totalScreenings).toBe(1);
      expect(initialMetrics.incomingReferrals).toBe(1);
      expect(initialMetrics.referralsAwaitingReview).toBe(1);
      expect(initialMetrics.completedReferrals).toBe(0);
      expect(initialMetrics.overdueFollowUps).toBe(1);

      // Step 4: Doctor reviews & completes referral
      assertAuthorized('doctor', 'complete_referral');
      referrals[0] = {
        ...referrals[0],
        status: 'completed',
        doctorNotes: 'Stabilized BP at PHC',
        followUpPlan: 'Home BP check in 3 days',
        version: 2,
      };

      // Step 5: ASHA worker records completed follow-up
      followUps[0] = {
        ...followUps[0],
        status: 'completed',
        completedDate: '2026-10-18',
        notes: 'Home visit completed; patient taking PHC medication.',
        version: 2,
      };

      // Step 6: Dashboard metrics update accurately
      const updatedMetrics = calculateDashboardMetrics(
        patients,
        screenings,
        referrals,
        followUps,
        '2026-10-18'
      );
      expect(updatedMetrics.referralsAwaitingReview).toBe(0);
      expect(updatedMetrics.completedReferrals).toBe(1);
      expect(updatedMetrics.overdueFollowUps).toBe(0);
      expect(updatedMetrics.completedFollowUps).toBe(1);
    });
  });
});
