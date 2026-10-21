import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildOverdueFollowUpMessage,
  buildUrgentReferralMessage,
  getNotificationProvider,
  notifyOverdueFollowUp,
  notifyUrgentReferral,
} from '../lib/notifications';
import {
  formatFacilityLabel,
  getDefaultReferralFacility,
  PILOT_FACILITIES,
} from '../lib/facilities';
import {
  buildOverdueReportCsv,
  buildReferralsReportCsv,
  buildScreeningsReportCsv,
  overdueFollowUps,
  referralCompletionStats,
  screeningsByCategoryAndVillage,
  toCsv,
} from '../lib/reports';
import type { FollowUpRecord, ReferralRecord, ScreeningRecord } from '../lib/types';

const ENV_KEYS = [
  'NOTIFICATIONS_MODE',
  'NOTIFICATION_WEBHOOK_URL',
  'NOTIFICATION_WEBHOOK_TOKEN',
  'SMS_API_URL',
  'SMS_API_KEY',
  'SMS_FROM',
] as const;

const savedEnv: Record<string, string | undefined> = {};

function clearNotificationEnv() {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeScreening(overrides: Partial<ScreeningRecord>): ScreeningRecord {
  return {
    screeningId: 'SCR-1',
    patientId: 'PAT-1',
    patientVillage: 'Rampur',
    recordedByUid: 'demo-asha-01',
    recordedByName: 'Worker',
    screeningDate: '2026-10-18',
    systolicBp: 120,
    diastolicBp: 80,
    heartRateBpm: 72,
    temperatureC: 36.8,
    spo2Percent: 98,
    randomBloodGlucoseMgDl: 100,
    hemoglobinGDl: 12,
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
    createdAt: '2026-10-18T08:00:00Z',
    ...overrides,
  };
}

function makeReferral(overrides: Partial<ReferralRecord>): ReferralRecord {
  return {
    referralId: 'REF-1',
    patientId: 'PAT-1',
    screeningId: 'SCR-1',
    priority: 'routine_follow_up',
    reasonForReferral: 'Review',
    destinationFacility: 'PHC Rampur',
    status: 'pending',
    assignedProfessional: '',
    doctorNotes: '',
    followUpPlan: '',
    unableReason: '',
    createdByUid: 'demo-asha-01',
    createdDate: '2026-10-18',
    updatedDate: '2026-10-18',
    version: 1,
    isSimulated: false,
    ...overrides,
  };
}

function makeFollowUp(overrides: Partial<FollowUpRecord>): FollowUpRecord {
  return {
    followUpId: 'FUP-1',
    patientId: 'PAT-1',
    patientVillage: 'Rampur',
    screeningId: 'SCR-1',
    referralId: null,
    status: 'pending',
    scheduledDate: '2026-10-17',
    completedDate: null,
    notes: '',
    recordedByUid: 'demo-asha-01',
    recordedByRole: 'health_worker',
    version: 1,
    updatedAt: '2026-10-18T08:00:00Z',
    ...overrides,
  };
}

describe('notifications', () => {
  it('log mode (default when unconfigured) returns delivered:false and does not throw', async () => {
    clearNotificationEnv();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const provider = getNotificationProvider();
    expect(provider.mode).toBe('log');
    const result = await provider.send({
      to: 'PHC Rampur',
      body: 'Urgent referral REF-1 for patient PAT-1',
      kind: 'urgent_referral',
    });
    expect(result.delivered).toBe(false);
    expect(result.mode).toBe('log');

    const helperResult = await notifyUrgentReferral({
      patientId: 'PAT-1',
      referralId: 'REF-1',
      destinationFacility: 'PHC Rampur',
      priority: 'urgent_escalation',
    });
    expect(helperResult.delivered).toBe(false);
    expect(helperResult.mode).toBe('log');
  });

  it('webhook mode with mocked fetch sends JSON and returns delivered:true', async () => {
    clearNotificationEnv();
    process.env.NOTIFICATIONS_MODE = 'webhook';
    process.env.NOTIFICATION_WEBHOOK_URL = 'https://example.test/notify';
    process.env.NOTIFICATION_WEBHOOK_TOKEN = 'test-token';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'msg-123' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = getNotificationProvider();
    expect(provider.mode).toBe('webhook');
    const result = await provider.send({
      to: 'PHC Rampur',
      body: 'hello',
      kind: 'urgent_referral',
    });
    expect(result.delivered).toBe(true);
    expect(result.mode).toBe('webhook');
    expect(result.providerId).toBe('msg-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/notify');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    expect(JSON.parse(String(init.body))).toMatchObject({ body: 'hello', kind: 'urgent_referral' });
  });

  it('webhook failure (non-2xx and network throw) returns delivered:false, never throws', async () => {
    clearNotificationEnv();
    process.env.NOTIFICATIONS_MODE = 'webhook';
    process.env.NOTIFICATION_WEBHOOK_URL = 'https://example.test/notify';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    );
    const failed = await getNotificationProvider().send({ body: 'x', kind: 'generic' });
    expect(failed.delivered).toBe(false);
    expect(failed.mode).toBe('webhook');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );
    const thrown = await notifyOverdueFollowUp({
      patientId: 'PAT-1',
      followUpId: 'FUP-1',
      scheduledDate: '2026-10-17',
    });
    expect(thrown.delivered).toBe(false);
    expect(thrown.mode).toBe('webhook');
  });

  it('message builders contain no patient name / full phone field', () => {
    const urgent = buildUrgentReferralMessage({
      patientId: 'PAT-1',
      referralId: 'REF-1',
      destinationFacility: 'PHC Rampur',
      priority: 'urgent_escalation',
    });
    expect(urgent.body).toContain('PAT-1');
    expect(urgent.body).toContain('REF-1');
    expect(urgent.body).toContain('PHC Rampur');
    expect(Object.keys(urgent)).not.toContain('patientName');
    expect(Object.keys(urgent)).not.toContain('fullName');
    expect(Object.keys(urgent)).not.toContain('phone');
    expect(urgent.body).not.toMatch(/patientName|fullName/);

    const overdue = buildOverdueFollowUpMessage({
      patientId: 'PAT-2',
      followUpId: 'FUP-9',
      scheduledDate: '2026-10-10',
      assignedWorkerUid: 'asha-01',
    });
    expect(overdue.body).toContain('PAT-2');
    expect(overdue.body).toContain('FUP-9');
    expect(overdue.body).toContain('2026-10-10');
    expect(Object.keys(overdue)).not.toContain('patientName');
    expect(Object.keys(overdue)).not.toContain('fullName');
    expect(Object.keys(overdue)).not.toContain('phone');
  });
});

describe('facilities', () => {
  it('list is non-empty, contains PHC Rampur, and has no Simulated/Demo names', () => {
    expect(PILOT_FACILITIES.length).toBeGreaterThan(0);
    const rampur = PILOT_FACILITIES.find((f) => f.name === 'PHC Rampur');
    expect(rampur).toBeDefined();
    expect(rampur?.type).toBe('PHC');
    expect(rampur?.district).toBe('Sitapur');
    expect(rampur?.state).toBe('Uttar Pradesh');
    for (const facility of PILOT_FACILITIES) {
      expect(facility.name).not.toContain('Simulated');
      expect(facility.name).not.toContain('Demo');
    }
  });

  it('default referral facility and label formatting work', () => {
    const def = getDefaultReferralFacility();
    expect(def.name).toBe('PHC Rampur');
    expect(formatFacilityLabel(def)).toContain('PHC Rampur');
    expect(formatFacilityLabel(def)).toContain('Sitapur');
    expect(formatFacilityLabel(def)).toContain('Uttar Pradesh');
  });
});

describe('reports', () => {
  it('screeningsByCategoryAndVillage counts correctly on small fixtures', () => {
    const screenings = [
      makeScreening({ screeningId: 'S1', resultCategory: 'urgent_escalation', patientVillage: 'Rampur' }),
      makeScreening({ screeningId: 'S2', resultCategory: 'urgent_escalation', patientVillage: 'Rampur' }),
      makeScreening({ screeningId: 'S3', resultCategory: 'routine_follow_up', patientVillage: 'Rampur' }),
      makeScreening({ screeningId: 'S4', resultCategory: 'urgent_escalation', patientVillage: 'Khairabad' }),
    ];
    const rows = screeningsByCategoryAndVillage(screenings);
    expect(rows).toContainEqual({ category: 'urgent_escalation', village: 'Rampur', count: 2 });
    expect(rows).toContainEqual({ category: 'routine_follow_up', village: 'Rampur', count: 1 });
    expect(rows).toContainEqual({ category: 'urgent_escalation', village: 'Khairabad', count: 1 });
    expect(buildScreeningsReportCsv(screenings)).toContain('urgent_escalation,Rampur,2');
  });

  it('referral completion rate math is correct, including empty input', () => {
    const referrals = [
      makeReferral({ referralId: 'R1', status: 'completed' }),
      makeReferral({ referralId: 'R2', status: 'completed' }),
      makeReferral({ referralId: 'R3', status: 'pending' }),
      makeReferral({ referralId: 'R4', status: 'unable_to_complete' }),
    ];
    const stats = referralCompletionStats(referrals);
    expect(stats.total).toBe(4);
    expect(stats.completed).toBe(2);
    expect(stats.completionRate).toBe(0.5);
    expect(stats.completionRatePercent).toBe(50);
    expect(stats.pending).toBe(1);
    expect(stats.unableToComplete).toBe(1);

    const empty = referralCompletionStats([]);
    expect(empty.total).toBe(0);
    expect(empty.completionRate).toBe(0);

    const csv = buildReferralsReportCsv(referrals);
    expect(csv).toContain('completed,2');
    expect(csv).toContain('pending,1');
  });

  it('overdue detection is by scheduled date relative to the reference date', () => {
    const followUps = [
      makeFollowUp({ followUpId: 'F1', scheduledDate: '2026-10-17', status: 'pending' }),
      makeFollowUp({ followUpId: 'F2', scheduledDate: '2026-10-18', status: 'pending' }),
      makeFollowUp({ followUpId: 'F3', scheduledDate: '2026-10-20', status: 'pending' }),
      makeFollowUp({ followUpId: 'F4', scheduledDate: '2026-10-01', status: 'completed' }),
      makeFollowUp({ followUpId: 'F5', scheduledDate: '2026-10-01', status: 'overdue' }),
    ];
    const overdue = overdueFollowUps(followUps, '2026-10-18');
    expect(overdue.map((f) => f.followUpId).sort()).toEqual(['F1', 'F5']);

    const csv = buildOverdueReportCsv(followUps, '2026-10-18');
    expect(csv).toContain('F1');
    expect(csv).toContain('F5');
    expect(csv).not.toContain('F3');
    expect(csv).not.toContain('F4');
  });

  it('toCsv escapes commas, quotes and newlines', () => {
    const csv = toCsv([
      { name: 'a,b', note: 'say "hi"', detail: 'line1\nline2', plain: 'ok' },
      { name: 'simple', note: '', detail: 'x', plain: 'y' },
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('name,note,detail,plain');
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain('"line1\nline2"');
    expect(csv).toContain('simple,,x,y');
    expect(toCsv([])).toBe('');
  });
});
