'use client';

import React, { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search, Stethoscope } from 'lucide-react';
import { PatientScreeningModal } from '@/components/PatientScreeningModal';
import { formatCategoryLabel } from '@/src/lib/i18n';
import type { ScreeningCategory, ScreeningRecord } from '@/src/lib/types';
import { useDoctorWorkspace } from '../doctor-context';

const CATEGORY_COLORS: Record<ScreeningCategory, string> = {
  urgent_escalation: 'text-red-700 bg-red-50 border-red-200',
  further_assessment_needed: 'text-amber-700 bg-amber-50 border-amber-200',
  routine_follow_up: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  incomplete_information: 'text-slate-600 bg-slate-50 border-slate-200',
};

function ScreeningsContent() {
  const {
    patients,
    screenings,
    referrals,
    followUps,
    language,
    doctorName,
    refresh,
    updateReferral,
  } = useDoctorWorkspace();
  const isHi = language === 'hi';

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ScreeningCategory>('all');
  const [inspectedScreeningId, setInspectedScreeningId] = useState<string | null>(null);

  const focusId = useSearchParams().get('focus');
  const effectiveInspectedId = inspectedScreeningId ?? focusId;

  const filteredScreenings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return screenings
      .filter((s) => categoryFilter === 'all' || s.resultCategory === categoryFilter)
      .filter(
        (s) =>
          !q ||
          s.screeningId.toLowerCase().includes(q) ||
          s.patientId.toLowerCase().includes(q) ||
          (s.patientName || '').toLowerCase().includes(q) ||
          (s.patientVillage || '').toLowerCase().includes(q)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [screenings, searchQuery, categoryFilter]);

  const inspectedScreening: ScreeningRecord | undefined = useMemo(
    () => screenings.find((s) => s.screeningId === effectiveInspectedId),
    [screenings, effectiveInspectedId]
  );

  const inspectedPatient = useMemo(
    () => patients.find((p) => p.patientId === inspectedScreening?.patientId),
    [patients, inspectedScreening]
  );

  const inspectedReferral = useMemo(
    () => referrals.find((r) => r.screeningId === inspectedScreening?.screeningId),
    [referrals, inspectedScreening]
  );

  const patientScreenings = useMemo(
    () => screenings.filter((s) => s.patientId === inspectedScreening?.patientId),
    [screenings, inspectedScreening]
  );

  const patientFollowUps = useMemo(
    () => followUps.filter((f) => f.patientId === inspectedScreening?.patientId),
    [followUps, inspectedScreening]
  );

  const categories: Array<'all' | ScreeningCategory> = [
    'all',
    'urgent_escalation',
    'further_assessment_needed',
    'routine_follow_up',
    'incomplete_information',
  ];

  return (
    <div className="space-y-4">
      <div className="p-5 rounded-xl bg-white border border-slate-200 space-y-3">
        <div className="flex items-center gap-2">
          <Stethoscope className="w-4 h-4 text-teal-700" />
          <h1 className="text-base font-bold text-slate-900">
            {isHi ? 'जांच रिकॉर्ड — सभी ग्राम' : 'Screening Records — All Villages'}
          </h1>
        </div>
        <p className="text-xs text-slate-500">
          {isHi
            ? 'सीतापुर (उत्तर प्रदेश) के ASHA स्वास्थ्य कार्यकर्ताओं द्वारा दर्ज क्लिनिकल स्क्रीनिंग की केंद्रीकृत समीक्षा।'
            : 'Centralized review of clinical screenings recorded by ASHA/health workers across Sitapur (Uttar Pradesh).'}
        </p>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isHi ? 'नाम, ID, गांव के अनुसार खोजें…' : 'Search by name, ID, village…'}
            className="w-full min-h-[44px] pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`min-h-[34px] px-3 py-1.5 rounded-full text-[11px] font-semibold border ${
                categoryFilter === cat
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {cat === 'all' ? (isHi ? 'सभी' : 'All') : formatCategoryLabel(cat, language)}
            </button>
          ))}
        </div>
      </div>

      {filteredScreenings.length === 0 ? (
        <p className="p-6 text-center text-xs text-slate-500">
          {isHi ? 'कोई जांच रिकॉर्ड नहीं मिला।' : 'No screening records match.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {filteredScreenings.map((s) => (
            <li key={s.screeningId}>
              <button
                type="button"
                onClick={() => setInspectedScreeningId(s.screeningId)}
                className="w-full text-left p-3.5 rounded-xl bg-white border border-slate-200 hover:border-teal-400 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div>
                  <p className="text-xs font-bold text-slate-900">{s.patientName || s.patientId}</p>
                  <p className="text-[11px] text-slate-500 font-mono">
                    {s.screeningId} · {s.patientVillage} · {s.screeningDate} ·{' '}
                    {isHi ? 'दर्ज' : 'by'} {s.recordedByName}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
                    CATEGORY_COLORS[s.resultCategory]
                  }`}
                >
                  {formatCategoryLabel(s.resultCategory, language)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <PatientScreeningModal
        isOpen={Boolean(inspectedScreening)}
        onClose={() => setInspectedScreeningId(null)}
        patient={inspectedPatient}
        screening={inspectedScreening}
        allPatientScreenings={patientScreenings}
        referral={inspectedReferral}
        patientFollowUps={patientFollowUps}
        currentUserRole="doctor"
        currentUserName={doctorName}
        language={language}
        onUpdateReferral={async (params) => {
          const result = await updateReferral(params);
          if (result.ok) await refresh();
          return result;
        }}
      />
    </div>
  );
}

export default function DoctorScreeningsPage() {
  return (
    <Suspense
      fallback={<div className="p-6 text-center text-sm text-slate-500">Loading…</div>}
    >
      <ScreeningsContent />
    </Suspense>
  );
}
