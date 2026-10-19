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
  const [rbacMessage, setRbacMessage] = useState<string | null>(null);

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

  const testUnauthorizedDoctorAction = async (): Promise<string> => {
    const res = await fetch('/api/workspace', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer demo-session-asha',
        'X-Active-Role': 'health_worker',
      },
      body: JSON.stringify({
        action: 'update_referral',
        payload: {
          referralId: 'REF-PHC-5001',
          status: 'completed',
          expectedVersion: 1,
        },
      }),
    });
    const data = await res.json();
    return `Server Response HTTP ${res.status}: ${data.error}`;
  };

  return (
    <div className="space-y-4">
      {rbacMessage && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-xs font-mono text-amber-950">
          {rbacMessage}
        </div>
      )}

      <PhcDoctorDashboard
        currentUserRole="doctor"
        language={language}
        metrics={metrics}
        referrals={referrals}
        screenings={screenings}
        onSwitchToDoctorRole={() => setRbacMessage(null)}
        onTestUnauthorizedDoctorAction={testUnauthorizedDoctorAction}
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
