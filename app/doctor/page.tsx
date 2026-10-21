'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Flag,
  ListOrdered,
  MapPin,
  Search,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { formatCategoryLabel, formatFollowUpStatus } from '@/src/lib/i18n';
import { buildPriorityQueue, formatWaitingTime } from '@/src/lib/priority-queue';
import {
  dailyCounts,
  dailyFlagCounts,
  screeningCategoryMix,
  screeningDayKey,
  vitalsTrendBuckets,
  weeklyScreeningBars,
  type DayCount,
} from '@/src/lib/doctor-charts';
import { detectVillageSymptomClusters } from '@/src/lib/workflow-logic';
import type { ScreeningCategory } from '@/src/lib/types';
import { useDoctorWorkspace } from './doctor-context';

const PANEL = 'rounded-3xl border border-white/5 bg-[#15171C] p-5 sm:p-6';

function Sparkline({ data, color }: { data: DayCount[]; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex items-end gap-[3px] h-9 shrink-0" aria-hidden="true">
      {data.map((d) => (
        <div
          key={d.dayKey}
          className="w-[5px] rounded-sm"
          style={{
            height: `${Math.max(12, (d.count / max) * 100)}%`,
            backgroundColor: color,
            opacity: d.count === 0 ? 0.18 : 0.55 + 0.45 * (d.count / max),
          }}
        />
      ))}
    </div>
  );
}

const MIX_COLORS: Record<ScreeningCategory, string> = {
  urgent_escalation: '#F87171',
  further_assessment_needed: '#FBBF24',
  routine_follow_up: '#34D399',
  incomplete_information: '#94A3B8',
};

function DonutChart({
  mix,
  total,
  totalLabel,
}: {
  mix: Array<{ category: ScreeningCategory; count: number }>;
  total: number;
  totalLabel: string;
}) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const present = mix.filter((m) => m.count > 0);
  const fracs = present.map((m) => (total > 0 ? m.count / total : 0));
  const segments = present.map((m, i) => ({
    ...m,
    dash: fracs[i] * c,
    offset: fracs.slice(0, i).reduce((a, b) => a + b, 0) * c,
  }));
  return (
    <div className="relative w-[150px] h-[150px] shrink-0">
      <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#26282F" strokeWidth="15" />
        {segments.map((s) => (
          <circle
            key={s.category}
            cx="70"
            cy="70"
            r={r}
            fill="none"
            stroke={MIX_COLORS[s.category]}
            strokeWidth="15"
            strokeDasharray={`${Math.max(0, s.dash - 2)} ${c - s.dash + 2}`}
            strokeDashoffset={-s.offset}
            strokeLinecap="butt"
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-[26px] leading-none font-bold text-white tabular-nums">{total}</p>
        <p className="text-[11px] text-slate-400 mt-1">{totalLabel}</p>
      </div>
    </div>
  );
}

type TrendRange = '7D' | '30D' | '90D';
const TREND_CONFIG: Record<TrendRange, { totalDays: number; bucketDays: number }> = {
  '7D': { totalDays: 7, bucketDays: 1 },
  '30D': { totalDays: 28, bucketDays: 7 },
  '90D': { totalDays: 84, bucketDays: 7 },
};

function TrendChart({
  buckets,
  emptyText,
  labels,
}: {
  buckets: ReturnType<typeof vitalsTrendBuckets>;
  emptyText: string;
  labels: { hr: string; bp: string; spo2: string };
}) {
  const series: Array<{
    key: 'avgHeartRate' | 'avgSystolicBp' | 'avgSpo2';
    color: string;
    dashed: boolean;
  }> = [
    { key: 'avgHeartRate', color: '#34D399', dashed: false },
    { key: 'avgSystolicBp', color: '#A78BFA', dashed: false },
    { key: 'avgSpo2', color: '#FB923C', dashed: true },
  ];
  const W = 640;
  const H = 216;
  const padL = 34;
  const padR = 10;
  const padT = 12;
  const padB = 26;
  const yMax = 160;
  const x = (i: number) =>
    buckets.length <= 1 ? padL + (W - padL - padR) / 2 : padL + (i * (W - padL - padR)) / (buckets.length - 1);
  const y = (v: number) => padT + (1 - v / yMax) * (H - padT - padB);
  const plottable = series.filter((s) => buckets.filter((b) => b[s.key] != null).length >= 2);
  if (plottable.length === 0) {
    return <p className="text-xs text-slate-500 py-8 text-center">{emptyText}</p>;
  }
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {[20, 60, 100, 140].map((tick) => (
          <g key={tick}>
            <line x1={padL} x2={W - padR} y1={y(tick)} y2={y(tick)} stroke="#ffffff10" strokeWidth="1" />
            <text x={padL - 6} y={y(tick) + 3} textAnchor="end" fontSize="9" fill="#64748B">
              {tick}
            </text>
          </g>
        ))}
        {series.map((s) => {
          const pts = buckets.map((b, i) => (b[s.key] != null ? { x: x(i), y: y(b[s.key] as number) } : null));
          if (pts.filter(Boolean).length < 2) return null;
          // Split into contiguous runs so gaps (no data) break the line.
          const runs: Array<Array<{ x: number; y: number }>> = [];
          let run: Array<{ x: number; y: number }> = [];
          for (const p of pts) {
            if (p) run.push(p);
            else {
              if (run.length) runs.push(run);
              run = [];
            }
          }
          if (run.length) runs.push(run);
          return (
            <g key={s.key}>
              {runs
                .filter((r) => r.length >= 2)
                .map((r, i) => (
                  <polyline
                    key={i}
                    points={r.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="2"
                    strokeDasharray={s.dashed ? '5 4' : undefined}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
              {pts.map((p, i) =>
                p ? <circle key={i} cx={p.x} cy={p.y} r="3" fill={s.color} /> : null
              )}
            </g>
          );
        })}
        {buckets.map((b, i) => {
          if (buckets.length > 8 && i % 2 === 1 && i !== buckets.length - 1) return null;
          return (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#64748B">
              {b.label.split(' – ')[0]}
            </text>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-4 mt-2 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#34D399]" />{labels.hr}</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#A78BFA]" />{labels.bp}</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#FB923C]" />{labels.spo2}</span>
      </div>
    </div>
  );
}

export default function DoctorOverviewPage() {
  const { patients, screenings, referrals, followUps, metrics, language, doctorName } =
    useDoctorWorkspace();
  const isHi = language === 'hi';
  const router = useRouter();
  const [queueSearch, setQueueSearch] = useState('');
  const [queueFilter, setQueueFilter] = useState<'all' | 'urgent' | 'further'>('all');
  const [trendRange, setTrendRange] = useState<TrendRange>('30D');

  const now = useMemo(() => new Date(), []);
  const todayKey = now.toISOString().slice(0, 10);

  const villageClusters = useMemo(
    () => detectVillageSymptomClusters(screenings, patients),
    [screenings, patients]
  );

  // Deterministic rules only — see src/lib/priority-queue.ts. The queue
  // orders patients who already have an open need; it never changes a
  // screening category.
  const priorityQueue = useMemo(
    () => buildPriorityQueue({ patients, screenings, referrals, followUps, now }),
    [patients, screenings, referrals, followUps, now]
  );

  const screeningById = useMemo(
    () => new Map(screenings.map((s) => [s.screeningId, s])),
    [screenings]
  );

  const totalFlags = useMemo(
    () => screenings.reduce((n, s) => n + s.flaggedReasons.length, 0),
    [screenings]
  );
  const urgentFlags = useMemo(
    () =>
      screenings.reduce(
        (n, s) => n + s.flaggedReasons.filter((f) => f.severity === 'urgent').length,
        0
      ),
    [screenings]
  );
  const criticalOpen = priorityQueue.filter((e) => e.category === 'urgent_escalation').length;
  const newUrgentToday = screenings.filter(
    (s) => s.resultCategory === 'urgent_escalation' && screeningDayKey(s) === todayKey
  ).length;
  const followUpPct =
    followUps.length > 0 ? Math.round((metrics.completedFollowUps / followUps.length) * 100) : 0;

  const sparkPatients = useMemo(
    () => dailyCounts(patients.map((p) => p.createdAt), now, 7),
    [patients, now]
  );
  const sparkUrgent = useMemo(
    () =>
      dailyCounts(
        screenings.filter((s) => s.resultCategory === 'urgent_escalation').map((s) => s.screeningDate),
        now,
        7
      ),
    [screenings, now]
  );
  const sparkCompleted = useMemo(
    () =>
      dailyCounts(
        followUps.filter((f) => f.status === 'completed' && f.completedDate).map((f) => f.completedDate),
        now,
        7
      ),
    [followUps, now]
  );
  const sparkFlags = useMemo(() => dailyFlagCounts(screenings, now, 7), [screenings, now]);

  const weeklyBars = useMemo(() => weeklyScreeningBars(screenings, now), [screenings, now]);
  const weeklyMax = Math.max(1, ...weeklyBars.map((b) => b.urgent + b.other));
  const mix = useMemo(() => screeningCategoryMix(screenings), [screenings]);
  const trendBuckets = useMemo(
    () => vitalsTrendBuckets(screenings, now, TREND_CONFIG[trendRange].totalDays, TREND_CONFIG[trendRange].bucketDays),
    [screenings, now, trendRange]
  );

  const filteredQueue = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    return priorityQueue.filter((e) => {
      if (queueFilter === 'urgent' && e.category !== 'urgent_escalation') return false;
      if (queueFilter === 'further' && e.category !== 'further_assessment_needed') return false;
      if (
        q &&
        !(
          e.patientName.toLowerCase().includes(q) ||
          e.patientId.toLowerCase().includes(q) ||
          e.village.toLowerCase().includes(q)
        )
      )
        return false;
      return true;
    });
  }, [priorityQueue, queueFilter, queueSearch]);

  const maxScore = priorityQueue[0]?.score ?? 1;
  const longestWait = priorityQueue.reduce((m, e) => Math.max(m, e.waitingMinutes), 0);

  const overdueList = useMemo(
    () =>
      followUps
        .filter(
          (f) =>
            f.status === 'overdue' ||
            ((f.status === 'pending' || f.status === 'acknowledged') && f.scheduledDate < todayKey)
        )
        .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)),
    [followUps, todayKey]
  );

  const hour = now.getHours();
  const greeting = isHi
    ? hour < 12
      ? 'सुप्रभात'
      : hour < 17
        ? 'नमस्कार'
        : 'शुभ संध्या'
    : hour < 12
      ? 'Good morning'
      : hour < 17
        ? 'Good afternoon'
        : 'Good evening';
  const dateLine = now.toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const cards: Array<{
    key: string;
    label: string;
    value: string;
    sub: string;
    subTone: string;
    accent: string;
    iconTile: string;
    icon: React.ReactNode;
    spark: DayCount[];
  }> = [
    {
      key: 'patients',
      label: isHi ? 'सक्रिय मरीज' : 'Active Patients',
      value: String(metrics.totalPatients),
      sub: isHi ? `▲ ${metrics.totalScreenings} कुल जांच` : `▲ ${metrics.totalScreenings} total screenings`,
      subTone: 'text-emerald-400',
      accent: '#34D399',
      iconTile: 'bg-emerald-400/15 text-emerald-300',
      icon: <Users className="w-4 h-4" />,
      spark: sparkPatients,
    },
    {
      key: 'critical',
      label: isHi ? 'गंभीर अलर्ट' : 'Critical Alerts',
      value: String(criticalOpen),
      sub: isHi
        ? `▲ आज ${newUrgentToday} नए अर्जेंट मामले`
        : `▲ ${newUrgentToday} new urgent today`,
      subTone: 'text-red-400',
      accent: '#F87171',
      iconTile: 'bg-red-400/15 text-red-400',
      icon: <AlertTriangle className="w-4 h-4" />,
      spark: sparkUrgent,
    },
    {
      key: 'followup',
      label: isHi ? 'फॉलो-अप पूर्णता' : 'Follow-up Completion',
      value: `${followUpPct}%`,
      sub:
        metrics.overdueFollowUps > 0
          ? isHi
            ? `▲ ${metrics.overdueFollowUps} फॉलो-अप लंबित (समय से पीछे)`
            : `▲ ${metrics.overdueFollowUps} follow-ups overdue`
          : isHi
            ? `▲ ${metrics.completedFollowUps} फॉलो-अप पूर्ण`
            : `▲ ${metrics.completedFollowUps} follow-ups completed`,
      subTone: metrics.overdueFollowUps > 0 ? 'text-red-400' : 'text-amber-300',
      accent: '#FBBF24',
      iconTile: 'bg-amber-400/15 text-amber-300',
      icon: <ClipboardCheck className="w-4 h-4" />,
      spark: sparkCompleted,
    },
    {
      key: 'flags',
      label: isHi ? 'जोखिम संकेत' : 'Risk Flags',
      value: String(totalFlags),
      sub: isHi ? `● ${urgentFlags} गंभीर संकेत` : `● ${urgentFlags} urgent flags`,
      subTone: 'text-violet-300',
      accent: '#A78BFA',
      iconTile: 'bg-violet-400/15 text-violet-300',
      icon: <Flag className="w-4 h-4" />,
      spark: sparkFlags,
    },
  ];

  const pillFor = (category: ScreeningCategory): { label: string; classes: string } => {
    switch (category) {
      case 'urgent_escalation':
        return {
          label: isHi ? 'गंभीर' : 'Critical',
          classes: 'bg-red-400/15 text-red-300 border border-red-400/20',
        };
      case 'further_assessment_needed':
        return {
          label: isHi ? 'निगरानी' : 'Monitor',
          classes: 'bg-amber-400/15 text-amber-300 border border-amber-400/20',
        };
      case 'routine_follow_up':
        return {
          label: isHi ? 'फॉलो-अप' : 'Follow-up',
          classes: 'bg-violet-400/15 text-violet-300 border border-violet-400/20',
        };
      default:
        return {
          label: isHi ? 'अधूरा' : 'Incomplete',
          classes: 'bg-slate-400/15 text-slate-300 border border-slate-400/20',
        };
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4 px-1 pt-1">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] sm:text-3xl font-bold text-white tracking-tight">
              {greeting}, {doctorName}
            </h1>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#12291F] border border-emerald-400/20 text-emerald-300 text-[11px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {isHi ? 'लाइव निगरानी' : 'Live Monitoring'}
            </span>
          </div>
          <p className="text-[13px] text-slate-400 mt-1.5">
            {dateLine} · {isHi ? 'पीएचसी डॉक्टर पोर्टल — सीतापुर (उत्तर प्रदेश) क्षेत्र' : 'PHC Doctor Portal — Sitapur (Uttar Pradesh) field area'}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={queueSearch}
              onChange={(e) => setQueueSearch(e.target.value)}
              placeholder={isHi ? 'मरीज खोजें…' : 'Search patients, reports...'}
              className="w-[240px] max-w-full min-h-[42px] pl-10 pr-3 rounded-full border border-white/5 bg-[#15171C] text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
            />
          </div>
          <Link
            href="/doctor/referrals"
            aria-label={isHi ? 'रेफरल समीक्षा' : 'Referral Review'}
            className="relative w-[42px] h-[42px] rounded-full border border-white/5 bg-[#15171C] flex items-center justify-center text-slate-300 hover:text-white shrink-0"
          >
            <Bell className="w-4.5 h-4.5" />
            {metrics.referralsAwaitingReview > 0 && (
              <span className="absolute top-2 right-2.5 w-2 h-2 rounded-full bg-orange-500" />
            )}
          </Link>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.key} className={`relative overflow-hidden ${PANEL}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className={`inline-flex w-9 h-9 rounded-xl items-center justify-center ${c.iconTile}`}>
                  {c.icon}
                </span>
                <p className="text-[13px] text-slate-400 mt-3">{c.label}</p>
                <p className="text-[30px] leading-tight font-bold text-white tabular-nums">{c.value}</p>
                <p className={`text-[11px] font-medium mt-0.5 ${c.subTone}`}>{c.sub}</p>
              </div>
              <div className="pt-1">
                <Sparkline data={c.spark} color={c.accent} />
              </div>
            </div>
            <span
              className="absolute bottom-0 left-5 right-5 h-[3px] rounded-full opacity-70"
              style={{ backgroundColor: c.accent }}
            />
          </div>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 sm:gap-5 items-start">
        <div className="xl:col-span-3 space-y-4 sm:space-y-5 min-w-0">
          {/* Weekly screenings */}
          <div className={PANEL}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold text-white">
                  {isHi ? 'साप्ताहिक जांच' : 'Weekly Screenings'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isHi ? 'पिछले 7 दिन — अर्जेंट बनाम अन्य' : 'Last 7 days — urgent vs other screenings'}
                </p>
              </div>
            </div>
            {screenings.length === 0 ? (
              <p className="text-xs text-slate-500 py-10 text-center">
                {isHi ? 'अभी कोई जांच डेटा नहीं है।' : 'No screening data yet.'}
              </p>
            ) : (
              <>
                <div className="flex items-end justify-between gap-2 h-[190px] mt-5 px-1">
                  {weeklyBars.map((b) => (
                    <div key={b.dayKey} className="flex-1 flex flex-col items-center gap-2 min-w-0">
                      <div className="flex items-end gap-1.5 h-[150px]">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-[10px] text-slate-400 tabular-nums">{b.urgent || ''}</span>
                          <div
                            className="w-4 sm:w-5 rounded-md"
                            style={{
                              height: `${Math.max(b.urgent ? 10 : 3, (b.urgent / weeklyMax) * 130)}px`,
                              background:
                                'repeating-linear-gradient(45deg,#3F434B 0 4px,#34373E 4px 8px)',
                            }}
                          />
                        </div>
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-[10px] text-slate-400 tabular-nums">{b.other || ''}</span>
                          <div
                            className="w-4 sm:w-5 rounded-md bg-[#60A5FA]"
                            style={{
                              height: `${Math.max(b.other ? 10 : 3, (b.other / weeklyMax) * 130)}px`,
                            }}
                          />
                        </div>
                      </div>
                      <span className="text-[11px] text-slate-500">{b.label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-5 mt-3 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#3F434B]" />
                    {isHi ? 'अर्जेंट' : 'Urgent'}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#60A5FA]" />
                    {isHi ? 'अन्य' : 'Other'}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Vitals trend */}
          <div className={PANEL}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold text-white">
                  {isHi ? 'वाइटल्स रुझान' : 'Vitals Trend'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isHi
                    ? 'सभी जांचों के औसत — हृदय गति, सिस्टोलिक BP, SpO₂'
                    : 'Averaged across monitored patients'}
                </p>
              </div>
              <div className="flex rounded-full border border-white/10 bg-white/[0.03] p-0.5">
                {(['7D', '30D', '90D'] as TrendRange[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setTrendRange(r)}
                    className={`px-3 py-1 rounded-full text-[11px] font-semibold ${
                      trendRange === r ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4">
              <TrendChart
                buckets={trendBuckets}
                emptyText={
                  isHi
                    ? 'रुझान के लिए पर्याप्त डेटा नहीं है — कम से कम दो अवधि में माप चाहिए।'
                    : 'Not enough data for a trend — measurements in at least two periods are needed.'
                }
                labels={{
                  hr: isHi ? 'हृदय गति' : 'Heart Rate',
                  bp: isHi ? 'BP सिस्टोलिक' : 'BP Systolic',
                  spo2: 'SpO₂',
                }}
              />
            </div>
          </div>
        </div>

        <div className="xl:col-span-2 space-y-4 sm:space-y-5 min-w-0">
          {/* Screening mix donut */}
          <div className={PANEL}>
            <h2 className="text-[15px] font-bold text-white">
              {isHi ? 'जांच मिश्रण' : 'Screening Mix'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isHi ? 'परिणाम श्रेणी के अनुसार सभी जांच' : 'All screenings by result category'}
            </p>
            <div className="flex items-center gap-5 mt-5 flex-wrap">
              <DonutChart
                mix={mix}
                total={metrics.totalScreenings}
                totalLabel={isHi ? 'जांच' : 'screenings'}
              />
              <ul className="flex-1 min-w-[150px] space-y-2.5">
                {mix.map((m) => (
                  <li key={m.category} className="flex items-center gap-2 text-xs">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: MIX_COLORS[m.category] }}
                    />
                    <span className="text-slate-300 flex-1">{formatCategoryLabel(m.category, language)}</span>
                    <span className="text-slate-400 tabular-nums font-medium">{m.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Today-at-PHC note (all numbers computed from real data) */}
          <div className="rounded-3xl border border-white/5 bg-white/[0.03] p-5">
            <p className="text-[13px] leading-relaxed text-slate-300 flex gap-2.5">
              <Activity className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
              <span>
                {isHi
                  ? `${criticalOpen} अर्जेंट मामले प्रतीक्षा में हैं${priorityQueue.length > 0 ? `, सबसे लंबी प्रतीक्षा ${formatWaitingTime(longestWait)}` : ''}। ${metrics.referralsAwaitingReview} रेफरल डॉक्टर की समीक्षा की प्रतीक्षा में हैं और ${villageClusters.length} ग्राम क्लस्टर अलर्ट सक्रिय हैं।`
                  : `${criticalOpen} urgent case${criticalOpen === 1 ? ' is' : 's are'} waiting${priorityQueue.length > 0 ? ` — longest wait ${formatWaitingTime(longestWait)}` : ''}. ${metrics.referralsAwaitingReview} referral${metrics.referralsAwaitingReview === 1 ? '' : 's'} awaiting doctor review, and ${villageClusters.length} village cluster alert${villageClusters.length === 1 ? '' : 's'} active.`}
              </span>
            </p>
          </div>

          {/* Priority Patient Queue */}
          <div id="priority-queue" className={`${PANEL} scroll-mt-6`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold text-white flex items-center gap-2">
                  <ListOrdered className="w-4 h-4 text-emerald-300" />
                  {isHi ? 'प्राथमिकता मरीज सूची' : 'Priority Patient Queue'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isHi
                    ? 'नियम-आधारित प्राथमिकता स्कोर के अनुसार — सबसे ऊपर वाला पहले'
                    : 'Sorted by rule-based priority score — top patient first'}
                </p>
              </div>
              <div className="flex rounded-full border border-white/10 bg-white/[0.03] p-0.5">
                {(
                  [
                    { key: 'all', en: 'All', hi: 'सभी' },
                    { key: 'urgent', en: 'Critical', hi: 'गंभीर' },
                    { key: 'further', en: 'Needs assessment', hi: 'जांच आवश्यक' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setQueueFilter(f.key)}
                    className={`px-3 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${
                      queueFilter === f.key
                        ? 'bg-emerald-400/20 text-emerald-200'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isHi ? f.hi : f.en}
                  </button>
                ))}
              </div>
            </div>

            {filteredQueue.length === 0 ? (
              <p className="text-xs text-slate-500 flex items-center gap-1.5 py-8 justify-center">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                {priorityQueue.length === 0
                  ? isHi
                    ? 'प्राथमिकता सूची खाली है — कोई मरीज प्रतीक्षा में नहीं है।'
                    : 'Priority queue is empty — no patient is waiting for attention.'
                  : isHi
                    ? 'इस फ़िल्टर/खोज से कोई मरीज मेल नहीं खाता।'
                    : 'No patients match this filter or search.'}
              </p>
            ) : (
              <div className="overflow-x-auto mt-4 -mx-1 px-1">
                <table className="w-full text-left border-collapse min-w-[520px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-[0.12em] text-slate-500 border-b border-white/5">
                      <th className="py-2.5 pr-2 font-semibold">{isHi ? 'मरीज' : 'Patient'}</th>
                      <th className="py-2.5 pr-2 font-semibold">{isHi ? 'श्रेणी' : 'Category'}</th>
                      <th className="py-2.5 pr-2 font-semibold">{isHi ? 'हृदय गति' : 'Heart Rate'}</th>
                      <th className="py-2.5 pr-2 font-semibold">BP</th>
                      <th className="py-2.5 pr-2 font-semibold">{isHi ? 'प्राथमिकता स्कोर' : 'Priority Score'}</th>
                      <th className="py-2.5 font-semibold">{isHi ? 'प्रतीक्षा' : 'Waiting'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredQueue.map((entry) => {
                      const s = entry.screeningId ? screeningById.get(entry.screeningId) : undefined;
                      const pill = pillFor(entry.category);
                      const href = entry.referralId
                        ? '/doctor/referrals'
                        : entry.screeningId
                          ? `/doctor/screenings?focus=${entry.screeningId}`
                          : '/doctor/referrals';
                      const topReason = entry.reasons[0];
                      return (
                        <tr
                          key={entry.patientId}
                          onClick={() => router.push(href)}
                          className="border-b border-white/5 last:border-0 hover:bg-white/[0.03] cursor-pointer"
                        >
                          <td className="py-3 pr-2 align-top">
                            <p className="text-[13px] font-semibold text-white leading-tight">
                              <span className="text-slate-500 font-bold mr-1.5">#{entry.rank}</span>
                              {entry.patientName}
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {entry.patientId} · {entry.village}
                              {entry.isPregnant ? (isHi ? ' · गर्भवती' : ' · Pregnant') : ''}
                            </p>
                            {topReason && (
                              <p className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[210px]">
                                {isHi ? topReason.hi : topReason.en}
                              </p>
                            )}
                          </td>
                          <td className="py-3 pr-2 align-top">
                            <span
                              className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${pill.classes}`}
                            >
                              {pill.label}
                            </span>
                          </td>
                          <td className="py-3 pr-2 align-top text-xs text-slate-200 tabular-nums whitespace-nowrap">
                            {s?.heartRateBpm != null ? `${s.heartRateBpm} bpm` : '—'}
                          </td>
                          <td className="py-3 pr-2 align-top text-xs text-slate-200 tabular-nums whitespace-nowrap">
                            {s?.systolicBp != null && s?.diastolicBp != null
                              ? `${s.systolicBp} / ${s.diastolicBp}`
                              : '—'}
                          </td>
                          <td className="py-3 pr-2 align-top">
                            <div className="flex items-center gap-2">
                              <div className="w-14 h-1.5 rounded-full bg-white/10 overflow-hidden shrink-0">
                                <div
                                  className={`h-full rounded-full ${
                                    entry.category === 'urgent_escalation'
                                      ? 'bg-red-400'
                                      : entry.category === 'further_assessment_needed'
                                        ? 'bg-amber-400'
                                        : 'bg-violet-400'
                                  }`}
                                  style={{ width: `${Math.max(4, Math.round((entry.score / maxScore) * 100))}%` }}
                                />
                              </div>
                              <span className="text-xs font-bold text-white tabular-nums">{entry.score}</span>
                            </div>
                          </td>
                          <td className="py-3 align-top text-xs text-slate-400 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatWaitingTime(entry.waitingMinutes)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Village cluster surveillance */}
      <div id="village-clusters" className={`${PANEL} scroll-mt-6`}>
        <h2 className="text-sm font-bold text-white uppercase tracking-wide flex items-center gap-2">
          <MapPin className="w-4 h-4 text-emerald-300" />
          {isHi ? 'ग्राम स्तरीय लक्षण क्लस्टर निगरानी' : 'Village Symptom Cluster Surveillance'}
        </h2>
        {villageClusters.length === 0 ? (
          <p className="text-xs text-slate-500 mt-3">
            {isHi
              ? 'कोई संकुल चेतावनी नहीं — सभी गांव नियमित निगरानी में हैं।'
              : 'No cluster alerts — all villages under routine surveillance.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            {villageClusters.map((alert) => (
              <div
                key={`${alert.village}-${alert.clusterType}`}
                className={`p-3.5 rounded-2xl border space-y-1.5 ${
                  alert.severity === 'urgent'
                    ? 'bg-red-400/[0.07] border-red-400/20'
                    : 'bg-amber-400/[0.07] border-amber-400/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={`text-xs font-bold ${
                      alert.severity === 'urgent' ? 'text-red-300' : 'text-amber-200'
                    }`}
                  >
                    {isHi ? alert.titleHi : alert.titleEn}
                  </p>
                  {alert.severity === 'urgent' ? (
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-amber-300 shrink-0" />
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  {isHi ? alert.recommendationHi : alert.recommendationEn}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Follow-ups */}
      <div id="follow-ups" className={`${PANEL} scroll-mt-6`}>
        <h2 className="text-sm font-bold text-white uppercase tracking-wide flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-emerald-300" />
          {isHi ? 'फॉलो-अप' : 'Follow-ups'}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          {(['overdue', 'pending', 'acknowledged', 'completed'] as const).map((st) => (
            <div key={st} className="rounded-2xl border border-white/5 bg-white/[0.03] p-3.5">
              <p className="text-[11px] text-slate-400">{formatFollowUpStatus(st, language)}</p>
              <p
                className={`text-xl font-bold tabular-nums mt-0.5 ${
                  st === 'overdue' &&
                  (metrics.followUpsByStatus.find((x) => x.status === st)?.count ?? 0) > 0
                    ? 'text-red-400'
                    : 'text-white'
                }`}
              >
                {metrics.followUpsByStatus.find((x) => x.status === st)?.count ?? 0}
              </p>
            </div>
          ))}
        </div>
        {overdueList.length > 0 && (
          <ul className="mt-3 space-y-2">
            {overdueList.slice(0, 5).map((f) => (
              <li key={f.followUpId}>
                <Link
                  href="/doctor/referrals"
                  className="p-3 rounded-xl bg-red-400/[0.06] border border-red-400/20 hover:border-red-400/40 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5"
                >
                  <p className="text-xs font-semibold text-white">
                    {f.patientName || f.patientId}
                    <span className="font-normal text-slate-400">
                      {' '}· {f.patientVillage || ''} · {isHi ? 'निर्धारित' : 'due'} {f.scheduledDate}
                    </span>
                  </p>
                  <span className="text-[11px] font-semibold text-red-300">
                    {formatFollowUpStatus('overdue', language)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
