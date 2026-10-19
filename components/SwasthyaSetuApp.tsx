'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import {
  AlertTriangle,
  Globe,
  HeartPulse,
  Home,
  Lock,
  LogIn,
  LogOut,
  RefreshCw,
  Send,
  Settings,
  Stethoscope,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { auth, googleAuthProvider } from '@/src/lib/firebase';
import {
  AppUser,
  AuditLogEntry,
  FollowUpRecord,
  FollowUpStatus,
  LanguageCode,
  PatientRecord,
  ReferralRecord,
  ReferralStatus,
  ScreeningEvaluationResult,
  ScreeningRecord,
  UserRole,
} from '@/src/lib/types';
import {
  DEMO_USERS,
  INITIAL_AUDIT_LOGS,
  INITIAL_SYNTHETIC_FOLLOW_UPS,
  INITIAL_SYNTHETIC_PATIENTS,
  INITIAL_SYNTHETIC_REFERRALS,
  INITIAL_SYNTHETIC_SCREENINGS,
} from '@/src/lib/synthetic-fixtures';
import { UI_LABELS } from '@/src/lib/i18n';
import { evaluateScreening } from '@/src/lib/screening-engine';
import {
  calculateDashboardMetrics,
  detectDuplicateReferral,
} from '@/src/lib/workflow-logic';
import {
  checkDeviceOfflineStorageSafety,
  enqueueOfflineMutation,
  offlineDb,
  purgeLocalRecordsSafely,
  QueuedSyncMutation,
} from '@/src/lib/offline-db';
import { processSyncQueue } from '@/src/lib/sync-engine';
import { HealthWorkerView } from './HealthWorkerView';
import { PhcDoctorDashboard } from './PhcDoctorDashboard';
import { OfflinePrivacyView } from './OfflinePrivacyView';
import { PatientScreeningModal } from './PatientScreeningModal';

type MainSection = 'worker' | 'phc' | 'offline';
type WorkerSubTab = 'overview' | 'register' | 'screening' | 'referrals';

export const SwasthyaSetuApp: React.FC = () => {
  // Navigation & Language State
  const [mainSection, setMainSection] = useState<MainSection>('worker');
  const [workerSubTab, setWorkerSubTab] = useState<WorkerSubTab>('overview');
  const [language, setLanguage] = useState<LanguageCode>('en');

  // Auth & Role Persona State (ID token kept strictly in memory, never localStorage)
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [idTokenInMemory, setIdTokenInMemory] = useState<string | null>(null);
  const [activeRole, setActiveRole] = useState<UserRole>('health_worker');
  const [isSessionLocked, setIsSessionLocked] = useState<boolean>(false);
  const [unlockPin, setUnlockPin] = useState<string>('');
  const [unlockError, setUnlockError] = useState<string>('');

  // Network & Offline Sync State
  const [browserOnline, setBrowserOnline] = useState<boolean>(() => {
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine;
  });
  const [simulatedOffline, setSimulatedOffline] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [untrustedDeviceMode, setUntrustedDeviceMode] = useState<boolean>(false);
  const [syncQueue, setSyncQueue] = useState<QueuedSyncMutation[]>([]);

  // Clinical Application Data State
  const [patients, setPatients] = useState<PatientRecord[]>(INITIAL_SYNTHETIC_PATIENTS);
  const [screenings, setScreenings] = useState<ScreeningRecord[]>(INITIAL_SYNTHETIC_SCREENINGS);
  const [referrals, setReferrals] = useState<ReferralRecord[]>(INITIAL_SYNTHETIC_REFERRALS);
  const [followUps, setFollowUps] = useState<FollowUpRecord[]>(INITIAL_SYNTHETIC_FOLLOW_UPS);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(INITIAL_AUDIT_LOGS);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [bannerNotice, setBannerNotice] = useState<string | null>(null);

  // Selected Modal Inspection State
  const [inspectedScreeningId, setInspectedScreeningId] = useState<string | null>(null);

  const effectiveOffline = !browserOnline || simulatedOffline;
  const labels = UI_LABELS[language];

  const storageSafety = useMemo(() => checkDeviceOfflineStorageSafety(), []);

  const currentUser: AppUser = useMemo(() => {
    if (firebaseUser) {
      return {
        uid: firebaseUser.uid,
        email: firebaseUser.email || 'user@swasthyasetu.org',
        fullName: firebaseUser.displayName || firebaseUser.email || 'Authenticated Clinician',
        role: activeRole,
        facilityName:
          activeRole === 'doctor'
            ? 'Simulated PHC Rampur (Demo)'
            : 'Sub-Centre Rampur · Simulated PHC Rampur',
        preferredLanguage: language,
        isDemo: false,
      };
    }
    return activeRole === 'doctor' ? DEMO_USERS.doctor : DEMO_USERS.health_worker;
  }, [firebaseUser, activeRole, language]);

  const getAuthHeaders = useCallback(
    (overrideRole?: UserRole): Record<string, string> => {
      const targetRole = overrideRole || activeRole;
      const bearer = idTokenInMemory
        ? `Bearer ${idTokenInMemory}`
        : targetRole === 'doctor'
          ? 'Bearer demo-session-doctor'
          : 'Bearer demo-session-asha';
      return {
        'Content-Type': 'application/json',
        Authorization: bearer,
        'X-Active-Role': targetRole,
      };
    },
    [idTokenInMemory, activeRole]
  );

  // Monitor Firebase Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (usr) => {
      setFirebaseUser(usr);
      if (usr) {
        try {
          const token = await usr.getIdToken();
          setIdTokenInMemory(token);
        } catch {
          setIdTokenInMemory(null);
        }
      } else {
        setIdTokenInMemory(null);
      }
    });
    return () => unsub();
  }, []);

  // Monitor Browser Online/Offline events
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Strict Role Guard is handled in role-switch handlers and view render guard

  // Load workspace data from Cloud SQL API or IndexedDB
  const fetchWorkspaceFromServer = useCallback(async () => {
    try {
      const res = await fetch('/api/workspace', {
        method: 'GET',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setPatients(data.patients);
        setScreenings(data.screenings);
        setReferrals(data.referrals);
        setFollowUps(data.followUps);
        setAuditLogs(data.auditLogs);

        if (offlineDb && storageSafety.isSupported && !untrustedDeviceMode) {
          await Promise.all([
            offlineDb.patients.bulkPut(data.patients),
            offlineDb.screenings.bulkPut(data.screenings),
            offlineDb.referrals.bulkPut(data.referrals),
            offlineDb.followUps.bulkPut(data.followUps),
          ]);
        }
      }
    } catch {
      // Uses local state / IndexedDB when offline
    } finally {
      setInitialLoading(false);
    }
  }, [getAuthHeaders, storageSafety.isSupported, untrustedDeviceMode]);

  useEffect(() => {
    let active = true;
    fetch('/api/workspace', {
      method: 'GET',
      headers: getAuthHeaders(),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(async ({ ok, data }) => {
        if (!active) return;
        if (ok && data.ok) {
          setPatients(data.patients);
          setScreenings(data.screenings);
          setReferrals(data.referrals);
          setFollowUps(data.followUps);
          setAuditLogs(data.auditLogs);
          const dbInstance = offlineDb;
          if (dbInstance && storageSafety.isSupported && !untrustedDeviceMode) {
            await Promise.all([
              dbInstance.patients.bulkPut(data.patients),
              dbInstance.screenings.bulkPut(data.screenings),
              dbInstance.referrals.bulkPut(data.referrals),
              dbInstance.followUps.bulkPut(data.followUps),
            ]);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setInitialLoading(false);
      });
    return () => {
      active = false;
    };
  }, [getAuthHeaders, storageSafety.isSupported, untrustedDeviceMode]);

  // Load existing IndexedDB sync queue on mount
  useEffect(() => {
    if (!offlineDb) return;
    offlineDb.syncQueue.toArray().then((items) => {
      if (items.length > 0) {
        setSyncQueue(items);
      }
    });
  }, []);

  // Synchronize pending queue items with Cloud SQL server
  const handleSynchronizeQueue = useCallback(async () => {
    if (effectiveOffline || isSyncing) return;
    const pendingOrFailed = syncQueue.filter(
      (q) => q.status === 'pending' || q.status === 'failed'
    );
    if (pendingOrFailed.length === 0) return;

    setIsSyncing(true);
    try {
      const result = await processSyncQueue(syncQueue, async (mutation) => {
        const res = await fetch('/api/workspace', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            action: mutation.action,
            payload: mutation.payload,
            syncEventId: mutation.syncEventId,
          }),
        });
        const data = await res.json();
        return {
          ok: res.ok && Boolean(data.ok),
          serverConfirmed: Boolean(data.serverConfirmed),
          conflict: res.status === 409 || Boolean(data.conflict),
          serverRecord: data.serverRecord,
          error: data.error,
        };
      });

      setSyncQueue(result.updatedQueue);
      if (result.syncedCount > 0) {
        await fetchWorkspaceFromServer();
        setBannerNotice(`Synchronized ${result.syncedCount} offline record(s) with the server.`);
      }
    } finally {
      setIsSyncing(false);
    }
  }, [effectiveOffline, isSyncing, syncQueue, getAuthHeaders, fetchWorkspaceFromServer]);

  // Auto-retry synchronization when network reconnects
  useEffect(() => {
    if (effectiveOffline) return;
    const hasPending = syncQueue.some((q) => q.status === 'pending' || q.status === 'failed');
    if (!hasPending) return;
    const timer = setTimeout(() => {
      handleSynchronizeQueue();
    }, 150);
    return () => clearTimeout(timer);
  }, [effectiveOffline, syncQueue, handleSynchronizeQueue]);

  // Compute live dashboard metrics from current state
  const liveMetrics = useMemo(() => {
    return calculateDashboardMetrics(patients, screenings, referrals, followUps);
  }, [patients, screenings, referrals, followUps]);

  // --- Action Handlers ---
  const handleRegisterPatient = async (payload: {
    patientId: string;
    fullName: string;
    ageYears: number;
    sex: 'female' | 'male' | 'other';
    village: string;
    blockName: string;
    phoneLastFour: string;
    consentObtained: boolean;
    consentTimestamp: string;
    knownConditions: string[];
  }): Promise<{ ok: boolean; message: string; patientId?: string }> => {
    const existingLocal = patients.find((p) => p.patientId === payload.patientId);
    if (existingLocal) {
      return {
        ok: true,
        patientId: existingLocal.patientId,
        message: `Duplicate prevented: Patient ${existingLocal.patientId} (${existingLocal.fullName}) is already registered.`,
      };
    }

    if (effectiveOffline) {
      const offlinePatient: PatientRecord = {
        ...payload,
        registeredByUid: currentUser.uid,
        isSynthetic: true,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        syncStatus: 'pending',
      };
      setPatients((prev) => [offlinePatient, ...prev]);

      if (offlineDb && storageSafety.isSupported && !untrustedDeviceMode) {
        await offlineDb.patients.put(offlinePatient);
      }

      const { queued } = await enqueueOfflineMutation(
        {
          syncEventId: `SYNC-PAT-${payload.patientId}`,
          entityType: 'patient',
          entityId: payload.patientId,
          action: 'register_patient',
          payload,
        },
        syncQueue
      );
      setSyncQueue((prev) => [
        ...prev.filter((i) => i.syncEventId !== queued.syncEventId),
        queued,
      ]);

      return {
        ok: true,
        patientId: payload.patientId,
        message: `Patient ${payload.patientId} saved offline (queued for sync).`,
      };
    }

    try {
      const res = await fetch('/api/workspace', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          action: 'register_patient',
          payload,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.serverConfirmed) {
        await fetchWorkspaceFromServer();
        return {
          ok: true,
          patientId: payload.patientId,
          message: data.duplicatePrevented
            ? `Patient ${payload.patientId} already existed on server.`
            : `Patient ${payload.patientId} saved successfully.`,
        };
      }
      // Resilient fallback: Save offline to local storage if server responds with error
      const offlinePatient: PatientRecord = {
        ...payload,
        registeredByUid: currentUser.uid,
        isSynthetic: true,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        syncStatus: 'pending',
      };
      setPatients((prev) => [offlinePatient, ...prev]);
      if (offlineDb && storageSafety.isSupported && !untrustedDeviceMode) {
        await offlineDb.patients.put(offlinePatient);
      }
      const { queued } = await enqueueOfflineMutation(
        {
          syncEventId: `SYNC-PAT-${payload.patientId}`,
          entityType: 'patient',
          entityId: payload.patientId,
          action: 'register_patient',
          payload,
        },
        syncQueue
      );
      setSyncQueue((prev) => [
        ...prev.filter((i) => i.syncEventId !== queued.syncEventId),
        queued,
      ]);
      return {
        ok: true,
        patientId: payload.patientId,
        message: `Saved offline to device (queued for sync): Patient ${payload.patientId}.`,
      };
    } catch {
      const offlinePatient: PatientRecord = {
        ...payload,
        registeredByUid: currentUser.uid,
        isSynthetic: true,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        syncStatus: 'pending',
      };
      setPatients((prev) => [offlinePatient, ...prev]);
      if (offlineDb && storageSafety.isSupported && !untrustedDeviceMode) {
        await offlineDb.patients.put(offlinePatient);
      }
      return {
        ok: true,
        patientId: payload.patientId,
        message: `Network offline: Patient ${payload.patientId} saved to local device.`,
      };
    }
  };

  const handleSaveScreening = async (payload: {
    screeningId: string;
    patientId: string;
    screeningDate: string;
    systolicBp: number | null;
    diastolicBp: number | null;
    heartRateBpm: number | null;
    temperatureC: number | null;
    spo2Percent: number | null;
    randomBloodGlucoseMgDl: number | null;
    hemoglobinGDl: number | null;
    respiratoryRateBpm: number | null;
    isPregnant: boolean;
    gestationalWeeks: number | null;
    symptoms: string[];
    symptomDurationDays: number;
    medicalHistoryNotes: string;
    aiSupplementalNote: string;
    createReferralImmediately: boolean;
    referralDestination: string;
    customFollowUpDate?: string;
    customFollowUpNotes?: string;
  }): Promise<{
    ok: boolean;
    message: string;
    screeningId?: string;
    referralId?: string;
    evaluation?: ScreeningEvaluationResult;
  }> => {
    const evaluation = evaluateScreening({
      patientId: payload.patientId,
      systolicBp: payload.systolicBp,
      diastolicBp: payload.diastolicBp,
      heartRateBpm: payload.heartRateBpm,
      temperatureC: payload.temperatureC,
      spo2Percent: payload.spo2Percent,
      randomBloodGlucoseMgDl: payload.randomBloodGlucoseMgDl,
      hemoglobinGDl: payload.hemoglobinGDl,
      respiratoryRateBpm: payload.respiratoryRateBpm,
      isPregnant: payload.isPregnant,
      gestationalWeeks: payload.gestationalWeeks,
      symptoms: payload.symptoms,
      symptomDurationDays: payload.symptomDurationDays,
      medicalHistoryNotes: payload.medicalHistoryNotes,
    });

    if (!evaluation.isValid) {
      return {
        ok: false,
        message: evaluation.validationErrors.map((e) => e.messageEn).join(' '),
      };
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + evaluation.suggestedFollowUpDays);
    const followUpDueDate = payload.customFollowUpDate || dueDate.toISOString().slice(0, 10);
    const patientObj = patients.find((p) => p.patientId === payload.patientId);

    const newScreeningRecord: ScreeningRecord = {
      screeningId: payload.screeningId,
      patientId: payload.patientId,
      patientName: patientObj?.fullName || payload.patientId,
      patientVillage: patientObj?.village || 'Rampur',
      patientAge: patientObj?.ageYears,
      patientSex: patientObj?.sex,
      recordedByUid: currentUser.uid,
      recordedByName: currentUser.fullName,
      screeningDate: payload.screeningDate,
      systolicBp: payload.systolicBp,
      diastolicBp: payload.diastolicBp,
      heartRateBpm: payload.heartRateBpm,
      temperatureC: payload.temperatureC,
      spo2Percent: payload.spo2Percent,
      randomBloodGlucoseMgDl: payload.randomBloodGlucoseMgDl,
      hemoglobinGDl: payload.hemoglobinGDl,
      respiratoryRateBpm: payload.respiratoryRateBpm,
      isPregnant: payload.isPregnant,
      gestationalWeeks: payload.gestationalWeeks,
      symptoms: payload.symptoms,
      symptomDurationDays: payload.symptomDurationDays,
      medicalHistoryNotes: payload.medicalHistoryNotes,
      missingFields: evaluation.missingFields,
      resultCategory: evaluation.resultCategory,
      flaggedReasons: evaluation.flaggedReasons,
      recommendedNextSteps: evaluation.recommendedNextSteps,
      aiSupplementalNote: payload.aiSupplementalNote,
      engineVersion: evaluation.engineVersion,
      requiresFollowUp: evaluation.requiresFollowUp,
      followUpDueDate,
      version: 1,
      createdAt: new Date().toISOString(),
      syncStatus: effectiveOffline ? 'pending' : 'synced',
    };

    let createdReferralId: string | undefined;
    const reasonSummary =
      evaluation.flaggedReasons.map((r) => `${r.titleEn} (${r.observedValue})`).join('; ') ||
      'Referred for medical officer evaluation';

    if (effectiveOffline) {
      setScreenings((prev) => [newScreeningRecord, ...prev]);
      const newFollowUp: FollowUpRecord = {
        followUpId: `FUP-${payload.screeningId.replace('SCR-', '')}`,
        patientId: payload.patientId,
        patientName: patientObj?.fullName || payload.patientId,
        patientVillage: patientObj?.village || 'Rampur',
        screeningId: payload.screeningId,
        referralId: null,
        status: 'pending',
        scheduledDate: followUpDueDate,
        completedDate: null,
        notes:
          payload.customFollowUpNotes ||
          `Follow-up scheduled from screening (${evaluation.resultCategory}).`,
        recordedByUid: currentUser.uid,
        recordedByRole: currentUser.role,
        version: 1,
        updatedAt: new Date().toISOString(),
        syncStatus: 'pending',
      };
      setFollowUps((prev) => [newFollowUp, ...prev]);

      if (offlineDb && storageSafety.isSupported && !untrustedDeviceMode) {
        await offlineDb.screenings.put(newScreeningRecord);
        await offlineDb.followUps.put(newFollowUp);
      }

      const { queued: queuedScr } = await enqueueOfflineMutation(
        {
          syncEventId: `SYNC-SCR-${payload.screeningId}`,
          entityType: 'screening',
          entityId: payload.screeningId,
          action: 'record_screening',
          payload: {
            ...newScreeningRecord,
          },
        },
        syncQueue
      );

      let nextQueue = [
        ...syncQueue.filter((i) => i.syncEventId !== queuedScr.syncEventId),
        queuedScr,
      ];

      if (payload.createReferralImmediately) {
        createdReferralId = `REF-PHC-${Math.floor(5010 + Math.random() * 4900)}`;
        const dupCheck = detectDuplicateReferral(referrals, {
          referralId: createdReferralId,
          screeningId: payload.screeningId,
        });
        if (!dupCheck.isDuplicate) {
          const offlineReferral: ReferralRecord = {
            referralId: createdReferralId,
            patientId: payload.patientId,
            patientName: patientObj?.fullName || payload.patientId,
            patientAge: patientObj?.ageYears,
            patientSex: patientObj?.sex,
            patientVillage: patientObj?.village || 'Rampur',
            screeningId: payload.screeningId,
            priority: evaluation.resultCategory,
            reasonForReferral: reasonSummary,
            destinationFacility: payload.referralDestination,
            status: 'pending',
            assignedProfessional: 'Dr. Rajesh Verma (MO-PHC)',
            doctorNotes: '',
            followUpPlan: '',
            unableReason: '',
            createdByUid: currentUser.uid,
            createdDate: payload.screeningDate,
            updatedDate: payload.screeningDate,
            version: 1,
            isSimulated: true,
            syncStatus: 'pending',
          };
          setReferrals((prev) => [offlineReferral, ...prev]);
          if (offlineDb && storageSafety.isSupported && !untrustedDeviceMode) {
            await offlineDb.referrals.put(offlineReferral);
          }

          const { queued: queuedRef } = await enqueueOfflineMutation(
            {
              syncEventId: `SYNC-REF-${createdReferralId}`,
              entityType: 'referral',
              entityId: createdReferralId,
              action: 'create_referral',
              payload: {
                referralId: createdReferralId,
                patientId: payload.patientId,
                screeningId: payload.screeningId,
                priority: evaluation.resultCategory,
                reasonForReferral: reasonSummary,
                destinationFacility: payload.referralDestination,
                createdDate: payload.screeningDate,
              },
            },
            nextQueue
          );
          nextQueue = [
            ...nextQueue.filter((i) => i.syncEventId !== queuedRef.syncEventId),
            queuedRef,
          ];
        }
      }

      setSyncQueue(nextQueue);
      return {
        ok: true,
        screeningId: payload.screeningId,
        referralId: createdReferralId,
        evaluation,
        message: 'Saved screening & follow-up offline. Will synchronize when online.',
      };
    }

    // Online path: save to Cloud SQL
    const res = await fetch('/api/workspace', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        action: 'record_screening',
        payload: {
          ...newScreeningRecord,
        },
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok || !data.serverConfirmed) {
      return {
        ok: false,
        message: data.error || 'Failed to save screening on server.',
      };
    }

    if (payload.createReferralImmediately) {
      createdReferralId = `REF-PHC-${Math.floor(5010 + Math.random() * 4900)}`;
      const refRes = await fetch('/api/workspace', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          action: 'create_referral',
          payload: {
            referralId: createdReferralId,
            patientId: payload.patientId,
            screeningId: payload.screeningId,
            priority: evaluation.resultCategory,
            reasonForReferral: reasonSummary,
            destinationFacility: payload.referralDestination,
            createdDate: payload.screeningDate,
          },
        }),
      });
      const refData = await refRes.json();
      if (refData.referralId) {
        createdReferralId = refData.referralId;
      }
    }

    await fetchWorkspaceFromServer();
    return {
      ok: true,
      screeningId: payload.screeningId,
      referralId: createdReferralId,
      evaluation,
      message: createdReferralId
        ? `Screening ${payload.screeningId} and Referral ${createdReferralId} saved.`
        : `Screening ${payload.screeningId} saved successfully.`,
    };
  };

  const handleCreateReferralFromScreening = async (screening: ScreeningRecord) => {
    const newRefId = `REF-PHC-${Math.floor(5010 + Math.random() * 4900)}`;
    const dup = detectDuplicateReferral(referrals, {
      referralId: newRefId,
      screeningId: screening.screeningId,
    });
    if (dup.isDuplicate) {
      setBannerNotice(dup.reason || 'A referral already exists for this screening.');
      return;
    }

    const reasonSummary =
      screening.flaggedReasons.map((r) => `${r.titleEn} (${r.observedValue})`).join('; ') ||
      'Referred for PHC medical officer review';

    if (effectiveOffline) {
      const offlineRef: ReferralRecord = {
        referralId: newRefId,
        patientId: screening.patientId,
        patientName: screening.patientName,
        patientVillage: screening.patientVillage,
        screeningId: screening.screeningId,
        priority: screening.resultCategory,
        reasonForReferral: reasonSummary,
        destinationFacility: 'Simulated PHC Rampur (Demo)',
        status: 'pending',
        assignedProfessional: 'Dr. Rajesh Verma (MO-PHC)',
        doctorNotes: '',
        followUpPlan: '',
        unableReason: '',
        createdByUid: currentUser.uid,
        createdDate: new Date().toISOString().slice(0, 10),
        updatedDate: new Date().toISOString().slice(0, 10),
        version: 1,
        isSimulated: true,
        syncStatus: 'pending',
      };
      setReferrals((prev) => [offlineRef, ...prev]);
      const { queued } = await enqueueOfflineMutation(
        {
          syncEventId: `SYNC-REF-${newRefId}`,
          entityType: 'referral',
          entityId: newRefId,
          action: 'create_referral',
          payload: {
            referralId: newRefId,
            patientId: screening.patientId,
            screeningId: screening.screeningId,
            priority: screening.resultCategory,
            reasonForReferral: reasonSummary,
            destinationFacility: 'Simulated PHC Rampur (Demo)',
            createdDate: offlineRef.createdDate,
          },
        },
        syncQueue
      );
      setSyncQueue((prev) => [
        ...prev.filter((i) => i.syncEventId !== queued.syncEventId),
        queued,
      ]);
      setBannerNotice(`Queued referral ${newRefId} offline.`);
      return;
    }

    const res = await fetch('/api/workspace', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        action: 'create_referral',
        payload: {
          referralId: newRefId,
          patientId: screening.patientId,
          screeningId: screening.screeningId,
          priority: screening.resultCategory,
          reasonForReferral: reasonSummary,
          destinationFacility: 'Simulated PHC Rampur (Demo)',
          createdDate: new Date().toISOString().slice(0, 10),
        },
      }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      await fetchWorkspaceFromServer();
      setBannerNotice(`Referral ${data.referralId} created.`);
    }
  };

  const handleUpdateReferral = async (params: {
    referralId: string;
    status: ReferralStatus;
    assignedProfessional: string;
    doctorNotes: string;
    followUpPlan: string;
    unableReason: string;
    expectedVersion: number;
    forceResolveConflict?: boolean;
  }): Promise<{ ok: boolean; conflict?: boolean; serverRecord?: ReferralRecord; error?: string }> => {
    if (effectiveOffline) {
      setReferrals((prev) =>
        prev.map((r) =>
          r.referralId === params.referralId
            ? {
                ...r,
                status: params.status,
                assignedProfessional: params.assignedProfessional,
                doctorNotes: params.doctorNotes,
                followUpPlan: params.followUpPlan,
                unableReason: params.unableReason,
                syncStatus: 'pending',
              }
            : r
        )
      );
      const { queued } = await enqueueOfflineMutation(
        {
          syncEventId: `SYNC-UPD-REF-${params.referralId}`,
          entityType: 'referral',
          entityId: params.referralId,
          action: 'update_referral',
          payload: params,
        },
        syncQueue
      );
      setSyncQueue((prev) => [
        ...prev.filter((i) => i.syncEventId !== queued.syncEventId),
        queued,
      ]);
      return { ok: true };
    }

    const res = await fetch('/api/workspace', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        action: 'update_referral',
        payload: params,
      }),
    });
    const data = await res.json();
    if (res.status === 409 || data.conflict) {
      return {
        ok: false,
        conflict: true,
        serverRecord: data.serverRecord,
        error: data.error,
      };
    }
    if (res.ok && data.ok && data.serverConfirmed) {
      await fetchWorkspaceFromServer();
      return { ok: true };
    }
    return { ok: false, error: data.error || 'Failed to update referral' };
  };

  const handleUpdateFollowUp = async (params: {
    followUpId: string;
    status: FollowUpStatus;
    notes: string;
    expectedVersion: number;
  }): Promise<{ ok: boolean; message: string }> => {
    if (effectiveOffline) {
      setFollowUps((prev) =>
        prev.map((f) =>
          f.followUpId === params.followUpId
            ? {
                ...f,
                status: params.status,
                notes: params.notes,
                completedDate:
                  params.status === 'completed' ? new Date().toISOString().slice(0, 10) : null,
                syncStatus: 'pending',
              }
            : f
        )
      );
      const { queued } = await enqueueOfflineMutation(
        {
          syncEventId: `SYNC-FUP-${params.followUpId}`,
          entityType: 'follow_up',
          entityId: params.followUpId,
          action: 'update_followup',
          payload: params,
        },
        syncQueue
      );
      setSyncQueue((prev) => [
        ...prev.filter((i) => i.syncEventId !== queued.syncEventId),
        queued,
      ]);
      return {
        ok: true,
        message: `Follow-up ${params.followUpId} saved offline.`,
      };
    }

    const res = await fetch('/api/workspace', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        action: 'update_followup',
        payload: params,
      }),
    });
    const data = await res.json();
    if (res.ok && data.ok && data.serverConfirmed) {
      await fetchWorkspaceFromServer();
      return {
        ok: true,
        message: `Follow-up ${params.followUpId} marked completed.`,
      };
    }
    return {
      ok: false,
      message: data.error || 'Failed to update follow-up.',
    };
  };

  const handleTestUnauthorizedDoctorAction = async (): Promise<string> => {
    const res = await fetch('/api/workspace', {
      method: 'POST',
      headers: getAuthHeaders('health_worker'),
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

  // Inspected screening/referral objects for the modal
  const inspectedScreening = useMemo(
    () => screenings.find((s) => s.screeningId === inspectedScreeningId),
    [screenings, inspectedScreeningId]
  );
  const inspectedPatient = useMemo(
    () =>
      inspectedScreening
        ? patients.find((p) => p.patientId === inspectedScreening.patientId)
        : undefined,
    [patients, inspectedScreening]
  );
  const inspectedReferral = useMemo(
    () =>
      inspectedScreening
        ? referrals.find((r) => r.screeningId === inspectedScreening.screeningId)
        : undefined,
    [referrals, inspectedScreening]
  );
  const inspectedPatientScreenings = useMemo(
    () =>
      inspectedScreening
        ? screenings.filter((s) => s.patientId === inspectedScreening.patientId)
        : [],
    [screenings, inspectedScreening]
  );
  const inspectedPatientFollowUps = useMemo(
    () =>
      inspectedScreening
        ? followUps.filter((f) => f.patientId === inspectedScreening.patientId)
        : [],
    [followUps, inspectedScreening]
  );

  // Session Lock Overlay
  if (isSessionLocked) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl bg-white p-6 border border-slate-200 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-800">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">Session Locked</h1>
              <p className="text-xs text-slate-500">
                Patient health records are hidden while locked.
              </p>
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (unlockPin === '1234' || unlockPin.trim().length >= 4) {
                setIsSessionLocked(false);
                setUnlockPin('');
                setUnlockError('');
              } else {
                setUnlockError('Enter a 4-digit PIN (Demo PIN: 1234)');
              }
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Enter PIN (Demo PIN: 1234)
              </label>
              <input
                type="password"
                maxLength={6}
                value={unlockPin}
                onChange={(e) => setUnlockPin(e.target.value)}
                placeholder="1234"
                className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-base font-mono text-slate-900"
              />
              {unlockError && <p className="text-xs text-red-600 mt-1">{unlockError}</p>}
            </div>

            <button
              type="submit"
              className="w-full min-h-[44px] rounded-lg bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800"
            >
              Unlock Session
            </button>
          </form>
        </div>
      </div>
    );
  }

  const pendingSyncItemsCount = syncQueue.filter(
    (q) => q.status === 'pending' || q.status === 'failed' || q.status === 'conflict'
  ).length;
  const hasSyncFailed = syncQueue.some((q) => q.status === 'failed' || q.status === 'conflict');

  const renderConnectionStatusBadge = () => {
    if (isSyncing) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-teal-50 border border-teal-200 text-teal-800 text-xs font-semibold">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-teal-700" />
          <span>{labels.syncingStatus}</span>
        </span>
      );
    }
    if (effectiveOffline) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
          <WifiOff className="w-3.5 h-3.5 text-amber-600" />
          <span>
            {labels.offlineStatus}
            {pendingSyncItemsCount > 0 ? ` (${pendingSyncItemsCount})` : ''}
          </span>
        </span>
      );
    }
    if (hasSyncFailed) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-50 border border-red-200 text-red-800 text-xs font-semibold">
          <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
          <span>
            {labels.syncFailedStatus} ({pendingSyncItemsCount})
          </span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
        <Wifi className="w-3.5 h-3.5 text-emerald-600" />
        <span>
          {labels.onlineStatus}
          {pendingSyncItemsCount > 0 ? ` (${pendingSyncItemsCount} unsynced)` : ''}
        </span>
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col md:flex-row">
      {/* =====================================================================
          DESKTOP COMPACT SIDEBAR NAVIGATION (Single Navigation System)
         ===================================================================== */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-white border-r border-slate-200 z-30">
        {/* Brand Header */}
        <div className="px-5 py-4 border-b border-slate-200">
          <button
            type="button"
            onClick={() => {
              setMainSection('worker');
              setWorkerSubTab('overview');
            }}
            className="text-left block"
          >
            <span className="text-lg font-bold tracking-tight text-teal-800 block">
              SwasthyaSetu AI
            </span>
            <span className="text-xs text-slate-500 block mt-0.5">{labels.appSubtitle}</span>
          </button>
        </div>
        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {/* Medical Officer Portal: Visible ONLY to Doctor */}
          {activeRole === 'doctor' && (
            <div className="pb-3 mb-3 border-b border-slate-200">
              <p className="px-3 text-[11px] font-bold uppercase tracking-wider text-teal-800 mb-1.5 flex items-center gap-1.5">
                <Stethoscope className="w-3.5 h-3.5 text-teal-700" />
                <span>Doctor Portal</span>
              </p>
              <button
                type="button"
                onClick={() => setMainSection('phc')}
                className={`w-full min-h-[44px] px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors ${
                  mainSection === 'phc'
                    ? 'bg-teal-700 text-white font-semibold shadow-xs'
                    : 'text-teal-900 bg-teal-50/70 hover:bg-teal-100/70 font-semibold'
                }`}
              >
                <Stethoscope className="w-4 h-4 shrink-0" />
                <span>{labels.navPhcDashboard}</span>
              </button>
            </div>
          )}

          {activeRole === 'doctor' && (
            <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1 pt-0.5">
              ASHA Field Operations
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              setMainSection('worker');
              setWorkerSubTab('overview');
            }}
            className={`w-full min-h-[44px] px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors ${
              mainSection === 'worker' && workerSubTab === 'overview'
                ? 'bg-teal-50 text-teal-800 font-semibold'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Home className="w-4 h-4 shrink-0" />
            <span>{labels.navHome}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMainSection('worker');
              setWorkerSubTab('register');
            }}
            className={`w-full min-h-[44px] px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors ${
              mainSection === 'worker' && workerSubTab === 'register'
                ? 'bg-teal-50 text-teal-800 font-semibold'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Users className="w-4 h-4 shrink-0" />
            <span>{labels.navPatients}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMainSection('worker');
              setWorkerSubTab('screening');
            }}
            className={`w-full min-h-[44px] px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors ${
              mainSection === 'worker' && workerSubTab === 'screening'
                ? 'bg-teal-50 text-teal-800 font-semibold'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <HeartPulse className="w-4 h-4 shrink-0" />
            <span>{labels.navNewScreening}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMainSection('worker');
              setWorkerSubTab('referrals');
            }}
            className={`w-full min-h-[44px] px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors ${
              mainSection === 'worker' && workerSubTab === 'referrals'
                ? 'bg-teal-50 text-teal-800 font-semibold'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Send className="w-4 h-4 shrink-0" />
            <span>{labels.navReferrals}</span>
          </button>

          <button
            type="button"
            onClick={() => setMainSection('offline')}
            className={`w-full min-h-[44px] px-3 py-2.5 rounded-lg text-sm font-medium flex items-center justify-between transition-colors ${
              mainSection === 'offline'
                ? 'bg-teal-50 text-teal-800 font-semibold'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span className="flex items-center gap-3">
              <Settings className="w-4 h-4 shrink-0" />
              <span>{labels.navSettings}</span>
            </span>
            {pendingSyncItemsCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                {pendingSyncItemsCount}
              </span>
            )}
          </button>
        </nav>

        {/* Unobtrusive Status & Role Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/60 space-y-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            {renderConnectionStatusBadge()}
            <button
              type="button"
              onClick={() => setLanguage((prev) => (prev === 'en' ? 'hi' : 'en'))}
              className="min-h-[32px] px-2.5 py-1 rounded-md border border-slate-300 bg-white font-semibold text-slate-700 hover:bg-slate-100 flex items-center gap-1"
            >
              <Globe className="w-3.5 h-3.5 text-teal-700" />
              <span>{language === 'en' ? 'हिंदी' : 'EN'}</span>
            </button>
          </div>

          <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between gap-2">
            <div className="truncate">
              <p className="font-semibold text-slate-900 truncate">
                {activeRole === 'doctor' ? labels.roleDoctor : labels.roleHealthWorker}
              </p>
              <p className="text-slate-500 truncate">{currentUser.fullName}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (activeRole === 'health_worker') {
                  setActiveRole('doctor');
                  setMainSection('phc');
                } else {
                  setActiveRole('health_worker');
                  setMainSection('worker');
                }
              }}
              className="px-2 py-1 rounded border border-slate-300 bg-white text-[11px] font-semibold text-slate-700 hover:bg-slate-100 shrink-0"
              title="Switch Role for Demo"
            >
              Switch
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => setSimulatedOffline((prev) => !prev)}
              className="text-[11px] font-medium text-slate-600 hover:text-slate-900 underline"
            >
              {simulatedOffline ? labels.simulateOnlineBtn : labels.simulateOfflineBtn}
            </button>

            {firebaseUser ? (
              <button
                type="button"
                onClick={() => signOut(auth)}
                className="text-[11px] font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1"
              >
                <LogOut className="w-3 h-3" />
                <span>Sign Out</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await signInWithPopup(auth, googleAuthProvider);
                  } catch {
                    // Popup closed
                  }
                }}
                className="text-[11px] font-medium text-teal-800 hover:underline flex items-center gap-1"
              >
                <LogIn className="w-3 h-3" />
                <span>Sign In</span>
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* =====================================================================
          MOBILE COMPACT TOP BAR (Shown only on small screens)
         ===================================================================== */}
      <header className="md:hidden sticky top-0 z-30 bg-white border-b border-slate-200 px-4 py-2.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setMainSection('worker');
            setWorkerSubTab('overview');
          }}
          className="text-base font-bold text-teal-800 truncate"
        >
          SwasthyaSetu AI
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          {renderConnectionStatusBadge()}

          {/* Doctor mobile toggle: Only visible to Doctor */}
          {activeRole === 'doctor' && (
            <button
              type="button"
              onClick={() => {
                if (mainSection === 'phc') {
                  setMainSection('worker');
                } else {
                  setMainSection('phc');
                }
              }}
              className={`min-h-[34px] px-2.5 py-1 rounded-md border text-xs font-semibold ${
                mainSection === 'phc'
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'bg-white text-slate-800 border-slate-300'
              }`}
            >
              {mainSection === 'phc' ? 'ASHA Panel' : 'Doctor Panel'}
            </button>
          )}

          <button
            type="button"
            onClick={() => setLanguage((prev) => (prev === 'en' ? 'hi' : 'en'))}
            className="min-h-[34px] px-2.5 py-1 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-800"
          >
            {language === 'en' ? 'हिंदी' : 'EN'}
          </button>
        </div>
      </header>

      {/* =====================================================================
          MAIN WORKSPACE CONTENT AREA
         ===================================================================== */}
      <div className="flex-1 md:pl-64 pb-20 md:pb-10">
        <main id="top" className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
          {/* Unsynced Offline Queue Notice Banner (Only when unsynced records exist) */}
          {pendingSyncItemsCount > 0 && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-3">
              <span>
                <strong>{pendingSyncItemsCount} record(s) waiting to sync.</strong>{' '}
                {effectiveOffline
                  ? 'Stored safely in device IndexedDB while offline.'
                  : 'Connection restored — ready to synchronize.'}
              </span>
              {!effectiveOffline && (
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={handleSynchronizeQueue}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg bg-teal-700 text-white font-semibold hover:bg-teal-800"
                >
                  {isSyncing ? 'Syncing...' : 'Sync Now'}
                </button>
              )}
            </div>
          )}

          {bannerNotice && (
            <div className="p-3.5 rounded-xl bg-teal-50 border border-teal-200 text-xs font-medium text-teal-950 flex items-center justify-between gap-3">
              <span>{bannerNotice}</span>
              <button
                type="button"
                onClick={() => setBannerNotice(null)}
                className="text-teal-800 font-bold hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {initialLoading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="h-24 rounded-xl bg-white border border-slate-200 animate-pulse p-4"
                  />
                ))}
              </div>
              <div className="h-72 rounded-xl bg-white border border-slate-200 animate-pulse p-6" />
            </div>
          ) : (
            <>
              {mainSection === 'worker' && (
                <HealthWorkerView
                  activeSubTab={workerSubTab}
                  onChangeSubTab={setWorkerSubTab}
                  patients={patients}
                  screenings={screenings}
                  referrals={referrals}
                  followUps={followUps}
                  language={language}
                  isOffline={effectiveOffline}
                  untrustedDeviceMode={untrustedDeviceMode}
                  onRegisterPatient={handleRegisterPatient}
                  onSaveScreening={handleSaveScreening}
                  onCreateReferralFromExisting={async (scr) => {
                    await handleCreateReferralFromScreening(scr);
                    return { ok: true, message: 'Referral created' };
                  }}
                  onUpdateFollowUp={handleUpdateFollowUp}
                  onOpenScreeningDetail={(scr) => setInspectedScreeningId(scr.screeningId)}
                />
              )}

              {mainSection === 'phc' && (
                activeRole === 'doctor' ? (
                  <PhcDoctorDashboard
                    currentUserRole={currentUser.role}
                    language={language}
                    metrics={liveMetrics}
                    referrals={referrals}
                    screenings={screenings}
                    onSwitchToDoctorRole={() => setActiveRole('doctor')}
                    onTestUnauthorizedDoctorAction={handleTestUnauthorizedDoctorAction}
                    onOpenReferralSummary={(ref) => setInspectedScreeningId(ref.screeningId)}
                    onQuickUpdateReferralStatus={async (ref, nextStatus) => {
                      await handleUpdateReferral({
                        referralId: ref.referralId,
                        status: nextStatus,
                        assignedProfessional: ref.assignedProfessional || currentUser.fullName,
                        doctorNotes: ref.doctorNotes,
                        followUpPlan: ref.followUpPlan,
                        unableReason: ref.unableReason,
                        expectedVersion: ref.version,
                      });
                    }}
                  />
                ) : (
                  <div className="bg-white rounded-xl border border-red-200 p-8 text-center space-y-3">
                    <p className="text-sm font-bold text-red-700">Access Restricted</p>
                    <p className="text-xs text-slate-600">
                      The PHC Doctor dashboard is only accessible to authorized medical officers.
                    </p>
                    <button
                      type="button"
                      onClick={() => setMainSection('worker')}
                      className="min-h-[40px] px-4 py-2 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800"
                    >
                      Return to ASHA Worker Portal
                    </button>
                  </div>
                )
              )}

              {mainSection === 'offline' && (
                <OfflinePrivacyView
                  isOffline={effectiveOffline}
                  simulatedOffline={simulatedOffline}
                  onToggleSimulatedOffline={() => setSimulatedOffline((prev) => !prev)}
                  activeRole={activeRole}
                  onChangeRole={(r) => {
                    setActiveRole(r);
                    if (r === 'doctor') {
                      setMainSection('phc');
                    } else {
                      setMainSection('worker');
                    }
                  }}
                  onChangeLanguage={setLanguage}
                  isSyncing={isSyncing}
                  storageSafety={storageSafety}
                  untrustedDeviceMode={untrustedDeviceMode}
                  onToggleUntrustedDeviceMode={setUntrustedDeviceMode}
                  syncQueue={syncQueue}
                  auditLogs={auditLogs}
                  language={language}
                  onTriggerSyncNow={handleSynchronizeQueue}
                  onResolveQueueConflict={async (item, resolution) => {
                    if (resolution === 'keep_server') {
                      const updated = syncQueue.filter((q) => q.syncEventId !== item.syncEventId);
                      setSyncQueue(updated);
                      if (offlineDb) {
                        await offlineDb.syncQueue.delete(item.syncEventId);
                      }
                      await fetchWorkspaceFromServer();
                    } else {
                      const forcedPayload = {
                        ...item.payload,
                        forceResolveConflict: true,
                      };
                      await fetch('/api/workspace', {
                        method: 'POST',
                        headers: getAuthHeaders('doctor'),
                        body: JSON.stringify({
                          action: item.action,
                          payload: forcedPayload,
                          syncEventId: item.syncEventId,
                        }),
                      });
                      const updated = syncQueue.map((q) =>
                        q.syncEventId === item.syncEventId
                          ? { ...q, status: 'synced' as const, lastError: undefined }
                          : q
                      );
                      setSyncQueue(updated);
                      await fetchWorkspaceFromServer();
                    }
                  }}
                  onPurgeLocalRecords={async () => {
                    const res = await purgeLocalRecordsSafely();
                    if (res.blockedUnsyncedCount === 0) {
                      setSyncQueue([]);
                    }
                    return res;
                  }}
                  onLockSession={() => setIsSessionLocked(true)}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Patient & Referral Clinical Summary Modal */}
      <PatientScreeningModal
        key={inspectedScreeningId || 'closed'}
        isOpen={Boolean(inspectedScreeningId)}
        onClose={() => setInspectedScreeningId(null)}
        patient={inspectedPatient}
        screening={inspectedScreening}
        allPatientScreenings={inspectedPatientScreenings}
        referral={inspectedReferral}
        patientFollowUps={inspectedPatientFollowUps}
        currentUserRole={currentUser.role}
        currentUserName={currentUser.fullName}
        language={language}
        onUpdateReferral={handleUpdateReferral}
        onCreateReferralFromScreening={handleCreateReferralFromScreening}
      />

      {/* =====================================================================
          MOBILE FIXED BOTTOM NAVIGATION BAR (5 Main Items: Home, Patients, New Screening, Referrals, Settings)
         ===================================================================== */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 grid grid-cols-5 items-center h-16 px-1">
        <button
          type="button"
          onClick={() => {
            setMainSection('worker');
            setWorkerSubTab('overview');
          }}
          className={`flex flex-col items-center justify-center min-h-[48px] ${
            mainSection === 'worker' && workerSubTab === 'overview'
              ? 'text-teal-700 font-bold'
              : 'text-slate-500'
          }`}
        >
          <Home className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">Home</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setMainSection('worker');
            setWorkerSubTab('register');
          }}
          className={`flex flex-col items-center justify-center min-h-[48px] ${
            mainSection === 'worker' && workerSubTab === 'register'
              ? 'text-teal-700 font-bold'
              : 'text-slate-500'
          }`}
        >
          <Users className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">Patients</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setMainSection('worker');
            setWorkerSubTab('screening');
          }}
          className={`flex flex-col items-center justify-center min-h-[48px] ${
            mainSection === 'worker' && workerSubTab === 'screening'
              ? 'text-teal-700 font-bold'
              : 'text-slate-500'
          }`}
        >
          <HeartPulse className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">Screening</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setMainSection('worker');
            setWorkerSubTab('referrals');
          }}
          className={`flex flex-col items-center justify-center min-h-[48px] ${
            mainSection === 'worker' && workerSubTab === 'referrals'
              ? 'text-teal-700 font-bold'
              : 'text-slate-500'
          }`}
        >
          <Send className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">Referrals</span>
        </button>

        <button
          type="button"
          onClick={() => setMainSection('offline')}
          className={`flex flex-col items-center justify-center min-h-[48px] ${
            mainSection === 'offline' ? 'text-teal-700 font-bold' : 'text-slate-500'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">
            Settings{pendingSyncItemsCount > 0 ? ` (${pendingSyncItemsCount})` : ''}
          </span>
        </button>
      </nav>
    </div>
  );
};
