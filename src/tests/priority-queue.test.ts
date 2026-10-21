import { describe, expect, it } from 'vitest';
import { buildPriorityQueue, formatWaitingTime } from '../lib/priority-queue';
import type {
  FlaggedReason,
  FollowUpRecord,
  PatientRecord,
  ReferralRecord,
  ScreeningCategory,
  ScreeningRecord,
} from '../lib/types';

const NOW = new Date('2026-10-21T12:00:00Z');

function patient(overrides: Partial<PatientRecord>): PatientRecord {
  return {
    patientId: 'PAT-001',
    fullName: 'Test Patient',
    ageYears: 34,
    sex: 'female',
    village: 'Rampur',
    blockName: 'Sitapur Rural',
    phoneLastFour: '1234',
    consentObtained: true,
    consentTimestamp: '2026-10-21T08:00:00Z',
    knownConditions: [],
    registeredByUid: 'asha-01',
    isSynthetic: true,
    version: 1,
    createdAt: '2026-10-21T08:00:00Z',
    updatedAt: '2026-10-21T08:00:00Z',
    ...overrides,
  };
}

function flag(severity: 'urgent' | 'moderate', code: string): FlaggedReason {
  return {
    code,
    field: 'test',
    severity,
    titleEn: `${code} title`,
    titleHi: `${code} शीर्षक`,
    explanationEn: 'test',
    explanationHi: 'परीक्षण',
    observedValue: 'test',
    referenceRule: 'TEST',
  };
}

function screening(overrides: Partial<ScreeningRecord>): ScreeningRecord {
  return {
    screeningId: 'SCR-001',
    patientId: 'PAT-001',
    recordedByUid: 'asha-01',
    recordedByName: 'Asha Worker',
    screeningDate: '2026-10-21',
    systolicBp: 120,
    diastolicBp: 80,
    heartRateBpm: 80,
    temperatureC: 37,
    spo2Percent: 98,
    randomBloodGlucoseMgDl: null,
    hemoglobinGDl: null,
    respiratoryRateBpm: 16,
    isPregnant: false,
    gestationalWeeks: null,
    symptoms: [],
    symptomDurationDays: 0,
    medicalHistoryNotes: '',
    missingFields: [],
    resultCategory: 'routine_follow_up',
    flaggedReasons: [],
    recommendedNextSteps: [],
    aiSupplementalNote: '',
    engineVersion: 'PROTOTYPE-RULES-v1.0',
    requiresFollowUp: false,
    followUpDueDate: null,
    version: 1,
    createdAt: '2026-10-21T11:00:00Z',
    ...overrides,
  };
}

function referral(overrides: Partial<ReferralRecord>): ReferralRecord {
  return {
    referralId: 'REF-001',
    patientId: 'PAT-001',
    screeningId: 'SCR-001',
    priority: 'urgent_escalation',
    reasonForReferral: 'test',
    destinationFacility: 'PHC Rampur',
    status: 'pending',
    assignedProfessional: '',
    doctorNotes: '',
    followUpPlan: '',
    unableReason: '',
    createdByUid: 'asha-01',
    createdDate: '2026-10-21',
    updatedDate: '2026-10-21',
    version: 1,
    isSimulated: true,
    ...overrides,
  };
}

function followUp(overrides: Partial<FollowUpRecord>): FollowUpRecord {
  return {
    followUpId: 'FUP-001',
    patientId: 'PAT-001',
    screeningId: 'SCR-001',
    referralId: null,
    status: 'pending',
    scheduledDate: '2026-10-20',
    completedDate: null,
    notes: '',
    recordedByUid: 'asha-01',
    recordedByRole: 'health_worker',
    version: 1,
    updatedAt: '2026-10-20T08:00:00Z',
    ...overrides,
  };
}

describe('Doctor Priority Queue — deterministic ranking', () => {
  it('orders urgent before further-assessment before routine', () => {
    const queue = buildPriorityQueue({
      patients: [
        patient({ patientId: 'PAT-URGENT', fullName: 'Urgent One' }),
        patient({ patientId: 'PAT-FURTHER', fullName: 'Further One' }),
        patient({ patientId: 'PAT-ROUTINE', fullName: 'Routine One' }),
      ],
      screenings: [
        screening({ screeningId: 'SCR-U', patientId: 'PAT-URGENT', resultCategory: 'urgent_escalation' as ScreeningCategory }),
        screening({ screeningId: 'SCR-F', patientId: 'PAT-FURTHER', resultCategory: 'further_assessment_needed' as ScreeningCategory }),
        screening({ screeningId: 'SCR-R', patientId: 'PAT-ROUTINE', resultCategory: 'routine_follow_up' as ScreeningCategory }),
      ],
      referrals: [],
      followUps: [followUp({ patientId: 'PAT-ROUTINE', screeningId: 'SCR-R' })],
      now: NOW,
    });

    expect(queue.map((e) => e.patientId)).toEqual(['PAT-URGENT', 'PAT-FURTHER', 'PAT-ROUTINE']);
    expect(queue.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it('within urgent, more urgent flagged reasons rank higher', () => {
    const queue = buildPriorityQueue({
      patients: [patient({ patientId: 'PAT-ONE' }), patient({ patientId: 'PAT-THREE' })],
      screenings: [
        screening({
          screeningId: 'SCR-1',
          patientId: 'PAT-ONE',
          resultCategory: 'urgent_escalation',
          flaggedReasons: [flag('urgent', 'A')],
        }),
        screening({
          screeningId: 'SCR-3',
          patientId: 'PAT-THREE',
          resultCategory: 'urgent_escalation',
          flaggedReasons: [flag('urgent', 'A'), flag('urgent', 'B'), flag('urgent', 'C')],
        }),
      ],
      referrals: [],
      now: NOW,
    });

    expect(queue[0].patientId).toBe('PAT-THREE');
    expect(queue[0].score).toBeGreaterThan(queue[1].score);
    expect(queue[0].reasons.some((r) => r.en.includes('3 urgent warning signs'))).toBe(true);
  });

  it('boosts a pregnant urgent patient above an otherwise identical urgent patient', () => {
    const base = {
      resultCategory: 'urgent_escalation' as ScreeningCategory,
      flaggedReasons: [flag('urgent', 'BP')],
      createdAt: '2026-10-21T11:00:00Z',
    };
    const queue = buildPriorityQueue({
      patients: [
        patient({ patientId: 'PAT-PLAIN' }),
        patient({ patientId: 'PAT-PREG', fullName: 'Pregnant One' }),
      ],
      screenings: [
        screening({ ...base, screeningId: 'SCR-A', patientId: 'PAT-PLAIN' }),
        screening({ ...base, screeningId: 'SCR-B', patientId: 'PAT-PREG', isPregnant: true, gestationalWeeks: 30 }),
      ],
      referrals: [],
      now: NOW,
    });

    expect(queue[0].patientId).toBe('PAT-PREG');
    expect(queue[0].isPregnant).toBe(true);
    expect(queue[0].reasons.some((r) => r.en.includes('Pregnant'))).toBe(true);
  });

  it('longer waiting time wins a near-tie', () => {
    const queue = buildPriorityQueue({
      patients: [patient({ patientId: 'PAT-EARLY' }), patient({ patientId: 'PAT-LATE' })],
      screenings: [
        screening({
          screeningId: 'SCR-E',
          patientId: 'PAT-EARLY',
          resultCategory: 'further_assessment_needed',
          createdAt: '2026-10-21T11:10:00Z', // waiting 50 min at NOW
        }),
        screening({
          screeningId: 'SCR-L',
          patientId: 'PAT-LATE',
          resultCategory: 'further_assessment_needed',
          createdAt: '2026-10-21T11:50:00Z', // waiting 10 min at NOW
        }),
      ],
      referrals: [],
      now: NOW,
    });

    expect(queue[0].patientId).toBe('PAT-EARLY');
    expect(queue[0].waitingMinutes).toBe(50);
    expect(queue[0].score - queue[1].score).toBe(4); // +5 vs +1 waiting points
  });

  it('an overdue follow-up surfaces a patient who would otherwise be routine', () => {
    const queue = buildPriorityQueue({
      patients: [patient({ patientId: 'PAT-ROUTINE' })],
      screenings: [
        screening({ screeningId: 'SCR-R', patientId: 'PAT-ROUTINE', resultCategory: 'routine_follow_up' }),
      ],
      referrals: [],
      followUps: [followUp({ patientId: 'PAT-ROUTINE', screeningId: 'SCR-R', scheduledDate: '2026-10-19' })],
      now: NOW,
    });

    expect(queue).toHaveLength(1);
    expect(queue[0].category).toBe('routine_follow_up');
    expect(queue[0].reasons.some((r) => r.en.includes('overdue'))).toBe(true);
  });

  it('excludes a completed referral case', () => {
    const queue = buildPriorityQueue({
      patients: [patient({ patientId: 'PAT-DONE' }), patient({ patientId: 'PAT-OPEN' })],
      screenings: [
        screening({ screeningId: 'SCR-D', patientId: 'PAT-DONE', resultCategory: 'urgent_escalation' }),
        screening({ screeningId: 'SCR-O', patientId: 'PAT-OPEN', resultCategory: 'urgent_escalation' }),
      ],
      referrals: [
        referral({ referralId: 'REF-D', patientId: 'PAT-DONE', screeningId: 'SCR-D', status: 'completed' }),
        referral({ referralId: 'REF-O', patientId: 'PAT-OPEN', screeningId: 'SCR-O', status: 'pending' }),
      ],
      now: NOW,
    });

    expect(queue.map((e) => e.patientId)).toEqual(['PAT-OPEN']);
  });

  it('is deterministic: identical and reordered inputs give the identical queue', () => {
    const input = {
      patients: [patient({ patientId: 'PAT-B' }), patient({ patientId: 'PAT-A' })],
      screenings: [
        screening({ screeningId: 'SCR-B', patientId: 'PAT-B', resultCategory: 'urgent_escalation' }),
        screening({ screeningId: 'SCR-A', patientId: 'PAT-A', resultCategory: 'urgent_escalation' }),
      ],
      referrals: [],
      now: NOW,
    };
    const first = buildPriorityQueue(input);
    const second = buildPriorityQueue({
      ...input,
      patients: [...input.patients].reverse(),
      screenings: [...input.screenings].reverse(),
    });

    expect(second).toEqual(first);
    // Exact score tie -> earlier waiting-since is equal too -> patientId breaks it.
    expect(first.map((e) => e.patientId)).toEqual(['PAT-A', 'PAT-B']);
  });

  it('formats waiting time as minutes under an hour and h/m above it', () => {
    expect(formatWaitingTime(50)).toBe('50 min');
    expect(formatWaitingTime(130)).toBe('2h 10m');
    expect(formatWaitingTime(120)).toBe('2h');
  });
});
