import type { ScreeningCategory, ScreeningRecord } from './types';

/**
 * Pure aggregation helpers for the doctor portal dashboard charts.
 *
 * Every number the dark dashboard renders comes from here and is computed
 * from real workspace records only — no estimates, no invented series.
 * When there is no data, the helpers return zeros / nulls and the UI shows
 * an honest empty state instead of a fabricated chart.
 */

const CATEGORY_ORDER: ScreeningCategory[] = [
  'urgent_escalation',
  'further_assessment_needed',
  'routine_follow_up',
  'incomplete_information',
];

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

/** Extract a YYYY-MM-DD day key from a date or ISO timestamp string. */
export function dayKeyOf(value: string | null | undefined): string | null {
  if (!value) return null;
  if (DATE_PREFIX.test(value)) return value.slice(0, 10);
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/** The day a screening belongs to: its screening date, else its record time. */
export function screeningDayKey(s: ScreeningRecord): string | null {
  return dayKeyOf(s.screeningDate) ?? dayKeyOf(s.createdAt);
}

function addDays(dayKey: string, delta: number): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function shortDayLabel(dayKey: string): string {
  return new Date(`${dayKey}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  });
}

function shortDateLabel(dayKey: string): string {
  return new Date(`${dayKey}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export interface CategoryMixSlice {
  category: ScreeningCategory;
  count: number;
}

/** Counts of screenings per result category, in fixed triage order. */
export function screeningCategoryMix(screenings: ScreeningRecord[]): CategoryMixSlice[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    count: screenings.filter((s) => s.resultCategory === category).length,
  }));
}

export interface DayCount {
  dayKey: string;
  label: string;
  count: number;
}

/**
 * Counts of date values per day over the last `days` days ending at `now`
 * (oldest first). Values may be day keys, dates, or ISO timestamps.
 */
export function dailyCounts(values: Array<string | null | undefined>, now: Date, days = 7): DayCount[] {
  const today = dayKeyOf(now.toISOString())!;
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(addDays(today, -i));
  const counts = new Map(keys.map((k) => [k, 0]));
  for (const v of values) {
    const k = dayKeyOf(v ?? undefined);
    if (k && counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return keys.map((k) => ({ dayKey: k, label: shortDayLabel(k), count: counts.get(k) ?? 0 }));
}

/** Per-day total of flagged reasons across screenings (sparkline source). */
export function dailyFlagCounts(screenings: ScreeningRecord[], now: Date, days = 7): DayCount[] {
  const base = dailyCounts([], now, days);
  const byDay = new Map(base.map((d) => [d.dayKey, 0]));
  for (const s of screenings) {
    const k = screeningDayKey(s);
    if (k && byDay.has(k)) byDay.set(k, (byDay.get(k) ?? 0) + s.flaggedReasons.length);
  }
  return base.map((d) => ({ ...d, count: byDay.get(d.dayKey) ?? 0 }));
}

export interface WeeklyBar {
  dayKey: string;
  label: string;
  urgent: number;
  other: number;
}

/** Last 7 days of screenings, split into urgent vs everything else. */
export function weeklyScreeningBars(screenings: ScreeningRecord[], now: Date): WeeklyBar[] {
  const today = dayKeyOf(now.toISOString())!;
  const bars: WeeklyBar[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayKey = addDays(today, -i);
    const dayScreenings = screenings.filter((s) => screeningDayKey(s) === dayKey);
    const urgent = dayScreenings.filter((s) => s.resultCategory === 'urgent_escalation').length;
    bars.push({ dayKey, label: shortDayLabel(dayKey), urgent, other: dayScreenings.length - urgent });
  }
  return bars;
}

export interface VitalsBucket {
  /** e.g. "Feb 16 – Feb 22" */
  label: string;
  count: number;
  avgHeartRate: number | null;
  avgSystolicBp: number | null;
  avgSpo2: number | null;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

/**
 * Buckets screenings from the last `totalDays` days into consecutive
 * `bucketDays`-sized buckets (oldest first) and averages the core vitals
 * per bucket. Averages are null for buckets with no usable measurements,
 * so the chart can break the line instead of inventing a value.
 */
export function vitalsTrendBuckets(
  screenings: ScreeningRecord[],
  now: Date,
  totalDays = 30,
  bucketDays = 7
): VitalsBucket[] {
  const today = dayKeyOf(now.toISOString())!;
  const bucketCount = Math.max(1, Math.ceil(totalDays / bucketDays));
  const start = addDays(today, -(bucketCount * bucketDays - 1));

  const buckets: VitalsBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const from = addDays(start, i * bucketDays);
    const to = addDays(from, bucketDays - 1);
    const inBucket = screenings.filter((s) => {
      const k = screeningDayKey(s);
      return k !== null && k >= from && k <= to;
    });
    buckets.push({
      label: `${shortDateLabel(from)} – ${shortDateLabel(to)}`,
      count: inBucket.length,
      avgHeartRate: avg(inBucket.map((s) => s.heartRateBpm).filter((v): v is number => v != null)),
      avgSystolicBp: avg(inBucket.map((s) => s.systolicBp).filter((v): v is number => v != null)),
      avgSpo2: avg(inBucket.map((s) => s.spo2Percent).filter((v): v is number => v != null)),
    });
  }
  return buckets;
}
