import {
  AppUser,
  AuditLogEntry,
  FollowUpRecord,
  PatientRecord,
  ReferralRecord,
  ScreeningRecord,
} from './types';

export const DEMO_USERS: Record<'health_worker' | 'doctor', AppUser> = {
  health_worker: {
    uid: 'demo-asha-01',
    email: 'sunita.asha.demo@swasthyasetu.example.org',
    fullName: 'Sunita Devi (ASHA-UP-204)',
    role: 'health_worker',
    facilityName: 'Sub-Centre Rampur · Sitapur, Uttar Pradesh',
    preferredLanguage: 'en',
    isDemo: true,
    workerProfile: {
      workerCode: 'ASHA-UP-204',
      assignedVillage: 'Rampur',
      blockName: 'Sitapur Rural',
      district: 'Sitapur',
      primaryPhc: 'Simulated PHC Rampur, Sitapur — Uttar Pradesh (Demo)',
      phoneLastFour: '4821',
    },
  },
  doctor: {
    uid: 'demo-doctor-01',
    email: 'dr.verma.phc.demo@swasthyasetu.example.org',
    fullName: 'Dr. Rajesh Verma (MO-PHC)',
    role: 'doctor',
    facilityName: 'Simulated PHC Rampur, Sitapur — Uttar Pradesh (Demo)',
    preferredLanguage: 'en',
    isDemo: true,
  },
};

// Clean datasets without mock/demo records
export const INITIAL_SYNTHETIC_PATIENTS: PatientRecord[] = [];
export const INITIAL_SYNTHETIC_SCREENINGS: ScreeningRecord[] = [];
export const INITIAL_SYNTHETIC_REFERRALS: ReferralRecord[] = [];
export const INITIAL_SYNTHETIC_FOLLOW_UPS: FollowUpRecord[] = [];
export const INITIAL_AUDIT_LOGS: AuditLogEntry[] = [];
