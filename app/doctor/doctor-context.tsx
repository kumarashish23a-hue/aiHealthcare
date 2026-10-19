'use client';

import React, { createContext, useContext } from 'react';
import { DEMO_USERS } from '@/src/lib/synthetic-fixtures';
import type {
  DashboardMetrics,
  FollowUpRecord,
  LanguageCode,
  PatientRecord,
  ReferralRecord,
  ScreeningRecord,
} from '@/src/lib/types';

export const DOCTOR_AUTH_HEADERS = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  Authorization: 'Bearer demo-session-doctor',
  'X-Active-Role': 'doctor',
});

export const DOCTOR_NAME = DEMO_USERS.doctor.fullName;

export interface DoctorWorkspace {
  patients: PatientRecord[];
  screenings: ScreeningRecord[];
  referrals: ReferralRecord[];
  followUps: FollowUpRecord[];
  metrics: DashboardMetrics;
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  doctorName: string;
  refresh: () => Promise<void>;
  updateReferral: (params: {
    referralId: string;
    status: string;
    assignedProfessional: string;
    doctorNotes: string;
    followUpPlan: string;
    unableReason: string;
    expectedVersion: number;
    forceResolveConflict?: boolean;
  }) => Promise<{ ok: boolean; conflict?: boolean; serverRecord?: ReferralRecord; error?: string }>;
}

const DoctorContext = createContext<DoctorWorkspace | null>(null);

export const DoctorProvider = DoctorContext.Provider;

export function useDoctorWorkspace(): DoctorWorkspace {
  const ctx = useContext(DoctorContext);
  if (!ctx) throw new Error('useDoctorWorkspace must be used inside /doctor layout');
  return ctx;
}
