'use client';

import React, { useMemo, useState } from 'react';
import { PhcDoctorDashboard } from '@/components/PhcDoctorDashboard';
import { PatientScreeningModal } from '@/components/PatientScreeningModal';
import type { ReferralRecord, ReferralStatus, ScreeningRecord } from '@/src/lib/types';
import { useDoctorWorkspace } from '../doctor-context';

export default function DoctorReferralsPage() {
  const {
    patients,
    screenings,
    referrals,
    followUps,
    metrics,
    language,
    doctorName,
    refresh,
    updateReferral,
  } = useDoctorWorkspace();

  const [inspectedScreeningId, setInspectedScreeningId] = useState<string | null>(null);

  const inspectedScreening = useMemo(
    () => screenings.find((s) => s.screeningId === inspectedScreeningId),
    [screenings, inspectedScreeningId]
  );

  const inspectedPatient = useMemo(
    () => patients.find((p) => p.patientId === inspectedScreening?.patientId),
    [patients, inspectedScreening]
  );

  const inspectedReferral = useMemo(
    () => referrals.find((r) => r.screeningId === inspectedScreeningId),
    [referrals, inspectedScreeningId]
  );

  const patientScreenings = useMemo(
    () => screenings.filter((s) => s.patientId === inspectedScreening?.patientId),
    [screenings, inspectedScreening]
  );

  const patientFollowUps = useMemo(
    () => followUps.filter((f) => f.patientId === inspectedScreening?.patientId),
    [followUps, inspectedScreening]
  );

  return (
    // Dark-shell remapping: PhcDoctorDashboard / PatientScreeningModal live in
    // components/ (outside this page) and ship light classes; the arbitrary-
    // variant classes on this wrapper remap their common light surfaces to the
    // dark palette so they sit correctly inside the dark doctor shell.
    <div className="space-y-4 [&_.bg-white]:bg-[#15171C] [&_.bg-slate-50]:bg-white/5 [&_.bg-slate-100]:bg-white/5 [&_.bg-red-50]:bg-red-400/10 [&_.bg-amber-50]:bg-amber-400/10 [&_.bg-emerald-50]:bg-emerald-400/10 [&_.bg-teal-50]:bg-emerald-400/10 [&_.border-slate-200]:border-white/5 [&_.border-slate-100]:border-white/5 [&_.border-slate-300]:border-white/10 [&_.border-red-200]:border-red-400/20 [&_.border-amber-200]:border-amber-400/20 [&_.border-emerald-200]:border-emerald-400/20 [&_.border-teal-700]:border-emerald-400/40 [&_.text-slate-900]:text-slate-50 [&_.text-slate-800]:text-slate-100 [&_.text-slate-700]:text-slate-200 [&_.text-slate-600]:text-slate-300 [&_.text-slate-500]:text-slate-400 [&_.text-teal-800]:text-emerald-200 [&_.text-teal-700]:text-emerald-300 [&_.bg-slate-900]:bg-white/10">

      <PhcDoctorDashboard
        currentUserRole="doctor"
        language={language}
        metrics={metrics}
        referrals={referrals}
        screenings={screenings}
        onOpenReferralSummary={(ref: ReferralRecord) => setInspectedScreeningId(ref.screeningId)}
        onQuickUpdateReferralStatus={async (ref: ReferralRecord, status: ReferralStatus) => {
          await updateReferral({
            referralId: ref.referralId,
            status,
            assignedProfessional: ref.assignedProfessional || doctorName,
            doctorNotes: ref.doctorNotes,
            followUpPlan: ref.followUpPlan,
            unableReason: ref.unableReason,
            expectedVersion: ref.version,
          });
          await refresh();
        }}
      />

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
