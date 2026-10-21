import { describe, expect, it } from 'vitest';
import {
  dailyCounts,
  screeningCategoryMix,
  vitalsTrendBuckets,
  weeklyScreeningBars,
} from '../lib/doctor-charts';
import type { ScreeningCategory, ScreeningRecord } from '../lib/types';

const NOW = new Date('2026-03-17T12:00:00Z');

function screening(overrides: Partial<ScreeningRecord>): ScreeningRecord {
  return {
    screeningId: 'SCR-001',
    patientId: 'PAT-001',
    recordedByUid: 'asha-01',
    recordedByName: 'Asha Worker',
    screeningDate: '2026-03-17',
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
    createdAt: '2026-03-17T09:00:00Z',
    ...overrides,
  };
}

describe('doctor-charts — empty input', () => {
  it('returns zeroed category mix, bars and null-average buckets', () => {
    const mix = screeningCategoryMix([]);
    expect(mix.map((m) => m.category)).toEqual([
      'urgent_escalation',
      'further_assessment_needed',
      'routine_follow_up',
      'incomplete_information',
    ]);
    expect(mix.every((m) => m.count === 0)).toBe(true);

    const bars = weeklyScreeningBars([], NOW);
    expect(bars).toHaveLength(7);
    expect(bars.every((b) => b.urgent === 0 && b.other === 0)).toBe(true);

    const buckets = vitalsTrendBuckets([], NOW, 28, 7);
    expect(buckets).toHaveLength(4);
    expect(
      buckets.every((b) => b.count === 0 && b.avgHeartRate === null && b.avgSystolicBp === null && b.avgSpo2 === null)
    ).toBe(true);

    expect(dailyCounts([], NOW).every((d) => d.count === 0)).toBe(true);
  });
});

describe('doctor-charts — single bucket', () => {
  it('puts screenings from today into only the newest bucket', () => {
    const buckets = vitalsTrendBuckets(
      [screening({ screeningId: 'A' }), screening({ screeningId: 'B' })],
      NOW,
      28,
      7
    );
    expect(buckets.slice(0, 3).every((b) => b.count === 0)).toBe(true);
    expect(buckets[3].count).toBe(2);
    expect(buckets[3].avgHeartRate).toBe(80);
  });

  it('ignores screenings older than the trend window', () => {
    const buckets = vitalsTrendBuckets(
      [screening({ screeningDate: '2026-01-01', createdAt: '2026-01-01T09:00:00Z' })],
      NOW,
      28,
      7
    );
    expect(buckets.every((b) => b.count === 0)).toBe(true);
  });
});

describe('doctor-charts — averages', () => {
  it('averages each vital independently and skips null measurements', () => {
    const buckets = vitalsTrendBuckets(
      [
        screening({ screeningId: 'A', heartRateBpm: 60, systolicBp: 110, spo2Percent: 97 }),
        screening({ screeningId: 'B', heartRateBpm: 80, systolicBp: 130, spo2Percent: 99 }),
        screening({ screeningId: 'C', heartRateBpm: null, systolicBp: null, spo2Percent: null }),
      ],
      NOW,
      28,
      7
    );
    const last = buckets[3];
    expect(last.count).toBe(3);
    expect(last.avgHeartRate).toBe(70);
    expect(last.avgSystolicBp).toBe(120);
    expect(last.avgSpo2).toBe(98);
  });
});

describe('doctor-charts — category mix and weekly bars', () => {
  it('counts categories and splits weekly bars into urgent vs other', () => {
    const cats: ScreeningCategory[] = [
      'urgent_escalation',
      'urgent_escalation',
      'further_assessment_needed',
      'routine_follow_up',
    ];
    const records = cats.map((c, i) => screening({ screeningId: `S${i}`, resultCategory: c }));
    const mix = screeningCategoryMix(records);
    expect(mix.find((m) => m.category === 'urgent_escalation')?.count).toBe(2);
    expect(mix.find((m) => m.category === 'further_assessment_needed')?.count).toBe(1);
    expect(mix.find((m) => m.category === 'routine_follow_up')?.count).toBe(1);
    expect(mix.find((m) => m.category === 'incomplete_information')?.count).toBe(0);

    const bars = weeklyScreeningBars(records, NOW);
    const today = bars[6];
    expect(today.urgent).toBe(2);
    expect(today.other).toBe(2);
    expect(bars.slice(0, 6).every((b) => b.urgent === 0 && b.other === 0)).toBe(true);
  });
});
