import { offlineDb, QueuedSyncMutation } from './offline-db';

export interface SyncDispatchResult {
  ok: boolean;
  serverConfirmed?: boolean;
  conflict?: boolean;
  serverRecord?: Record<string, unknown>;
  error?: string;
}

export type SyncTransportFn = (mutation: QueuedSyncMutation) => Promise<SyncDispatchResult>;

/**
 * Processes a batch of queued offline mutations sequentially to preserve relational order
 * (e.g. patient registration -> screening record -> referral).
 * Never marks a record as 'synced' unless the server explicitly returns `ok: true` and `serverConfirmed: true`.
 */
export async function processSyncQueue(
  queue: QueuedSyncMutation[],
  transport: SyncTransportFn
): Promise<{
  updatedQueue: QueuedSyncMutation[];
  syncedCount: number;
  failedCount: number;
  conflictCount: number;
}> {
  let syncedCount = 0;
  let failedCount = 0;
  let conflictCount = 0;
  const updatedQueue: QueuedSyncMutation[] = [];

  // Sort chronologically so parent records (patients) sync before child records (screenings/referrals)
  const sorted = [...queue].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const item of sorted) {
    if (item.status === 'synced') {
      updatedQueue.push(item);
      continue;
    }

    const syncingItem: QueuedSyncMutation = {
      ...item,
      status: 'syncing',
      updatedAt: new Date().toISOString(),
    };

    if (offlineDb) {
      await offlineDb.syncQueue.put(syncingItem);
    }

    try {
      const response = await transport(syncingItem);

      if (response.conflict) {
        conflictCount += 1;
        const conflictItem: QueuedSyncMutation = {
          ...syncingItem,
          status: 'conflict',
          lastError: response.error || 'Version conflict with server record',
          serverConflictRecord: response.serverRecord,
          updatedAt: new Date().toISOString(),
        };
        updatedQueue.push(conflictItem);
        if (offlineDb) {
          await offlineDb.syncQueue.put(conflictItem);
        }
      } else if (response.ok && response.serverConfirmed === true) {
        syncedCount += 1;
        const syncedItem: QueuedSyncMutation = {
          ...syncingItem,
          status: 'synced',
          lastError: undefined,
          serverConflictRecord: undefined,
          updatedAt: new Date().toISOString(),
        };
        updatedQueue.push(syncedItem);
        if (offlineDb) {
          await offlineDb.syncQueue.put(syncedItem);
        }
      } else {
        failedCount += 1;
        const failedItem: QueuedSyncMutation = {
          ...syncingItem,
          status: 'failed',
          retryCount: item.retryCount + 1,
          lastError:
            response.error ||
            'Server did not confirm persistence (missing serverConfirmed acknowledgement)',
          updatedAt: new Date().toISOString(),
        };
        updatedQueue.push(failedItem);
        if (offlineDb) {
          await offlineDb.syncQueue.put(failedItem);
        }
      }
    } catch (err: unknown) {
      failedCount += 1;
      const msg = err instanceof Error ? err.message : 'Network error during synchronization';
      const failedItem: QueuedSyncMutation = {
        ...syncingItem,
        status: 'failed',
        retryCount: item.retryCount + 1,
        lastError: msg,
        updatedAt: new Date().toISOString(),
      };
      updatedQueue.push(failedItem);
      if (offlineDb) {
        await offlineDb.syncQueue.put(failedItem);
      }
    }
  }

  return {
    updatedQueue,
    syncedCount,
    failedCount,
    conflictCount,
  };
}
