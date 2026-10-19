'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock,
  MapPin,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { formatCategoryLabel, formatFollowUpStatus } from '@/src/lib/i18n';
import { detectVillageSymptomClusters } from '@/src/lib/workflow-logic';
import { useDoctorWorkspace } from './doctor-context';

export default function DoctorOverviewPage() {
  const { patients, screenings, referrals, followUps, metrics, language } = useDoctorWorkspace();
  const isHi = language === 'hi';

  const villageClusters = useMemo(
    () => detectVillageSymptomClusters(screenings, patients),
    [screenings, patients]
  );

  const urgentScreenings = useMemo(
    () =>
      screenings
        .filter((s) => s.resultCategory === 'urgent_escalation')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5),
    [screenings]
  );

  const cards: Array<{
    labelEn: string;
    labelHi: string;
    value: number;
    subEn: string;
    subHi: string;
    tone: 'slate' | 'red' | 'amber' | 'emerald';
  }> = [
    {
      labelEn: 'Incoming Referrals',
      labelHi: 'प्राप्त रेफरल',
      value: metrics.incomingReferrals,
      subEn: `${metrics.totalScreenings} total screenings`,
      subHi: `${metrics.totalScreenings} कुल जांच`,
      tone: 'slate',
    },
    {
      labelEn: 'Urgent Cases',
      labelHi: 'अर्जेंट मामले',
      value: referrals.filter((r) => r.priority === 'urgent_escalation' && r.status !== 'completed').length,
      subEn: 'Immediate review needed',
      subHi: 'तुरंत समीक्षा आवश्यक',
      tone: 'red',
    },
    {
      labelEn: 'Pending Reviews',
      labelHi: 'लंबित समीक्षा',
      value: metrics.referralsAwaitingReview,
      subEn: 'Awaiting doctor action',
      subHi: 'डॉक्टर की कार्रवाई शेष',
      tone: 'amber',
    },
    {
      labelEn: 'Overdue Follow-ups',
      labelHi: 'लंबित फॉलो-अप',
      value: metrics.overdueFollowUps,
      subEn: `${metrics.completedFollowUps} completed`,
      subHi: `${metrics.completedFollowUps} पूर्ण`,
      tone: metrics.overdueFollowUps > 0 ? 'red' : 'emerald',
    },
  ];

  const toneClasses: Record<'slate' | 'red' | 'amber' | 'emerald', string> = {
    slate: 'bg-white border-slate-200 text-slate-900',
    red: 'bg-white border-red-200 text-red-700',
    amber: 'bg-white border-amber-200 text-amber-700',
    emerald: 'bg-white border-emerald-200 text-emerald-700',
  };

  return (
    <div className="space-y-6">
      <div className="p-5 rounded-xl bg-white border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {isHi ? 'पीएचसी मेडिकल ऑफिसर समीक्षा' : 'PHC Medical Officer Overview'}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isHi
              ? 'सीतापुर (उत्तर प्रदेश) क्षेत्र — ग्राम स्तर की जांच निगरानी एवं रेफरल सारांश'
              : 'Sitapur (Uttar Pradesh) field area — village-level screening surveillance & referral summary'}
          </p>
        </div>
        <Link
          href="/doctor/referrals"
          className="min-h-[40px] px-4 py-2 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 flex items-center justify-center gap-2 shrink-0"
        >
          <ClipboardList className="w-4 h-4" />
          {isHi ? 'रेफरल समीक्षा खोलें' : 'Open Referral Review'}
        </Link>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.labelEn} className={`p-4 rounded-xl border ${toneClasses[c.tone]}`}>
            <p className="text-xs font-medium text-slate-500">{isHi ? c.labelHi : c.labelEn}</p>
            <p className={`text-2xl font-bold tabular-nums mt-1 ${c.tone === 'slate' ? 'text-slate-900' : ''}`}>
              {c.value}
            </p>
            <p className="text-xs text-slate-500 mt-1">{isHi ? c.subHi : c.subEn}</p>
          </div>
        ))}
      </div>

      {/* Total patients + screenings strip */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-white border border-slate-200 flex items-center gap-3">
          <Users className="w-5 h-5 text-teal-700" />
          <div>
            <p className="text-xs text-slate-500">{isHi ? 'कुल मरीज' : 'Total patients'}</p>
            <p className="text-lg font-bold text-slate-900 tabular-nums">{metrics.totalPatients}</p>
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white border border-slate-200 flex items-center gap-3">
          <Activity className="w-5 h-5 text-teal-700" />
          <div>
            <p className="text-xs text-slate-500">{isHi ? 'कुल जांच' : 'Total screenings'}</p>
            <p className="text-lg font-bold text-slate-900 tabular-nums">{metrics.totalScreenings}</p>
          </div>
        </div>
      </div>

      {/* Village cluster surveillance */}
      <div className="p-5 rounded-xl bg-white border border-slate-200 space-y-3">
        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
          <MapPin className="w-4 h-4 text-teal-700" />
          {isHi ? 'ग्राम स्तरीय लक्षण क्लस्टर निगरानी' : 'Village Symptom Cluster Surveillance'}
        </h2>
        {villageClusters.length === 0 ? (
          <p className="text-xs text-slate-500">
            {isHi
              ? 'कोई संकुल चेतावनी नहीं — सभी गांव नियमित निगरानी में हैं।'
              : 'No cluster alerts — all villages under routine surveillance.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {villageClusters.map((alert) => (
              <div
                key={`${alert.village}-${alert.clusterType}`}
                className={`p-3.5 rounded-lg border space-y-1.5 ${
                  alert.severity === 'urgent'
                    ? 'bg-red-50 border-red-200'
                    : 'bg-amber-50 border-amber-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={`text-xs font-bold ${
                      alert.severity === 'urgent' ? 'text-red-800' : 'text-amber-900'
                    }`}
                  >
                    {isHi ? alert.titleHi : alert.titleEn}
                  </p>
                  {alert.severity === 'urgent' ? (
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                  )}
                </div>
                <p className="text-[11px] text-slate-600">
                  {isHi ? alert.recommendationHi : alert.recommendationEn}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Latest urgent screenings */}
      <div className="p-5 rounded-xl bg-white border border-slate-200 space-y-3">
        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600" />
          {isHi ? 'नवीनतम अर्जेंट जांच' : 'Latest Urgent Screenings'}
        </h2>
        {urgentScreenings.length === 0 ? (
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            {isHi ? 'कोई अर्जेंट जांच रिकॉर्ड नहीं।' : 'No urgent screenings recorded.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {urgentScreenings.map((s) => (
              <li key={s.screeningId}>
                <Link
                  href={`/doctor/screenings?focus=${s.screeningId}`}
                  className="p-3 rounded-lg bg-slate-50 border border-slate-200 hover:border-teal-400 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div>
                    <p className="text-xs font-bold text-slate-900">{s.patientName || s.patientId}</p>
                    <p className="text-[11px] text-slate-500 font-mono">
                      {s.screeningId} · {s.patientVillage} · {s.screeningDate}
                    </p>
                  </div>
                  <span className="text-[11px] font-semibold text-red-700 flex items-center gap-1.5">
                    <Clock className="w-3 h-3" />
                    {formatCategoryLabel(s.resultCategory, language)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-slate-400">
        {isHi
          ? 'फॉलो-अप स्थिति: '
          : 'Follow-up statuses: '}
        {(['overdue', 'pending', 'acknowledged', 'completed'] as const)
          .map((st) => `${formatFollowUpStatus(st, language)}: ${metrics.followUpsByStatus.find((x) => x.status === st)?.count ?? 0}`)
          .join(' · ')}
      </p>
    </div>
  );
}
