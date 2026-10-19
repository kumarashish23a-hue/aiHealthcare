'use client';

import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Lock,
  Search,
  Stethoscope,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  DashboardMetrics,
  LanguageCode,
  ReferralRecord,
  ReferralStatus,
  ScreeningCategory,
  ScreeningRecord,
  UserRole,
} from '@/src/lib/types';
import { formatCategoryLabel, formatReferralStatus, UI_LABELS } from '@/src/lib/i18n';
import { detectVillageSymptomClusters } from '@/src/lib/workflow-logic';

interface PhcDoctorDashboardProps {
  currentUserRole: UserRole;
  language: LanguageCode;
  metrics: DashboardMetrics;
  referrals: ReferralRecord[];
  screenings: ScreeningRecord[];
  onSwitchToDoctorRole: () => void;
  onTestUnauthorizedDoctorAction: () => Promise<string>;
  onOpenReferralSummary: (referral: ReferralRecord) => void;
  onQuickUpdateReferralStatus: (referral: ReferralRecord, status: ReferralStatus) => Promise<void>;
}

const CATEGORY_COLORS: Record<ScreeningCategory, string> = {
  urgent_escalation: '#dc2626',
  further_assessment_needed: '#d97706',
  routine_follow_up: '#16a34a',
  incomplete_information: '#64748b',
};

export const PhcDoctorDashboard: React.FC<PhcDoctorDashboardProps> = ({
  currentUserRole,
  language,
  metrics,
  referrals,
  screenings,
  onSwitchToDoctorRole,
  onTestUnauthorizedDoctorAction,
  onOpenReferralSummary,
  onQuickUpdateReferralStatus,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ReferralStatus>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | ScreeningCategory>('all');
  const [rbacTestMessage, setRbacTestMessage] = useState<string | null>(null);

  const labels = UI_LABELS[language];

  const screeningMap = useMemo(() => {
    return new Map(screenings.map((s) => [s.screeningId, s]));
  }, [screenings]);

  const urgentCasesCount = useMemo(() => {
    return referrals.filter((r) => r.priority === 'urgent_escalation' && r.status !== 'completed')
      .length;
  }, [referrals]);

  const villageClusters = useMemo(() => {
    return detectVillageSymptomClusters(screenings, []);
  }, [screenings]);

  const filteredReferrals = useMemo(() => {
    return referrals.filter((r) => {
      const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
      const matchesPriority = priorityFilter === 'all' || r.priority === priorityFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        r.referralId.toLowerCase().includes(q) ||
        r.patientId.toLowerCase().includes(q) ||
        (r.patientName || '').toLowerCase().includes(q) ||
        (r.patientVillage || '').toLowerCase().includes(q) ||
        r.reasonForReferral.toLowerCase().includes(q);
      return matchesStatus && matchesPriority && matchesSearch;
    });
  }, [referrals, statusFilter, priorityFilter, searchQuery]);

  // Role-Based Access Control Gate for Health Workers
  if (currentUserRole === 'health_worker') {
    return (
      <div className="max-w-xl mx-auto p-6 sm:p-8 rounded-xl bg-white border border-slate-200 text-center space-y-5">
        <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto text-slate-700">
          <Lock className="w-6 h-6" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-bold text-slate-900">
            PHC Medical Officer Portal (Restricted Access)
          </h2>
          <p className="text-sm text-slate-600">
            You are signed in as an <strong>ASHA Health Worker</strong>. Reviewing and updating PHC
            referrals requires an authorized <strong>Doctor</strong> or{' '}
            <strong>PHC Administrator</strong> role, enforced on the server.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={onSwitchToDoctorRole}
            className="min-h-[44px] px-5 py-2.5 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 transition-colors"
          >
            Switch Role to PHC Doctor (Demo)
          </button>
          <button
            type="button"
            onClick={async () => {
              const msg = await onTestUnauthorizedDoctorAction();
              setRbacTestMessage(msg);
            }}
            className="min-h-[44px] px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 transition-colors"
          >
            Test Server-Side RBAC (HTTP 403)
          </button>
        </div>

        {rbacTestMessage && (
          <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-300 text-xs font-mono text-amber-950 text-left">
            {rbacTestMessage}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Clean PHC Header */}
      <div className="p-5 rounded-xl bg-white border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-teal-800 font-semibold">
            <Stethoscope className="w-4 h-4" />
            <span>Primary Healthcare Centre (PHC) — Medical Officer Dashboard</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mt-0.5">
            Incoming Referrals & Clinical Review
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">{labels.simulatedPhcNotice}</p>
        </div>
      </div>

      {/* 4 Key PHC Overview Cards (Incoming Referrals, Urgent Cases, Pending Reviews, Completed Referrals) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white border border-slate-200">
          <p className="text-xs font-medium text-slate-500">Incoming referrals</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums mt-1">
            {metrics.incomingReferrals}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {metrics.totalScreenings} total screenings
          </p>
        </div>

        <div className="p-4 rounded-xl bg-white border border-red-200">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-red-700">Urgent cases</p>
            <AlertTriangle className="w-4 h-4 text-red-600" />
          </div>
          <p className="text-2xl font-bold text-red-700 tabular-nums mt-1">{urgentCasesCount}</p>
          <p className="text-xs text-slate-500 mt-1">Immediate review needed</p>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200">
          <p className="text-xs font-medium text-slate-500">Pending reviews</p>
          <p className="text-2xl font-bold text-amber-700 tabular-nums mt-1">
            {metrics.referralsAwaitingReview}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {metrics.overdueFollowUps} overdue follow-ups
          </p>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200">
          <p className="text-xs font-medium text-slate-500">Completed referrals</p>
          <p className="text-2xl font-bold text-emerald-700 tabular-nums mt-1">
            {metrics.completedReferrals}
          </p>
          <p className="text-xs text-slate-500 mt-1">Care plan recorded</p>
        </div>
      </div>

      {/* Village Epidemiological & High-Risk Surveillance Watch (Inspired by CHT / Khushi Baby) */}
      {villageClusters.length > 0 && (
        <div className="p-5 rounded-xl bg-white border border-slate-200 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Activity className="w-4 h-4 text-teal-700" />
                <span>
                  {language === 'hi'
                    ? 'ग्राम महामारी विज्ञान एवं उच्च जोखिम निगरानी (Village Surveillance & Cluster Watch)'
                    : 'Village Epidemiological & High-Risk Surveillance Watch'}
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                {language === 'hi'
                  ? 'आशा कार्यकर्ताओं की जांच के आधार पर बुखार/श्वसन, मातृ जोखिम (HRP) और गंभीर एनसीडी मामलों की ग्राम-वार सूची।'
                  : 'Automated line-list aggregation of febrile/respiratory symptoms, high-risk pregnancies (HRP), and severe NCD cases across villages.'}
              </p>
            </div>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-xs font-semibold text-teal-700 hover:underline self-start sm:self-center"
              >
                Clear Village Filter ({searchQuery})
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {villageClusters.slice(0, 3).map((alert, idx) => (
              <div
                key={`${alert.village}-${alert.clusterType}-${idx}`}
                className={`p-3.5 rounded-xl border text-xs flex flex-col justify-between gap-2.5 ${
                  alert.severity === 'urgent'
                    ? 'bg-red-50/40 border-red-200'
                    : 'bg-amber-50/40 border-amber-200'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-bold text-slate-900">
                      {language === 'hi' ? alert.titleHi : alert.titleEn}
                    </span>
                    <span className="font-mono text-[11px] text-slate-600 tabular-nums shrink-0">
                      {alert.patientIds.join(', ')}
                    </span>
                  </div>
                  <p className="text-slate-600">
                    {language === 'hi' ? alert.recommendationHi : alert.recommendationEn}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSearchQuery(alert.village)}
                  className="self-start min-h-[34px] px-3 py-1 rounded-lg border border-slate-300 bg-white text-slate-800 font-semibold hover:bg-slate-50"
                >
                  Filter {alert.village} Referrals →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Incoming Referrals List (Table on Desktop, Stacked Cards on Mobile) */}
      <div className="p-5 sm:p-6 rounded-xl bg-white border border-slate-200 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Incoming Referrals ({filteredReferrals.length})
            </h2>
            <p className="text-xs text-slate-500">
              Select a referral to view the patient&apos;s screening summary, record a follow-up plan, or update status.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-60">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search patient, ID, reason..."
                className="w-full min-h-[40px] pl-9 pr-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | ReferralStatus)}
              className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="under_review">Under Review</option>
              <option value="completed">Completed</option>
              <option value="unable_to_complete">Unable to Complete</option>
            </select>

            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as 'all' | ScreeningCategory)}
              className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white"
            >
              <option value="all">All Priorities</option>
              <option value="urgent_escalation">Urgent medical assessment</option>
              <option value="further_assessment_needed">Medical assessment needed</option>
            </select>
          </div>
        </div>

        {filteredReferrals.length === 0 ? (
          <div className="p-8 text-center rounded-lg bg-slate-50 border border-slate-100 space-y-2">
            <p className="text-sm font-medium text-slate-700">
              No referrals match your active filters.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
                setPriorityFilter('all');
              }}
              className="min-h-[38px] px-4 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-3 px-3 font-semibold">Referral & Patient</th>
                    <th className="py-3 px-3 font-semibold">Date</th>
                    <th className="py-3 px-3 font-semibold">Priority & Reason</th>
                    <th className="py-3 px-3 font-semibold">Measurements</th>
                    <th className="py-3 px-3 font-semibold">Status</th>
                    <th className="py-3 px-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredReferrals.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        No referrals found matching the selected filter.
                      </td>
                    </tr>
                  ) : (
                    filteredReferrals.map((ref) => {
                    const scr = screeningMap.get(ref.screeningId);
                    const isUrgent = ref.priority === 'urgent_escalation';
                    return (
                      <tr key={ref.referralId} className="hover:bg-slate-50">
                        <td className="py-3.5 px-3">
                          <span className="font-bold text-slate-900 block">
                            {ref.patientName || ref.patientId}
                          </span>
                          <span className="font-mono text-slate-500">
                            {ref.patientId} · {ref.referralId}
                          </span>
                        </td>

                        <td className="py-3.5 px-3 font-mono text-slate-700 whitespace-nowrap">
                          {scr?.screeningDate || ref.createdDate}
                        </td>

                        <td className="py-3.5 px-3 max-w-xs">
                          <span
                            className={`inline-flex items-center gap-1 font-bold mb-0.5 ${
                              isUrgent ? 'text-red-700' : 'text-amber-700'
                            }`}
                          >
                            {isUrgent ? (
                              <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                            ) : (
                              <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            )}
                            <span>{formatCategoryLabel(ref.priority, language)}</span>
                          </span>
                          <p className="text-slate-600 line-clamp-2">{ref.reasonForReferral}</p>
                        </td>

                        <td className="py-3.5 px-3 font-mono text-slate-700 whitespace-nowrap">
                          {scr ? (
                            <div>
                              <p>
                                BP:{' '}
                                {scr.systolicBp && scr.diastolicBp
                                  ? `${scr.systolicBp}/${scr.diastolicBp}`
                                  : '--'}{' '}
                                · SpO2: {scr.spo2Percent ?? '--'}%
                              </p>
                              <p className="text-slate-500">
                                Temp: {scr.temperatureC ?? '--'}°C
                              </p>
                            </div>
                          ) : (
                            '--'
                          )}
                        </td>

                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 font-semibold px-2.5 py-1 rounded-md ${
                              ref.status === 'completed'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : ref.status === 'pending'
                                  ? 'bg-red-50 text-red-800 border border-red-200'
                                  : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {ref.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5" />}
                            <span>{formatReferralStatus(ref.status, language)}</span>
                          </span>
                        </td>

                        <td className="py-3.5 px-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            {ref.status === 'pending' && (
                              <button
                                type="button"
                                onClick={() => onQuickUpdateReferralStatus(ref, 'acknowledged')}
                                className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-semibold hover:bg-slate-50"
                              >
                                Acknowledge
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onOpenReferralSummary(ref)}
                              className="min-h-[38px] px-3 py-1.5 rounded-lg bg-teal-700 text-white font-semibold hover:bg-teal-800 flex items-center gap-1.5"
                            >
                              <ClipboardCheck className="w-3.5 h-3.5" />
                              <span>Review</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })) }
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Cards */}
            <div className="md:hidden space-y-3">
              {filteredReferrals.length === 0 ? (
                <div className="p-8 text-center text-slate-500 bg-white rounded-xl border border-slate-200 text-xs">
                  No referrals found matching the selected filter.
                </div>
              ) : (
                filteredReferrals.map((ref) => {
                const scr = screeningMap.get(ref.screeningId);
                const isUrgent = ref.priority === 'urgent_escalation';
                return (
                  <div
                    key={ref.referralId}
                    className="p-4 rounded-xl border border-slate-200 bg-white space-y-3 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-sm text-slate-900">
                          {ref.patientName || ref.patientId}
                        </p>
                        <p className="font-mono text-slate-500">
                          {ref.patientId} · {ref.referralId}
                        </p>
                      </div>
                      <span className="px-2.5 py-1 rounded-md bg-slate-100 font-semibold text-slate-800">
                        {formatReferralStatus(ref.status, language)}
                      </span>
                    </div>

                    <div
                      className={`inline-flex items-center gap-1.5 font-bold ${
                        isUrgent ? 'text-red-700' : 'text-amber-700'
                      }`}
                    >
                      {isUrgent ? (
                        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                      ) : (
                        <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                      )}
                      <span>{formatCategoryLabel(ref.priority, language)}</span>
                    </div>

                    <p className="text-slate-700">{ref.reasonForReferral}</p>

                    {scr && (
                      <p className="font-mono text-slate-600">
                        BP: {scr.systolicBp ?? '--'}/{scr.diastolicBp ?? '--'} mmHg · SpO2:{' '}
                        {scr.spo2Percent ?? '--'}% · Temp: {scr.temperatureC ?? '--'}°C
                      </p>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      {ref.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => onQuickUpdateReferralStatus(ref, 'acknowledged')}
                          className="flex-1 min-h-[42px] px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 font-semibold"
                        >
                          Acknowledge
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onOpenReferralSummary(ref)}
                        className="flex-1 min-h-[42px] px-3 py-2 rounded-lg bg-teal-700 text-white font-semibold"
                      >
                        Review & Update
                      </button>
                    </div>
                  </div>
                );
              })) }
            </div>
          </>
        )}
      </div>

      {/* Collapsible PHC Population Analytics Section */}
      <details className="bg-white rounded-xl border border-slate-200 p-5">
        <summary className="text-sm font-bold text-slate-900 cursor-pointer flex items-center justify-between select-none">
          <span className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-teal-700" />
            <span>PHC Population Screening & Referral Analytics</span>
          </span>
          <span className="text-xs font-normal text-slate-500">Click to expand charts</span>
        </summary>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-5 mt-4 border-t border-slate-100">
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-700">Screenings by Category</h4>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={metrics.screeningsByCategory}
                  layout="vertical"
                  margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis
                    dataKey="label"
                    type="category"
                    width={120}
                    tick={{ fontSize: 10, fill: '#334155' }}
                  />
                  <Tooltip />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {metrics.screeningsByCategory.map((entry) => (
                      <Cell
                        key={entry.category}
                        fill={CATEGORY_COLORS[entry.category] || '#0f766e'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-700">Referrals by Status</h4>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={metrics.referralsByStatus}
                  margin={{ top: 10, right: 15, left: 0, bottom: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="status"
                    tick={{ fontSize: 10, fill: '#334155' }}
                    interval={0}
                    angle={-15}
                    textAnchor="end"
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#0f766e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-700">Screenings by Village</h4>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={metrics.screeningsByVillage}
                  margin={{ top: 10, right: 15, left: 0, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="village" tick={{ fontSize: 11, fill: '#334155' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar
                    dataKey="screenings"
                    name="Total Screenings"
                    fill="#0f766e"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="urgentCount"
                    name="Urgent Cases"
                    fill="#dc2626"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
};
