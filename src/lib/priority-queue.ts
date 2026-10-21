import type {
  FollowUpRecord,
  PatientRecord,
  ReferralRecord,
  ScreeningCategory,
  ScreeningRecord,
} from './types';

/**
 * Doctor Priority Queue — deterministic "who needs attention first" ordering.
 *
 * This module is 100% rule-based. It NEVER calls an LLM and it NEVER changes
 * the screening engine's categories or thresholds (`PROTOTYPE-RULES-v1.0` in
 * screening-engine.ts stays the only triage decision-maker). The queue only
 * ORDERS patients who already have an open need, using transparent factors
 * that each contribute a named, bilingual reason — a doctor can always see
 * why a patient is ranked where they are, and can override the order.
 *
 * All ordering factors below are PROTOTYPE queue-ordering heuristics, NOT
 * clinical triage rules. In particular the age-vulnerability cut-offs
 * (>= 65 years / < 5 years) only affect queue position — they do not change
 * any patient's screening category. They are listed for clinician review in
 * docs/CLINICAL_SIGNOFF_PACK.md §15.
 */

export interface PriorityReason {
  /** Scoring points this factor contributed. */
  points: number;
  en: string;
  hi: string;
}

export interface PriorityQueueEntry {
  /** 1-based position in the queue. */
  rank: number;
  patientId: string;
  patientName: string;
  village: string;
  category: ScreeningCategory;
  score: number;
  /** Top contributing factors, highest points first (max 3). */
  reasons: PriorityReason[];
  /** Minutes between the qualifying event and `now`, floored at 0. */
  waitingMinutes: number;
  screeningId: string | null;
  referralId: string | null;
  isPregnant: boolean;
  ageYears: number;
  /**
   * ISO timestamp of the event the patient has been waiting since
   * (screening / referral / overdue follow-up — the earliest qualifying one).
   * Used as the deterministic tie-break after score.
   */
  waitingSince: string;
}

export interface PriorityQueueInput {
  patients: PatientRecord[];
  screenings: ScreeningRecord[];
  referrals: ReferralRecord[];
  followUps?: FollowUpRecord[];
  /** Reference instant for waiting time / overdue computation. */
  now: Date | string;
}

/** Category base scores. Gaps are deliberately large: no combination of
 *  waiting-time points (max +50) can lift a patient across a category gap. */
export const PRIORITY_WEIGHTS = {
  categoryBase: {
    urgent_escalation: 1000,
    further_assessment_needed: 600,
    routine_follow_up: 200,
    incomplete_information: 200,
  } as Record<ScreeningCategory, number>,
  /** Per flagged reason on the latest screening, by severity. */
  perUrgentFlag: 60,
  perModerateFlag: 15,
  pregnancy: 80,
  /** Queue-ordering heuristic only — see module header. */
  ageVulnerability: 40,
  overdueFollowUp: 120,
  /** +1 point per full 10 minutes waited, capped. */
  waitingPer10Min: 1,
  waitingCap: 50,
} as const;

const OPEN_REFERRAL_STATUSES = new Set(['pending', 'acknowledged', 'under_review']);
const CLOSED_REFERRAL_STATUSES = new Set(['completed', 'unable_to_complete']);

function toTime(iso: string | undefined | null): number {
  if (!iso) return Number.NaN;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NaN : t;
}

function isOverdueFollowUp(f: FollowUpRecord, todayIso: string): boolean {
  if (f.status === 'overdue') return true;
  return (f.status === 'pending' || f.status === 'acknowledged') && f.scheduledDate < todayIso;
}

export function buildPriorityQueue(input: PriorityQueueInput): PriorityQueueEntry[] {
  const { patients, screenings, referrals } = input;
  const followUps = input.followUps ?? [];
  const nowDate = input.now instanceof Date ? input.now : new Date(input.now);
  const nowMs = nowDate.getTime();
  const todayIso = nowDate.toISOString().slice(0, 10);

  const patientById = new Map(patients.map((p) => [p.patientId, p]));

  // Latest screening per patient (deterministic: createdAt desc, id desc).
  const latestScreeningByPatient = new Map<string, ScreeningRecord>();
  for (const s of screenings) {
    const current = latestScreeningByPatient.get(s.patientId);
    if (
      !current ||
      s.createdAt > current.createdAt ||
      (s.createdAt === current.createdAt && s.screeningId > current.screeningId)
    ) {
      latestScreeningByPatient.set(s.patientId, s);
    }
  }

  const referralsByPatient = new Map<string, ReferralRecord[]>();
  for (const r of referrals) {
    const list = referralsByPatient.get(r.patientId) ?? [];
    list.push(r);
    referralsByPatient.set(r.patientId, list);
  }

  const overdueByPatient = new Map<string, FollowUpRecord>();
  for (const f of followUps) {
    if (isOverdueFollowUp(f, todayIso) && !overdueByPatient.has(f.patientId)) {
      overdueByPatient.set(f.patientId, f);
    }
  }

  // Union of patient ids that could appear, from any source.
  const candidateIds = new Set<string>([
    ...latestScreeningByPatient.keys(),
    ...referralsByPatient.keys(),
    ...overdueByPatient.keys(),
  ]);

  const entries: Array<Omit<PriorityQueueEntry, 'rank'>> = [];

  for (const patientId of candidateIds) {
    const patient = patientById.get(patientId);
    const screening = latestScreeningByPatient.get(patientId) ?? null;
    const patientReferrals = referralsByPatient.get(patientId) ?? [];
    const openReferral =
      patientReferrals.find((r) => OPEN_REFERRAL_STATUSES.has(r.status)) ?? null;
    const overdueFollowUp = overdueByPatient.get(patientId) ?? null;

    // Closed case: the latest screening's referral was completed / marked
    // unable-to-complete and no referral is still open — the doctor has
    // already handled it, so it leaves the queue (unless a follow-up for
    // this patient has since become overdue, which is a new open need).
    const closedByReferral = Boolean(
      screening &&
        !openReferral &&
        patientReferrals.some(
          (r) => r.screeningId === screening.screeningId && CLOSED_REFERRAL_STATUSES.has(r.status)
        )
    );

    const screeningQualifies = Boolean(
      screening &&
        (screening.resultCategory === 'urgent_escalation' ||
          screening.resultCategory === 'further_assessment_needed')
    );

    if (closedByReferral && !overdueFollowUp) continue;
    if (!screeningQualifies && !openReferral && !overdueFollowUp) continue;

    const category: ScreeningCategory =
      screening?.resultCategory ?? openReferral?.priority ?? 'routine_follow_up';
    const ageYears = patient?.ageYears ?? screening?.patientAge ?? 0;
    const isPregnant = screening?.isPregnant ?? false;

    // Waiting since the earliest qualifying event.
    const waitingCandidates: number[] = [];
    if (screeningQualifies && screening) waitingCandidates.push(toTime(screening.createdAt));
    if (openReferral) waitingCandidates.push(toTime(openReferral.createdDate));
    if (overdueFollowUp) waitingCandidates.push(toTime(overdueFollowUp.scheduledDate));
    const validWaiting = waitingCandidates.filter((t) => !Number.isNaN(t));
    const waitingSinceMs = validWaiting.length > 0 ? Math.min(...validWaiting) : nowMs;
    const waitingMinutes = Math.max(0, Math.floor((nowMs - waitingSinceMs) / 60000));

    // ---- Scoring: every point comes with a named bilingual reason. ----
    const reasons: PriorityReason[] = [];
    let score = 0;
    const addReason = (points: number, en: string, hi: string) => {
      score += points;
      if (points > 0) reasons.push({ points, en, hi });
    };

    const basePoints = PRIORITY_WEIGHTS.categoryBase[category];
    if (category === 'urgent_escalation') {
      addReason(basePoints, 'Urgent escalation — needs immediate medical assessment', 'तत्काल जांच — तुरंत चिकित्सा मूल्यांकन आवश्यक (Urgent escalation)');
    } else if (category === 'further_assessment_needed') {
      addReason(basePoints, 'Medical assessment needed', 'चिकित्सा जांच आवश्यक (Assessment needed)');
    } else if (category === 'routine_follow_up') {
      addReason(basePoints, 'Routine follow-up category', 'नियमित फॉलो-अप श्रेणी (Routine follow-up)');
    } else {
      addReason(basePoints, 'Screening information incomplete', 'जांच की जानकारी अधूरी (Information incomplete)');
    }

    const flags = screening?.flaggedReasons ?? [];
    const urgentFlags = flags.filter((f) => f.severity === 'urgent');
    const moderateFlags = flags.filter((f) => f.severity === 'moderate');
    if (urgentFlags.length > 0) {
      const top = urgentFlags[0];
      addReason(
        urgentFlags.length * PRIORITY_WEIGHTS.perUrgentFlag,
        `${urgentFlags.length} urgent warning sign${urgentFlags.length > 1 ? 's' : ''}: ${top.titleEn}`,
        `${urgentFlags.length} गंभीर चेतावनी संकेत: ${top.titleHi}`
      );
    }
    if (moderateFlags.length > 0) {
      const top = moderateFlags[0];
      addReason(
        moderateFlags.length * PRIORITY_WEIGHTS.perModerateFlag,
        `${moderateFlags.length} moderate warning sign${moderateFlags.length > 1 ? 's' : ''}: ${top.titleEn}`,
        `${moderateFlags.length} मध्यम चेतावनी संकेत: ${top.titleHi}`
      );
    }

    if (isPregnant) {
      addReason(PRIORITY_WEIGHTS.pregnancy, 'Pregnant patient', 'गर्भवती मरीज (Pregnant patient)');
    }

    // Age vulnerability affects QUEUE ORDER ONLY — it is not a clinical
    // triage input and never changes the screening category (see header).
    if (ageYears >= 65) {
      addReason(PRIORITY_WEIGHTS.ageVulnerability, `Age ${ageYears} — older patient, higher vulnerability`, `आयु ${ageYears} — बुज़ुर्ग मरीज, अधिक संवेदनशीलता (Older patient)`);
    } else if (ageYears > 0 && ageYears < 5) {
      addReason(PRIORITY_WEIGHTS.ageVulnerability, `Age ${ageYears} — young child, higher vulnerability`, `आयु ${ageYears} — छोटा बच्चा, अधिक संवेदनशीलता (Young child)`);
    }

    if (overdueFollowUp) {
      addReason(PRIORITY_WEIGHTS.overdueFollowUp, 'Follow-up is overdue', 'फॉलो-अप समय से पीछे है (Follow-up overdue)');
    }

    const waitingPoints = Math.min(
      PRIORITY_WEIGHTS.waitingCap,
      Math.floor(waitingMinutes / 10) * PRIORITY_WEIGHTS.waitingPer10Min
    );
    if (waitingMinutes >= 30) {
      addReason(waitingPoints, `Waiting for ${waitingMinutes} min`, `${waitingMinutes} मिनट से प्रतीक्षा (Waiting ${waitingMinutes} min)`);
    } else {
      score += waitingPoints;
    }

    reasons.sort((a, b) => b.points - a.points || a.en.localeCompare(b.en));

    entries.push({
      patientId,
      patientName: patient?.fullName || screening?.patientName || openReferral?.patientName || patientId,
      village: patient?.village || screening?.patientVillage || openReferral?.patientVillage || '',
      category,
      score,
      reasons: reasons.slice(0, 3),
      waitingMinutes,
      screeningId: screening?.screeningId ?? openReferral?.screeningId ?? overdueFollowUp?.screeningId ?? null,
      referralId: openReferral?.referralId ?? overdueFollowUp?.referralId ?? null,
      isPregnant,
      ageYears,
      waitingSince: new Date(waitingSinceMs).toISOString(),
    });
  }

  // Deterministic total order: score desc, then earliest waiting-since
  // (longest-waiting first), then patientId — identical inputs therefore
  // always produce the identical queue.
  entries.sort(
    (a, b) =>
      b.score - a.score ||
      a.waitingSince.localeCompare(b.waitingSince) ||
      a.patientId.localeCompare(b.patientId)
  );

  return entries.map((entry, idx) => ({ ...entry, rank: idx + 1 }));
}

/** "50 min" under an hour, "2h 10m" at/above an hour. Bilingual suffix-free —
 *  callers add their own language label around it if needed. */
export function formatWaitingTime(waitingMinutes: number): string {
  if (waitingMinutes < 60) return `${waitingMinutes} min`;
  const hours = Math.floor(waitingMinutes / 60);
  const minutes = waitingMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
