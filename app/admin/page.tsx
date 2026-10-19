'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BarChart3,
  ClipboardList,
  Globe,
  Home,
  History,
  RefreshCw,
  Stethoscope,
  Users,
} from 'lucide-react';
import {
  AuditLogEntry,
  FollowUpRecord,
  PatientRecord,
  ReferralRecord,
  ScreeningRecord,
  StoredProfile,
  UserRole,
} from '@/src/lib/types';
import { formatAbhaId } from '@/src/lib/screening-engine';
import { formatCategoryLabel, formatReferralStatus } from '@/src/lib/i18n';
import { DEMO_USERS } from '@/src/lib/synthetic-fixtures';
import type { LocalProfile } from '@/components/LoginPanel';

const PROFILES_STORAGE_KEY = 'swasthya-profiles-v1';

const ROLE_BADGE: Record<UserRole, { label: string; className: string }> = {
  health_worker: {
    label: 'ASHA / Health Worker',
    className: 'bg-teal-50 text-teal-800 border-teal-200',
  },
  doctor: {
    label: 'PHC Doctor (MO)',
    className: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  },
  phc_admin: { label: 'PHC Admin', className: 'bg-amber-50 text-amber-800 border-amber-200' },
};

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function maskPhone(last4: string): string {
  return last4 ? `•••• ${last4}` : '—';
}

const CATEGORY_BADGE: Record<string, string> = {
  urgent_escalation: 'text-red-700 bg-red-50 border-red-200',
  further_assessment_needed: 'text-amber-700 bg-amber-50 border-amber-200',
  routine_follow_up: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  incomplete_information: 'text-slate-600 bg-slate-50 border-slate-200',
};

function VitalPill({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="px-2 py-1 rounded-md bg-slate-100 border border-slate-200 text-[10px] font-mono">
      <span className="text-slate-500 not-italic font-sans">{label}</span> {value}
    </span>
  );
}

function PatientDetailRow({
  patient,
  patientScreenings,
  patientFollowUps,
  patientReferrals,
}: {
  patient: PatientRecord;
  patientScreenings: ScreeningRecord[];
  patientFollowUps: FollowUpRecord[];
  patientReferrals: ReferralRecord[];
}) {
  return (
    <tr>
      <td colSpan={10} className="bg-slate-50 px-4 py-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* All identity fields */}
          <div className="p-3.5 rounded-lg bg-white border border-slate-200 space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
              Full Patient Record
            </p>
            <dl className="text-[11px] text-slate-700 space-y-0.5">
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Patient ID</dt><dd className="font-mono">{patient.patientId}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">ABHA-style Health ID</dt><dd className="font-mono">{formatAbhaId(patient.patientId)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Name</dt><dd className="font-semibold">{patient.fullName}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Age / Sex</dt><dd>{patient.ageYears} years · {patient.sex}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Village · Block</dt><dd>{patient.village} · {patient.blockName}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Phone (masked)</dt><dd className="font-mono">{maskPhone(patient.phoneLastFour)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Known conditions</dt><dd>{patient.knownConditions.length > 0 ? patient.knownConditions.join(', ') : '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Consent</dt><dd>{patient.consentObtained ? `Yes · ${formatDateTime(patient.consentTimestamp)}` : 'Not recorded'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Registered by</dt><dd>{patient.registeredByUid}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Created / Updated</dt><dd>{formatDateTime(patient.createdAt)} / {formatDateTime(patient.updatedAt)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Record version</dt><dd>v{patient.version}{patient.isSynthetic ? ' (synthetic)' : ''}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Sync status</dt><dd>{patient.syncStatus || 'synced'}</dd></div>
            </dl>
          </div>

          {/* Follow-ups + referrals */}
          <div className="space-y-3">
            <div className="p-3.5 rounded-lg bg-white border border-slate-200 space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
                Follow-ups ({patientFollowUps.length})
              </p>
              {patientFollowUps.length === 0 ? (
                <p className="text-[11px] text-slate-500">None recorded.</p>
              ) : (
                <ul className="space-y-1 text-[11px] text-slate-700">
                  {patientFollowUps.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((f) => (
                    <li key={f.followUpId} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1">
                      <span className="font-mono text-[10px]">{f.followUpId}</span>
                      <span className="font-semibold">{f.status}</span>
                      <span>Due {f.scheduledDate}{f.completedDate ? ` · Done ${f.completedDate}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="p-3.5 rounded-lg bg-white border border-slate-200 space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
                Referrals ({patientReferrals.length})
              </p>
              {patientReferrals.length === 0 ? (
                <p className="text-[11px] text-slate-500">None created.</p>
              ) : (
                <ul className="space-y-1 text-[11px] text-slate-700">
                  {patientReferrals.sort((a, b) => b.createdDate.localeCompare(a.createdDate)).map((r) => (
                    <li key={r.referralId} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1">
                      <span className="font-mono text-[10px]">{r.referralId}</span>
                      <span className="font-semibold">{r.priority.replace(/_/g, ' ')}</span>
                      <span>{r.status.replace(/_/g, ' ')}</span>
                      <span>{r.destinationFacility}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Full screening history with vitals */}
        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
            Screening History — All Vitals, Symptoms & Results ({patientScreenings.length})
          </p>
          {patientScreenings.length === 0 ? (
            <p className="text-[11px] text-slate-500">No screenings recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {patientScreenings
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map((s) => (
                <div key={s.screeningId} className="p-3 rounded-lg bg-white border border-slate-200 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-slate-900 font-mono">
                      {s.screeningId} · {s.screeningDate}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500">
                        by {s.recordedByName} <span className="font-mono">({s.recordedByUid})</span>
                      </span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${CATEGORY_BADGE[s.resultCategory] || ''}`}>
                        {s.resultCategory.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {s.systolicBp != null && s.diastolicBp != null && <VitalPill label="BP" value={`${s.systolicBp}/${s.diastolicBp}`} />}
                    {s.heartRateBpm != null && <VitalPill label="HR" value={`${s.heartRateBpm}/min`} />}
                    {s.temperatureC != null && <VitalPill label="Temp" value={`${s.temperatureC}°C`} />}
                    {s.spo2Percent != null && <VitalPill label="SpO2" value={`${s.spo2Percent}%`} />}
                    {s.randomBloodGlucoseMgDl != null && <VitalPill label="Glucose" value={`${s.randomBloodGlucoseMgDl} mg/dL`} />}
                    {s.hemoglobinGDl != null && <VitalPill label="Hb" value={`${s.hemoglobinGDl} g/dL`} />}
                    {s.respiratoryRateBpm != null && <VitalPill label="RR" value={`${s.respiratoryRateBpm}/min`} />}
                    {s.isPregnant && <VitalPill label="Pregnant" value={`${s.gestationalWeeks ?? '?'} weeks`} />}
                    <VitalPill label="Duration" value={`${s.symptomDurationDays}d`} />
                  </div>
                  <p className="text-[11px] text-slate-700">
                    <span className="text-slate-500">Symptoms:</span>{' '}
                    {s.symptoms.length > 0 ? s.symptoms.map((id) => id.replace(/_/g, ' ')).join(', ') : 'None recorded'}
                  </p>
                  {s.missingFields.length > 0 && (
                    <p className="text-[10px] text-amber-700">Missing measurements: {s.missingFields.join(', ')}</p>
                  )}
                  {s.flaggedReasons.length > 0 && (
                    <p className="text-[10px] text-red-700">
                      Flagged: {s.flaggedReasons.map((r) => `${r.titleEn} (${r.observedValue})`).join(' · ')}
                    </p>
                  )}
                  {s.followUpDueDate && (
                    <p className="text-[10px] text-slate-600">Follow-up due: {s.followUpDueDate}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function AdminPage() {
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [screenings, setScreenings] = useState<ScreeningRecord[]>([]);
  const [referrals, setReferrals] = useState<ReferralRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [profiles, setProfiles] = useState<LocalProfile[]>([]);
  const [serverProfiles, setServerProfiles] = useState<StoredProfile[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [expandedPatientId, setExpandedPatientId] = useState<string | null>(null);
  const [expandedProfileUid, setExpandedProfileUid] = useState<string | null>(null);

  const loadWorkspace = () => {
    fetch('/api/workspace', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer demo-session-doctor',
        'X-Active-Role': 'doctor',
      },
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok) {
          setPatients(data.patients || []);
          setScreenings(data.screenings || []);
          setReferrals(data.referrals || []);
          setFollowUps(data.followUps || []);
          setAuditLogs(data.auditLogs || []);
          setServerProfiles(data.profiles || []);
          setLoadError(null);
        } else {
          throw new Error(data.error);
        }
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load admin data');
        setIsLoading(false);
      });
  };

  const loadProfiles = () => {
    Promise.resolve().then(() => {
      try {
        setProfiles(JSON.parse(window.localStorage.getItem(PROFILES_STORAGE_KEY) || '[]'));
      } catch {
        setProfiles([]);
      }
    });
  };

  const loadAll = () => {
    loadWorkspace();
    loadProfiles();
  };

  useEffect(() => {
    loadAll();
    const handleFocus = () => loadProfiles();
    window.addEventListener('focus', handleFocus);
    window.addEventListener('swasthya-profiles-sync', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('swasthya-profiles-sync', handleFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // All saved login profiles = server registry (every device) merged with this
  // browser's local copy; local entries win on same-uid collisions (fresher).
  const allProfiles = useMemo<StoredProfile[]>(() => {
    const byUid = new Map<string, StoredProfile>();
    for (const p of serverProfiles) byUid.set(p.uid, p);
    for (const p of profiles) byUid.set(p.uid, p);
    return [...byUid.values()].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  }, [serverProfiles, profiles]);

  const workerNameByUid = useMemo(() => {
    const base = new Map<string, string>([
      [DEMO_USERS.health_worker.uid, DEMO_USERS.health_worker.fullName],
      [DEMO_USERS.doctor.uid, DEMO_USERS.doctor.fullName],
    ]);
    for (const p of allProfiles) {
      base.set(p.uid, `${p.fullName} (${ROLE_BADGE[p.role]?.label ?? p.role})`);
    }
    return base;
  }, [allProfiles]);

  const actorName = (uid: string): string => workerNameByUid.get(uid) || uid;

  const screeningsByPatient = useMemo(() => {
    const map = new Map<string, ScreeningRecord[]>();
    for (const s of screenings) {
      map.set(s.patientId, [...(map.get(s.patientId) || []), s]);
    }
    return map;
  }, [screenings]);

  const followUpsByPatient = useMemo(() => {
    const map = new Map<string, FollowUpRecord[]>();
    for (const f of followUps) {
      map.set(f.patientId, [...(map.get(f.patientId) || []), f]);
    }
    return map;
  }, [followUps]);

  const referralsByPatient = useMemo(() => {
    const map = new Map<string, ReferralRecord[]>();
    for (const r of referrals) {
      map.set(r.patientId, [...(map.get(r.patientId) || []), r]);
    }
    return map;
  }, [referrals]);

  const filteredProfiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allProfiles.filter((p) => {
      const matchesRole =
        roleFilter === 'all' || (roleFilter === 'health_worker' ? p.role === 'health_worker' : p.role === 'doctor');
      const matchesSearch =
        !q ||
        p.fullName.toLowerCase().includes(q) ||
        p.uid.toLowerCase().includes(q) ||
        (p.facilityName || '').toLowerCase().includes(q);
      return matchesRole && matchesSearch;
    });
  }, [allProfiles, searchQuery, roleFilter]);

  const filteredPatients = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return patients.filter(
      (p) =>
        !q ||
        p.patientId.toLowerCase().includes(q) ||
        p.fullName.toLowerCase().includes(q) ||
        p.village.toLowerCase().includes(q)
    );
  }, [patients, searchQuery]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold">
              S
            </span>
            <div>
              <p className="text-sm font-bold text-slate-900">SwasthyaSetu Admin Panel</p>
              <p className="text-[11px] text-slate-500">Accounts, Patients & Audit — Sitapur, Uttar Pradesh</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadAll}
              className="min-h-[34px] px-2.5 py-1 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
            <Link
              href="/doctor"
              className="min-h-[34px] px-2.5 py-1 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 flex items-center gap-1.5"
            >
              <Stethoscope className="w-3.5 h-3.5" />
              Doctor Portal
            </Link>
            <Link
              href="/"
              className="min-h-[34px] px-2.5 py-1 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 flex items-center gap-1.5"
            >
              <Home className="w-3.5 h-3.5" />
              Main App
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {loadError && (
          <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-900">
            Data load failed: {loadError}
          </div>
        )}
        {isLoading ? (
          <div className="p-10 text-center text-sm text-slate-500">Loading admin data...</div>
        ) : (
          <>
            {/* Summary strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-white border border-slate-200">
                <p className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-teal-700" />
                  Total Patients
                </p>
                <p className="text-2xl font-bold tabular-nums mt-1">{patients.length}</p>
              </div>
              <div className="p-4 rounded-xl bg-white border border-slate-200">
                <p className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                  <ClipboardList className="w-3.5 h-3.5 text-teal-700" />
                  Screenings
                </p>
                <p className="text-2xl font-bold tabular-nums mt-1">{screenings.length}</p>
              </div>
              <div className="p-4 rounded-xl bg-white border border-slate-200">
                <p className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                  <BarChart3 className="w-3.5 h-3.5 text-teal-700" />
                  Referrals
                </p>
                <p className="text-2xl font-bold tabular-nums mt-1">{referrals.length}</p>
              </div>
              <div className="p-4 rounded-xl bg-white border border-slate-200">
                <p className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-teal-700" />
                  Audit Events
                </p>
                <p className="text-2xl font-bold tabular-nums mt-1">{auditLogs.length}</p>
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, ID, village, facility…"
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-700 focus:border-slate-700"
              />
            </div>

            {/* REGISTERED LOGIN PROFILES */}
            <section className="p-5 rounded-xl bg-white border border-slate-200 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-slate-700" />
                  Saved Doctor & Worker Profiles ({allProfiles.length}
                  {allProfiles.length > 0 && ` · ${allProfiles.filter((p) => p.role === 'health_worker').length} ASHA/worker(s), ${allProfiles.filter((p) => p.role === 'doctor').length} doctor(s)`})
                </h2>
                <div className="flex gap-1.5">
                  {(['all', 'health_worker', 'doctor'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRoleFilter(r)}
                      className={`min-h-[30px] px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                        roleFilter === r
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {r === 'all' ? 'All' : ROLE_BADGE[r].label}
                    </button>
                  ))}
                </div>
              </div>
              {filteredProfiles.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No login profiles saved on this device yet. Profiles are created from the Main App login flow
                  (role → basic details) and stored locally (swasthya-profiles-v1).
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500 border-b border-slate-200">
                        <th className="py-2 pr-4 font-semibold">Name</th>
                        <th className="py-2 pr-4 font-semibold">Role</th>
                        <th className="py-2 pr-4 font-semibold">Facility / Sub-centre</th>
                        <th className="py-2 pr-4 font-semibold">Phone</th>
                        <th className="py-2 pr-4 font-semibold">UID</th>
                        <th className="py-2 pr-4 font-semibold">Created</th>
                        <th className="py-2 font-semibold">Last Used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProfiles.map((p) => (
                        <React.Fragment key={p.uid}>
                        <tr
                          className={`border-b border-slate-100 text-slate-800 cursor-pointer ${expandedProfileUid === p.uid ? 'bg-teal-50/60' : 'hover:bg-slate-50'}`}
                          onClick={() => setExpandedProfileUid(expandedProfileUid === p.uid ? null : p.uid)}
                          title="Click to view all profile info and activity"
                        >
                          <td className="py-2.5 pr-4 font-semibold">{p.fullName}</td>
                          <td className="py-2.5 pr-4">
                            <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${ROLE_BADGE[p.role]?.className}`}>
                              {ROLE_BADGE[p.role]?.label ?? p.role}
                            </span>
                          </td>
                          <td className="py-2.5 pr-4">{p.facilityName || '—'}</td>
                          <td className="py-2.5 pr-4 font-mono">{maskPhone(p.phoneLastFour)}</td>
                          <td className="py-2.5 pr-4 font-mono text-[10px]">{p.uid}</td>
                          <td className="py-2.5 pr-4">{formatDateTime(p.createdAt)}</td>
                          <td className="py-2.5">{formatDateTime(p.lastUsedAt)}</td>
                        </tr>
                        {expandedProfileUid === p.uid && (
                          <tr>
                            <td colSpan={7} className="bg-slate-50 px-4 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-3.5 rounded-lg bg-white border border-slate-200 space-y-1">
                                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
                                    Full Worker/Doctor Profile
                                  </p>
                                  <dl className="text-[11px] text-slate-700 space-y-0.5">
                                    <div className="flex justify-between gap-3"><dt className="text-slate-500">Name</dt><dd className="font-semibold">{p.fullName}</dd></div>
                                    <div className="flex justify-between gap-3"><dt className="text-slate-500">Role</dt><dd>{ROLE_BADGE[p.role]?.label ?? p.role}</dd></div>
                                    <div className="flex justify-between gap-3"><dt className="text-slate-500">UID</dt><dd className="font-mono">{p.uid}</dd></div>
                                    <div className="flex justify-between gap-3"><dt className="text-slate-500">Facility / Sub-centre</dt><dd>{p.facilityName || '—'}</dd></div>
                                    <div className="flex justify-between gap-3"><dt className="text-slate-500">Phone (masked)</dt><dd className="font-mono">{maskPhone(p.phoneLastFour)}</dd></div>
                                    <div className="flex justify-between gap-3"><dt className="text-slate-500">Profile created</dt><dd>{formatDateTime(p.createdAt)}</dd></div>
                                    <div className="flex justify-between gap-3"><dt className="text-slate-500">Last entered workspace</dt><dd>{formatDateTime(p.lastUsedAt)}</dd></div>
                                    <div className="flex justify-between gap-3"><dt className="text-slate-500">Source</dt><dd>{profiles.some((l) => l.uid === p.uid) ? 'Device + server registry' : 'Server registry'}</dd></div>
                                  </dl>
                                </div>
                                <div className="p-3.5 rounded-lg bg-white border border-slate-200 space-y-1.5">
                                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
                                    Activity This Session
                                  </p>
                                  <div className="flex gap-4 text-[11px] text-slate-700">
                                    <span>Patients registered: <strong className="tabular-nums">{patients.filter((x) => x.registeredByUid === p.uid).length}</strong></span>
                                    <span>Screenings: <strong className="tabular-nums">{screenings.filter((x) => x.recordedByUid === p.uid).length}</strong></span>
                                    <span>Referrals: <strong className="tabular-nums">{referrals.filter((x) => x.createdByUid === p.uid).length}</strong></span>
                                    <span>Audit events: <strong className="tabular-nums">{auditLogs.filter((x) => x.actorUid === p.uid).length}</strong></span>
                                  </div>
                                  <ul className="space-y-1 text-[11px] text-slate-700">
                                    {auditLogs
                                      .filter((x) => x.actorUid === p.uid)
                                      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                                      .slice(0, 8)
                                      .map((x) => (
                                        <li key={x.auditId} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1">
                                          <span><span className="font-mono font-semibold text-slate-800">{x.action}</span> · {x.summary}</span>
                                          <span className="text-[10px] text-slate-500 shrink-0">{formatDateTime(x.createdAt)}</span>
                                        </li>
                                      ))}
                                    {auditLogs.filter((x) => x.actorUid === p.uid).length === 0 && (
                                      <li className="text-slate-500">No server activity yet.</li>
                                    )}
                                  </ul>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* PATIENT REGISTRY */}
            <section className="p-5 rounded-xl bg-white border border-slate-200 space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-700" />
                Patient Registry — Who Registered, When (All Fields)
              </h2>
              {filteredPatients.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No patients registered on this server session yet. Register one from the Main App (ASHA worker →
                  New Patient Registration).
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500 border-b border-slate-200">
                        <th className="py-2 pr-4 font-semibold">Patient</th>
                        <th className="py-2 pr-4 font-semibold">Age / Sex</th>
                        <th className="py-2 pr-4 font-semibold">Village · Block</th>
                        <th className="py-2 pr-4 font-semibold">ABHA-style ID</th>
                        <th className="py-2 pr-4 font-semibold">Conditions</th>
                        <th className="py-2 pr-4 font-semibold">Consent</th>
                        <th className="py-2 pr-4 font-semibold">Registered By</th>
                        <th className="py-2 pr-4 font-semibold">Created</th>
                        <th className="py-2 pr-4 font-semibold">Screenings</th>
                        <th className="py-2 font-semibold">Version</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPatients.map((p) => (
                        <React.Fragment key={p.patientId}>
                        <tr
                          className={`border-b border-slate-100 text-slate-800 align-top cursor-pointer ${expandedPatientId === p.patientId ? 'bg-teal-50/60' : 'hover:bg-slate-50'}`}
                          onClick={() =>
                            setExpandedPatientId(expandedPatientId === p.patientId ? null : p.patientId)
                          }
                          title="Click to view all patient info"
                        >
                          <td className="py-2.5 pr-4">
                            <p className="font-semibold">{p.fullName}</p>
                            <p className="text-[10px] text-slate-500 font-mono">{p.patientId}</p>
                          </td>
                          <td className="py-2.5 pr-4 capitalize">
                            {p.ageYears} · {p.sex}
                          </td>
                          <td className="py-2.5 pr-4">
                            {p.village} · {p.blockName}
                          </td>
                          <td className="py-2.5 pr-4 font-mono text-[10px]">{formatAbhaId(p.patientId)}</td>
                          <td className="py-2.5 pr-4">
                            {p.knownConditions.length > 0 ? p.knownConditions.join(', ') : '—'}
                          </td>
                          <td className="py-2.5 pr-4">
                            {p.consentObtained ? (
                              <span className="text-emerald-700 font-semibold">Yes</span>
                            ) : (
                              <span className="text-red-700 font-semibold">No</span>
                            )}
                            <p className="text-[10px] text-slate-500">{formatDateTime(p.consentTimestamp)}</p>
                          </td>
                          <td className="py-2.5 pr-4">
                            <span className="font-semibold">{actorName(p.registeredByUid)}</span>
                            <p className="text-[10px] text-slate-500 font-mono">{p.registeredByUid}</p>
                          </td>
                          <td className="py-2.5 pr-4">
                            {formatDateTime(p.createdAt)}
                            <p className="text-[10px] text-slate-500">Updated: {formatDateTime(p.updatedAt)}</p>
                          </td>
                          <td className="py-2.5 pr-4 tabular-nums font-semibold">
                            {(screeningsByPatient.get(p.patientId) || []).length}
                          </td>
                          <td className="py-2.5 tabular-nums">v{p.version}</td>
                        </tr>
                        {expandedPatientId === p.patientId && (
                          <PatientDetailRow
                            patient={p}
                            patientScreenings={screeningsByPatient.get(p.patientId) || []}
                            patientFollowUps={followUpsByPatient.get(p.patientId) || []}
                            patientReferrals={referralsByPatient.get(p.patientId) || []}
                          />
                        )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* AUDIT LOG */}
            <section className="p-5 rounded-xl bg-white border border-slate-200 space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900 flex items-center gap-2">
                <History className="w-4 h-4 text-slate-700" />
                Server Audit Trail (Actor · Action · Target)
              </h2>
              {auditLogs.length === 0 ? (
                <p className="text-xs text-slate-500">No audit events yet this session.</p>
              ) : (
                <ul className="space-y-2">
                  {[...auditLogs]
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                    .map((log) => (
                      <li
                        key={log.auditId}
                        className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5"
                      >
                        <div>
                          <p className="text-xs text-slate-900 font-semibold">
                            {actorName(log.actorUid)}{' '}
                            <span className="text-slate-400 font-mono text-[10px]">({log.actorUid} · {log.actorRole})</span>
                          </p>
                          <p className="text-[11px] text-slate-600">
                            <span className="font-mono font-semibold text-slate-800">{log.action}</span> ·{' '}
                            {log.summary}
                          </p>
                          <p className="text-[10px] text-slate-500 font-mono">
                            {log.targetType}: {log.targetId}
                          </p>
                        </div>
                        <span className="text-[10px] text-slate-500 shrink-0">{formatDateTime(log.createdAt)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </section>

            {/* REFERRALS */}
            <section className="p-5 rounded-xl bg-white border border-slate-200 space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900 flex items-center gap-2">
                <ClipboardList className="w-4 h-3.5 text-slate-700" />
                Referral Records (All Statuses)
              </h2>
              {referrals.length === 0 ? (
                <p className="text-xs text-slate-500">No referrals created yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500 border-b border-slate-200">
                        <th className="py-2 pr-4 font-semibold">Referral</th>
                        <th className="py-2 pr-4 font-semibold">Patient</th>
                        <th className="py-2 pr-4 font-semibold">Priority</th>
                        <th className="py-2 pr-4 font-semibold">Status</th>
                        <th className="py-2 pr-4 font-semibold">Destination</th>
                        <th className="py-2 font-semibold">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...referrals]
                        .sort((a, b) => b.createdDate.localeCompare(a.createdDate))
                        .map((r) => (
                          <tr key={r.referralId} className="border-b border-slate-100 text-slate-800">
                            <td className="py-2.5 pr-4 font-mono font-semibold text-[10px]">{r.referralId}</td>
                            <td className="py-2.5 pr-4">{r.patientName || r.patientId}</td>
                            <td className="py-2.5 pr-4">{formatCategoryLabel(r.priority, 'en')}</td>
                            <td className="py-2.5 pr-4">{formatReferralStatus(r.status, 'en')}</td>
                            <td className="py-2.5 pr-4">{r.destinationFacility}</td>
                            <td className="py-2.5">{formatDateTime(r.createdDate)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <p className="text-[11px] text-slate-400">
              Note: server data is in-memory for this prototype build and resets when the dev server restarts.
              Login profiles are saved to the server registry from the Main App login flow and cached locally
              on the device that created them.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
