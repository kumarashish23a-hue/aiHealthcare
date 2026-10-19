'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  ShieldAlert,
  UserCheck,
  X,
} from 'lucide-react';
import {
  FollowUpRecord,
  LanguageCode,
  PatientRecord,
  ReferralRecord,
  ReferralStatus,
  ScreeningRecord,
  UserRole,
} from '@/src/lib/types';
import {
  formatCategoryLabel,
  formatFollowUpStatus,
  formatReferralStatus,
  SYMPTOM_CATALOG,
  UI_LABELS,
} from '@/src/lib/i18n';

interface PatientScreeningModalProps {
  isOpen: boolean;
  onClose: () => void;
  patient: PatientRecord | undefined;
  screening: ScreeningRecord | undefined;
  allPatientScreenings: ScreeningRecord[];
  referral: ReferralRecord | undefined;
  patientFollowUps: FollowUpRecord[];
  currentUserRole: UserRole;
  currentUserName: string;
  language: LanguageCode;
  onUpdateReferral: (params: {
    referralId: string;
    status: ReferralStatus;
    assignedProfessional: string;
    doctorNotes: string;
    followUpPlan: string;
    unableReason: string;
    expectedVersion: number;
    forceResolveConflict?: boolean;
  }) => Promise<{ ok: boolean; conflict?: boolean; serverRecord?: ReferralRecord; error?: string }>;
  onCreateReferralFromScreening?: (screening: ScreeningRecord) => Promise<void>;
}

export const PatientScreeningModal: React.FC<PatientScreeningModalProps> = ({
  isOpen,
  onClose,
  patient,
  screening,
  allPatientScreenings,
  referral,
  patientFollowUps,
  currentUserRole,
  currentUserName,
  language,
  onUpdateReferral,
  onCreateReferralFromScreening,
}) => {
  const [status, setStatus] = useState<ReferralStatus>(referral?.status || 'acknowledged');
  const [assignedPro, setAssignedPro] = useState<string>(
    referral?.assignedProfessional || currentUserName
  );
  const [doctorNotes, setDoctorNotes] = useState<string>(referral?.doctorNotes || '');
  const [followUpPlan, setFollowUpPlan] = useState<string>(referral?.followUpPlan || '');
  const [unableReason, setUnableReason] = useState<string>(referral?.unableReason || '');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'conflict'; message: string } | null>(
    null
  );
  const [conflictServerRecord, setConflictServerRecord] = useState<ReferralRecord | null>(null);
  const [simulateStaleVersion, setSimulateStaleVersion] = useState(false);

  if (!isOpen || !screening) return null;

  const canManageReferral = currentUserRole === 'doctor' || currentUserRole === 'phc_admin';
  const labels = UI_LABELS[language];

  const handleSaveReferralUpdate = async (
    overrideStatus?: ReferralStatus,
    forceResolveConflict = false
  ) => {
    if (!referral) return;
    const targetStatus = overrideStatus || status;

    if (targetStatus === 'unable_to_complete' && !unableReason.trim()) {
      setFeedback({
        type: 'error',
        message:
          language === 'hi'
            ? 'कृपया रेफरल पूर्ण न हो पाने का कारण दर्ज करें।'
            : 'Please record the reason why this referral could not be completed.',
      });
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    try {
      const expectedVersion = simulateStaleVersion
        ? Math.max(0, referral.version - 1)
        : referral.version;

      const res = await onUpdateReferral({
        referralId: referral.referralId,
        status: targetStatus,
        assignedProfessional: assignedPro,
        doctorNotes,
        followUpPlan,
        unableReason,
        expectedVersion,
        forceResolveConflict,
      });

      if (res.conflict && res.serverRecord) {
        setConflictServerRecord(res.serverRecord);
        setFeedback({
          type: 'conflict',
          message:
            'Version conflict detected: Another user updated this referral (server version is newer). Review both versions below before overwriting.',
        });
      } else if (res.ok) {
        setStatus(targetStatus);
        setConflictServerRecord(null);
        setSimulateStaleVersion(false);
        setFeedback({
          type: 'success',
          message:
            language === 'hi'
              ? `रेफरल स्थिति '${formatReferralStatus(targetStatus, 'hi')}' के रूप में सुरक्षित की गई।`
              : `Referral status updated to "${formatReferralStatus(targetStatus, 'en')}".`,
        });
      } else {
        setFeedback({
          type: 'error',
          message: res.error || 'Failed to update referral.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-6 overflow-y-auto">
      <div className="w-full max-w-4xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Top Modal Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 bg-slate-50 border-b border-slate-200 shrink-0">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
              <span>{screening.screeningId}</span>
              <span aria-hidden="true">·</span>
              <span>{screening.patientId}</span>
              {referral && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{referral.referralId}</span>
                </>
              )}
            </div>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">
              {patient?.fullName || screening.patientName || screening.patientId} — Clinical Screening Summary
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-200/70 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Patient Demographics & Triage Category Banner */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div>
              <p className="text-xs text-slate-500">Patient Demographics</p>
              <p className="text-sm font-semibold text-slate-900 mt-1">
                {patient?.fullName || screening.patientName}{' '}
                <span className="font-normal text-slate-600">
                  ({patient?.ageYears ?? screening.patientAge ?? '--'} yrs ·{' '}
                  {patient?.sex ?? screening.patientSex ?? '--'})
                </span>
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                Village: {patient?.village || screening.patientVillage || 'Rampur'} · Phone: ****
                {patient?.phoneLastFour || '0000'}
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-500">Known History & Consent</p>
              <p className="text-sm font-medium text-slate-800 mt-1">
                {patient?.knownConditions && patient.knownConditions.length > 0
                  ? patient.knownConditions.join(', ')
                  : 'No chronic conditions reported'}
              </p>
              <p className="text-xs text-emerald-700 mt-0.5 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Informed Consent Recorded</span>
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-500">Screening Workflow State</p>
              <div className="mt-1 flex items-center gap-2">
                {screening.resultCategory === 'urgent_escalation' && (
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                )}
                {screening.resultCategory === 'further_assessment_needed' && (
                  <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                )}
                {screening.resultCategory === 'incomplete_information' && (
                  <ShieldAlert className="w-4 h-4 text-slate-600 shrink-0" />
                )}
                {screening.resultCategory === 'routine_follow_up' && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                )}
                <span
                  className={`text-sm font-bold ${
                    screening.resultCategory === 'urgent_escalation'
                      ? 'text-red-700'
                      : screening.resultCategory === 'further_assessment_needed'
                        ? 'text-amber-700'
                        : screening.resultCategory === 'incomplete_information'
                          ? 'text-slate-700'
                          : 'text-emerald-700'
                  }`}
                >
                  {formatCategoryLabel(screening.resultCategory, language)}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                Date: {screening.screeningDate} · {screening.engineVersion}
              </p>
            </div>
          </div>

          {/* Recorded Measurements Grid */}
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-3">
              Recorded Screening Measurements & Vitals
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl border border-slate-200 bg-white">
                <p className="text-xs text-slate-500">Blood Pressure</p>
                <p className="text-base font-bold text-slate-900 font-mono tabular-nums mt-0.5">
                  {screening.systolicBp != null && screening.diastolicBp != null
                    ? `${screening.systolicBp}/${screening.diastolicBp} mmHg`
                    : 'Not Recorded'}
                </p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 bg-white">
                <p className="text-xs text-slate-500">Oxygen Saturation (SpO2)</p>
                <p className="text-base font-bold text-slate-900 font-mono tabular-nums mt-0.5">
                  {screening.spo2Percent != null ? `${screening.spo2Percent}%` : 'Missing'}
                </p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 bg-white">
                <p className="text-xs text-slate-500">Temperature</p>
                <p className="text-base font-bold text-slate-900 font-mono tabular-nums mt-0.5">
                  {screening.temperatureC != null ? `${screening.temperatureC} °C` : 'Missing'}
                </p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 bg-white">
                <p className="text-xs text-slate-500">Pulse / Resp Rate</p>
                <p className="text-base font-bold text-slate-900 font-mono tabular-nums mt-0.5">
                  {screening.heartRateBpm != null ? `${screening.heartRateBpm} bpm` : '--'} /{' '}
                  {screening.respiratoryRateBpm != null ? `${screening.respiratoryRateBpm}/m` : '--'}
                </p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 bg-white">
                <p className="text-xs text-slate-500">Random Blood Glucose</p>
                <p className="text-base font-bold text-slate-900 font-mono tabular-nums mt-0.5">
                  {screening.randomBloodGlucoseMgDl != null
                    ? `${screening.randomBloodGlucoseMgDl} mg/dL`
                    : 'Not Tested'}
                </p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 bg-white">
                <p className="text-xs text-slate-500">Hemoglobin (Hb)</p>
                <p className="text-base font-bold text-slate-900 font-mono tabular-nums mt-0.5">
                  {screening.hemoglobinGDl != null ? `${screening.hemoglobinGDl} g/dL` : 'Not Tested'}
                </p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 bg-white">
                <p className="text-xs text-slate-500">Maternal Status</p>
                <p className="text-sm font-semibold text-slate-900 mt-0.5">
                  {screening.isPregnant
                    ? `Pregnant (${screening.gestationalWeeks ?? '?'} wks)`
                    : 'Not Pregnant / N/A'}
                </p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 bg-white">
                <p className="text-xs text-slate-500">Symptom Duration</p>
                <p className="text-base font-bold text-slate-900 font-mono tabular-nums mt-0.5">
                  {screening.symptomDurationDays} days
                </p>
              </div>
            </div>

            {/* Symptoms & Notes */}
            <div className="mt-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-700 space-y-1">
              <p>
                <span className="font-semibold text-slate-900">Reported Symptoms: </span>
                {screening.symptoms.length > 0
                  ? screening.symptoms
                      .map((id) => SYMPTOM_CATALOG.find((s) => s.id === id)?.labelEn || id)
                      .join(' · ')
                  : 'No active symptoms reported'}
              </p>
              {screening.medicalHistoryNotes && (
                <p>
                  <span className="font-semibold text-slate-900">Field Observation Notes: </span>
                  {screening.medicalHistoryNotes}
                </p>
              )}
            </div>
          </div>

          {/* Why Case Was Flagged */}
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-2">
              Why This Case Was Flagged (Clinician-Reviewed Prototype Rules)
            </h3>
            {screening.flaggedReasons.length === 0 ? (
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-700">
                All core screening measurements were present and within routine reference ranges. No red-flag or moderate risk rules were triggered.
              </div>
            ) : (
              <div className="space-y-2.5">
                {screening.flaggedReasons.map((reason, idx) => (
                  <div
                    key={`${reason.code}-${idx}`}
                    className="p-3.5 rounded-xl border border-slate-200 bg-white flex flex-col sm:flex-row sm:items-start justify-between gap-2"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">
                          {language === 'hi' ? reason.titleHi : reason.titleEn}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span className="text-xs font-mono text-slate-500">
                          {reason.observedValue}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600">
                        {language === 'hi' ? reason.explanationHi : reason.explanationEn}
                      </p>
                    </div>
                    <span className="text-[11px] font-mono text-slate-500 shrink-0">
                      {reason.referenceRule}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Referral Management Section (Component 4D) */}
          <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4 text-teal-700" />
                  <span>Simulated PHC Referral & Follow-up Management</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">{labels.simulatedPhcNotice}</p>
              </div>
              {!referral && onCreateReferralFromScreening && (
                <button
                  type="button"
                  onClick={() => onCreateReferralFromScreening(screening)}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 transition-colors"
                >
                  Create Simulated PHC Referral
                </button>
              )}
            </div>

            {referral ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-white border border-slate-200 text-xs">
                  <div>
                    <span className="text-slate-500">Referral ID & Version:</span>
                    <p className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                      {referral.referralId} · v{referral.version}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Destination Facility:</span>
                    <p className="font-semibold text-slate-900 mt-0.5">
                      {referral.destinationFacility}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Current Referral Status:</span>
                    <p className="font-bold text-teal-800 mt-0.5">
                      {formatReferralStatus(referral.status, language)}
                    </p>
                  </div>
                </div>

                {canManageReferral ? (
                  <div className="space-y-4 bg-white p-4 rounded-xl border border-slate-200">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                      <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                        <UserCheck className="w-4 h-4 text-teal-700" />
                        <span>PHC Doctor Quick Disposition Actions:</span>
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => handleSaveReferralUpdate('acknowledged')}
                          className="min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 text-slate-800 hover:bg-slate-100 transition-colors"
                        >
                          1. Acknowledge
                        </button>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => handleSaveReferralUpdate('under_review')}
                          className="min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 transition-colors"
                        >
                          2. Mark Under Review
                        </button>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => handleSaveReferralUpdate('completed')}
                          className="min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
                        >
                          3. Mark Completed
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Referral Status
                        </label>
                        <select
                          value={status}
                          onChange={(e) => setStatus(e.target.value as ReferralStatus)}
                          className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white"
                        >
                          <option value="pending">Pending PHC Review</option>
                          <option value="acknowledged">Acknowledged</option>
                          <option value="under_review">Under Clinical Review</option>
                          <option value="completed">Completed</option>
                          <option value="unable_to_complete">Unable to Complete</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Assigned Healthcare Professional
                        </label>
                        <input
                          type="text"
                          value={assignedPro}
                          onChange={(e) => setAssignedPro(e.target.value)}
                          className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                          placeholder="Dr. Rajesh Verma (MO-PHC)"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Doctor Clinical Assessment Notes
                      </label>
                      <textarea
                        rows={2}
                        value={doctorNotes}
                        onChange={(e) => setDoctorNotes(e.target.value)}
                        className="w-full p-3 rounded-xl border border-slate-300 text-sm text-slate-900"
                        placeholder="Record PHC examination findings, confirmatory test results..."
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Follow-up Plan for ASHA Worker
                      </label>
                      <textarea
                        rows={2}
                        value={followUpPlan}
                        onChange={(e) => setFollowUpPlan(e.target.value)}
                        className="w-full p-3 rounded-xl border border-slate-300 text-sm text-slate-900"
                        placeholder="Specify home visit checks, medication adherence verification, and target date..."
                      />
                    </div>

                    {status === 'unable_to_complete' && (
                      <div>
                        <label className="block text-xs font-semibold text-red-700 mb-1">
                          Reason Referral Could Not Be Completed (Required)
                        </label>
                        <input
                          type="text"
                          value={unableReason}
                          onChange={(e) => setUnableReason(e.target.value)}
                          className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-red-300 text-sm text-slate-900"
                          placeholder="e.g., Patient relocated outside block / Declined transit / Referred to District Hospital"
                        />
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                      <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={simulateStaleVersion}
                          onChange={(e) => setSimulateStaleVersion(e.target.checked)}
                          className="rounded border-slate-300"
                        />
                        <span>
                          Test Conflict Detection (send stale version v
                          {Math.max(0, referral.version - 1)})
                        </span>
                      </label>

                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleSaveReferralUpdate()}
                        className="min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors"
                      >
                        {submitting ? 'Saving Referral Update...' : 'Save Referral & Care Plan'}
                      </button>
                    </div>

                    {feedback && (
                      <div
                        className={`p-3.5 rounded-xl border text-xs ${
                          feedback.type === 'success'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            : feedback.type === 'conflict'
                              ? 'bg-amber-50 border-amber-300 text-amber-900'
                              : 'bg-red-50 border-red-200 text-red-900'
                        }`}
                      >
                        <p className="font-semibold">{feedback.message}</p>
                        {conflictServerRecord && (
                          <div className="mt-3 space-y-2 pt-2 border-t border-amber-200">
                            <p className="font-mono text-[11px]">
                              Server Version (v{conflictServerRecord.version}): Status ={' '}
                              {conflictServerRecord.status} · Follow-up Plan = &quot;
                              {conflictServerRecord.followUpPlan || 'None'}&quot;
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setStatus(conflictServerRecord.status);
                                  setDoctorNotes(conflictServerRecord.doctorNotes);
                                  setFollowUpPlan(conflictServerRecord.followUpPlan);
                                  setConflictServerRecord(null);
                                  setSimulateStaleVersion(false);
                                  setFeedback({
                                    type: 'success',
                                    message: 'Adopted latest server version.',
                                  });
                                }}
                                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-800 font-semibold"
                              >
                                Keep Server Version
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveReferralUpdate(status, true)}
                                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-amber-800 text-white font-semibold"
                              >
                                Force Apply My Update
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-white border border-slate-200 text-xs text-slate-700 space-y-1.5">
                    <p className="font-semibold text-slate-900">
                      PHC Doctor Care Plan (Read-Only for ASHA Health Worker Role):
                    </p>
                    <p>
                      <span className="text-slate-500">Assigned Doctor: </span>
                      {referral.assignedProfessional || 'Awaiting PHC assignment'}
                    </p>
                    <p>
                      <span className="text-slate-500">Doctor Notes: </span>
                      {referral.doctorNotes || 'Pending PHC review'}
                    </p>
                    <p>
                      <span className="text-slate-500">Follow-up Plan: </span>
                      {referral.followUpPlan || 'Pending PHC review'}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-600">
                No referral has been linked to this screening record yet.
              </p>
            )}
          </div>

          {/* Previous Screening History & Follow-up History for this Patient */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <h4 className="text-xs font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <span>Patient Screening History ({allPatientScreenings.length})</span>
              </h4>
              <div className="space-y-2">
                {allPatientScreenings.map((hist) => (
                  <div
                    key={hist.screeningId}
                    className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-xs flex items-center justify-between gap-2"
                  >
                    <div>
                      <p className="font-mono font-semibold text-slate-800 tabular-nums">
                        {hist.screeningDate} · {hist.screeningId}
                      </p>
                      <p className="text-slate-600 mt-0.5">
                        BP:{' '}
                        {hist.systolicBp && hist.diastolicBp
                          ? `${hist.systolicBp}/${hist.diastolicBp}`
                          : 'Missing'}{' '}
                        · SpO2: {hist.spo2Percent ?? '--'}%
                      </p>
                    </div>
                    <span className="font-semibold text-slate-700">
                      {formatCategoryLabel(hist.resultCategory, 'en')}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <h4 className="text-xs font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                <span>Follow-up Schedule & Status ({patientFollowUps.length})</span>
              </h4>
              {patientFollowUps.length === 0 ? (
                <p className="text-xs text-slate-500">No follow-up records logged for this patient.</p>
              ) : (
                <div className="space-y-2">
                  {patientFollowUps.map((fup) => (
                    <div
                      key={fup.followUpId}
                      className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between font-mono tabular-nums">
                        <span className="font-semibold text-slate-800">
                          {fup.followUpId} · Due {fup.scheduledDate}
                        </span>
                        <span
                          className={`font-bold ${
                            fup.status === 'overdue'
                              ? 'text-red-700'
                              : fup.status === 'completed'
                                ? 'text-emerald-700'
                                : 'text-amber-700'
                          }`}
                        >
                          {formatFollowUpStatus(fup.status, language)}
                        </span>
                      </div>
                      <p className="text-slate-600">{fup.notes}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Mandatory Clinical Disclaimer */}
          <div className="p-4 rounded-xl bg-slate-100 border border-slate-200 text-xs text-slate-600">
            <p className="font-bold text-slate-800">{labels.disclaimerHeader}</p>
            <p className="mt-1">{labels.disclaimerBody}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
