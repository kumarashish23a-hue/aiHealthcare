import Dexie, { type Table } from 'dexie';
import {
  FollowUpRecord,
  PatientRecord,
  ReferralRecord,
  ScreeningRecord,
} from './types';

export interface QueuedSyncMutation {
  syncEventId: string;
  entityType: 'patient' | 'screening' | 'referral' | 'follow_up';
  entityId: string;
  action:
    | 'register_patient'
    | 'record_screening'
    | 'create_referral'
    | 'update_referral'
    | 'update_followup';
  payload: Record<string, unknown>;
  status: 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';
  retryCount: number;
  lastError?: string;
  serverConflictRecord?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ScreeningDraft {
  draftId: string;
  patientId: string;
  systolicBp: string;
  diastolicBp: string;
  heartRateBpm: string;
  temperatureC: string;
  spo2Percent: string;
  randomBloodGlucoseMgDl: string;
  hemoglobinGDl: string;
  respiratoryRateBpm: string;
  isPregnant: boolean;
  gestationalWeeks: string;
  symptoms: string[];
  symptomDurationDays: number;
  medicalHistoryNotes: string;
  updatedAt: string;
}

export class SwasthyaSetuOfflineDB extends Dexie {
  patients!: Table<PatientRecord, string>;
  screenings!: Table<ScreeningRecord, string>;
  referrals!: Table<ReferralRecord, string>;
  followUps!: Table<FollowUpRecord, string>;
  syncQueue!: Table<QueuedSyncMutation, string>;
  drafts!: Table<ScreeningDraft, string>;

  constructor() {
    super('SwasthyaSetuOfflineDB_v2');
    this.version(1).stores({
      patients: 'patientId, village, syncStatus, createdAt',
      screenings: 'screeningId, patientId, resultCategory, syncStatus, screeningDate',
      referrals: 'referralId, patientId, screeningId, status, syncStatus',
      followUps: 'followUpId, patientId, screeningId, status, syncStatus, scheduledDate',
      syncQueue: 'syncEventId, entityType, entityId, status, createdAt',
      drafts: 'draftId, patientId, updatedAt',
    });
  }
}

export const offlineDb =
  typeof window !== 'undefined' ? new SwasthyaSetuOfflineDB() : null;

export function checkDeviceOfflineStorageSafety(): {
  isSupported: boolean;
  isSecureContext: boolean;
  reason?: string;
} {
  if (typeof window === 'undefined') {
    return { isSupported: false, isSecureContext: true, reason: 'SSR environment' };
  }
  const hasIndexedDB = typeof window.indexedDB !== 'undefined';
  const secure = window.isSecureContext !== false;
  if (!hasIndexedDB) {
    return {
      isSupported: false,
      isSecureContext: secure,
      reason:
        'IndexedDB is disabled or unavailable in this browser. Sensitive patient records will not be persisted locally on this device.',
    };
  }
  if (!secure) {
    return {
      isSupported: false,
      isSecureContext: false,
      reason:
        'Insecure HTTP context detected. Offline persistence of health records is disabled to protect patient privacy.',
    };
  }
  return { isSupported: true, isSecureContext: true };
}

export async function enqueueOfflineMutation(
  mutation: Omit<QueuedSyncMutation, 'status' | 'retryCount' | 'createdAt' | 'updatedAt'>,
  existingQueue?: QueuedSyncMutation[]
): Promise<{ queued: QueuedSyncMutation; deduplicated: boolean }> {
  const now = new Date().toISOString();

  // Check for duplicate pending mutation on the same entityId and action
  if (offlineDb) {
    const allPending = await offlineDb.syncQueue
      .where('entityId')
      .equals(mutation.entityId)
      .toArray();
    const existingSameAction = allPending.find(
      (item) =>
        item.action === mutation.action &&
        (item.status === 'pending' || item.status === 'syncing')
    );

    if (existingSameAction) {
      const updated: QueuedSyncMutation = {
        ...existingSameAction,
        payload: mutation.payload,
        updatedAt: now,
      };
      await offlineDb.syncQueue.put(updated);
      return { queued: updated, deduplicated: true };
    }

    const record: QueuedSyncMutation = {
      ...mutation,
      status: 'pending',
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await offlineDb.syncQueue.put(record);
    return { queued: record, deduplicated: false };
  }

  // Fallback for Node test environments without window.indexedDB
  const found = existingQueue?.find(
    (item) =>
      item.entityId === mutation.entityId &&
      item.action === mutation.action &&
      item.status === 'pending'
  );
  if (found) {
    return {
      queued: { ...found, payload: mutation.payload, updatedAt: now },
      deduplicated: true,
    };
  }

  return {
    queued: {
      ...mutation,
      status: 'pending',
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    },
    deduplicated: false,
  };
}

export async function purgeLocalRecordsSafely(): Promise<{
  deletedCount: number;
  blockedUnsyncedCount: number;
}> {
  if (!offlineDb) return { deletedCount: 0, blockedUnsyncedCount: 0 };

  const pendingItems = await offlineDb.syncQueue
    .filter((q) => q.status === 'pending' || q.status === 'failed' || q.status === 'conflict')
    .toArray();

  if (pendingItems.length > 0) {
    return {
      deletedCount: 0,
      blockedUnsyncedCount: pendingItems.length,
    };
  }

  const pCount = await offlineDb.patients.count();
  const sCount = await offlineDb.screenings.count();
  const rCount = await offlineDb.referrals.count();
  const fCount = await offlineDb.followUps.count();

  await Promise.all([
    offlineDb.patients.clear(),
    offlineDb.screenings.clear(),
    offlineDb.referrals.clear(),
    offlineDb.followUps.clear(),
    offlineDb.syncQueue.clear(),
    offlineDb.drafts.clear(),
  ]);

  return {
    deletedCount: pCount + sCount + rCount + fCount,
    blockedUnsyncedCount: 0,
  };
}
