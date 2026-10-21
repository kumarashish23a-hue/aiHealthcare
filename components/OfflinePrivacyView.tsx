'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Globe,
  Lock,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { AuditLogEntry, LanguageCode } from '@/src/lib/types';
import { QueuedSyncMutation } from '@/src/lib/offline-db';
import { PWAInstallButton } from './PWAInstallButton';

interface OfflinePrivacyViewProps {
  isOffline: boolean;
  simulatedOffline?: boolean;
  onToggleSimulatedOffline?: () => void;
  onChangeLanguage?: (lang: LanguageCode) => void;
  isSyncing: boolean;
  storageSafety: { isSupported: boolean; isSecureContext: boolean; reason?: string };
  untrustedDeviceMode: boolean;
  onToggleUntrustedDeviceMode: (val: boolean) => void;
  syncQueue: QueuedSyncMutation[];
  auditLogs: AuditLogEntry[];
  language: LanguageCode;
  onTriggerSyncNow: () => Promise<void>;
  onResolveQueueConflict: (
    item: QueuedSyncMutation,
    resolution: 'keep_server' | 'force_client'
  ) => Promise<void>;
  onPurgeLocalRecords: () => Promise<{ deletedCount: number; blockedUnsyncedCount: number }>;
  onLockSession: () => void;
}

export const OfflinePrivacyView: React.FC<OfflinePrivacyViewProps> = ({
  isOffline,
  simulatedOffline = false,
  onToggleSimulatedOffline,
  onChangeLanguage,
  isSyncing,
  storageSafety,
  untrustedDeviceMode,
  onToggleUntrustedDeviceMode,
  syncQueue,
  auditLogs,
  language,
  onTriggerSyncNow,
  onResolveQueueConflict,
  onPurgeLocalRecords,
  onLockSession,
}) => {
  const [purgeMessage, setPurgeMessage] = useState<string | null>(null);

  const pendingCount = syncQueue.filter(
    (q) => q.status === 'pending' || q.status === 'syncing'
  ).length;
  const conflictCount = syncQueue.filter((q) => q.status === 'conflict').length;
  const failedCount = syncQueue.filter((q) => q.status === 'failed').length;
  const syncedCount = syncQueue.filter((q) => q.status === 'synced').length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Page Title */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {language === 'hi'
              ? 'सेटिंग्स, ऑफलाइन सिंक और गोपनीयता (Settings)'
              : 'Settings, Offline Sync & Privacy'}
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            {language === 'hi'
              ? 'भाषा बदलें, ऑफलाइन डेटा सिंक करें, और डिवाइस सुरक्षा प्रबंधित करें।'
              : 'Manage language, user role, offline synchronization queue, and device privacy.'}
          </p>
        </div>
        <PWAInstallButton compact />
      </div>

      {/* General Settings: Language, Role, Offline Simulation & Session Lock */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 space-y-5">
        <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-2">
          {language === 'hi' ? '1. सामान्य सेटिंग्स (General Preferences)' : '1. General preferences'}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Language Selection */}
          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
              <Globe className="w-4 h-4 text-teal-700" />
              <span>Interface Language (भाषा)</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onChangeLanguage?.('en')}
                className={`flex-1 min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  language === 'en'
                    ? 'bg-teal-700 text-white border-teal-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => onChangeLanguage?.('hi')}
                className={`flex-1 min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  language === 'hi'
                    ? 'bg-teal-700 text-white border-teal-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                हिंदी (Hindi)
              </button>
            </div>
          </div>

        </div>

        {/* Network Simulation & Screen Lock */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          {onToggleSimulatedOffline && (
            <button
              type="button"
              onClick={onToggleSimulatedOffline}
              className={`min-h-[42px] px-4 py-2 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-2 ${
                simulatedOffline
                  ? 'bg-amber-600 text-white border-amber-700 hover:bg-amber-700'
                  : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {simulatedOffline ? (
                <>
                  <Wifi className="w-4 h-4" />
                  <span>Reconnect Network (Exit Offline Test)</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-amber-600" />
                  <span>Simulate Offline Mode</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onLockSession}
            className="min-h-[42px] px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors flex items-center gap-2"
          >
            <Lock className="w-4 h-4" />
            <span>Lock Session Screen (PIN)</span>
          </button>
        </div>
      </div>

      {/* Offline Synchronization Queue & Conflict Resolution */}
      <div className="p-5 sm:p-6 rounded-xl bg-white border border-slate-200 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              {isOffline ? (
                <WifiOff className="w-4 h-4 text-amber-600" />
              ) : (
                <Wifi className="w-4 h-4 text-emerald-600" />
              )}
              <span>
                {isOffline
                  ? 'Status: Offline — Saving records locally in IndexedDB'
                  : isSyncing
                    ? 'Status: Syncing with server...'
                    : failedCount > 0 || conflictCount > 0
                      ? 'Status: Sync failed / Conflict requires attention'
                      : 'Status: Online — Connected to Cloud SQL server'}
              </span>
            </div>
            <h2 className="text-base font-bold text-slate-900">
              2. Offline Synchronization Queue
            </h2>
            <p className="text-xs text-slate-500">
              Records are only marked as synchronized after the server confirms success.
            </p>
          </div>

          <button
            type="button"
            disabled={isOffline || isSyncing}
            onClick={onTriggerSyncNow}
            className={`min-h-[44px] px-5 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
              isOffline
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-teal-700 text-white hover:bg-teal-800'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Syncing...' : 'Sync Queue Now'}</span>
          </button>
        </div>

        {/* Simple Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
            <p className="text-xs text-slate-500">Unsynced</p>
            <p className="text-xl font-bold text-amber-700 font-mono tabular-nums">
              {pendingCount}
            </p>
          </div>
          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
            <p className="text-xs text-slate-500">Synced</p>
            <p className="text-xl font-bold text-emerald-700 font-mono tabular-nums">
              {syncedCount}
            </p>
          </div>
          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
            <p className="text-xs text-slate-500">Conflicts</p>
            <p className="text-xl font-bold text-red-700 font-mono tabular-nums">{conflictCount}</p>
          </div>
          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
            <p className="text-xs text-slate-500">Sync Failed</p>
            <p className="text-xl font-bold text-slate-800 font-mono tabular-nums">{failedCount}</p>
          </div>
        </div>

        {/* Sync Queue Items */}
        {syncQueue.length === 0 ? (
          <div className="p-5 rounded-lg bg-slate-50 border border-slate-100 text-center text-xs text-slate-600">
            All records are synchronized. When offline, new patients, screenings, and referrals will appear here until synced.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
            {syncQueue.map((item) => (
              <div
                key={item.syncEventId}
                className="p-3.5 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 font-mono">
                    <span className="font-bold text-slate-900">{item.entityId}</span>
                    <span>·</span>
                    <span className="text-slate-600">{item.action}</span>
                    {item.retryCount > 0 && (
                      <span className="text-slate-400">· Retries: {item.retryCount}</span>
                    )}
                  </div>
                  {item.lastError && <p className="text-red-700 font-medium">{item.lastError}</p>}
                  {item.status === 'conflict' && item.serverConflictRecord && (
                    <div className="mt-2 p-3 rounded-lg bg-amber-50 border border-amber-300 space-y-2">
                      <p className="font-semibold text-amber-950">
                        Conflict detected: Server has a newer version of this record.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => onResolveQueueConflict(item, 'keep_server')}
                          className="min-h-[36px] px-3 py-1 rounded-md bg-white border border-slate-300 text-slate-800 font-semibold"
                        >
                          Keep Server Version
                        </button>
                        <button
                          type="button"
                          onClick={() => onResolveQueueConflict(item, 'force_client')}
                          className="min-h-[36px] px-3 py-1 rounded-md bg-amber-800 text-white font-semibold"
                        >
                          Use My Update
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 font-bold shrink-0">
                  {item.status === 'synced' && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  )}
                  {(item.status === 'conflict' || item.status === 'failed') && (
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                  )}
                  <span
                    className={`uppercase ${
                      item.status === 'synced'
                        ? 'text-emerald-700'
                        : item.status === 'conflict' || item.status === 'failed'
                          ? 'text-red-700'
                          : 'text-amber-700'
                    }`}
                  >
                    {item.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Privacy & Local Device Storage Controls */}
      <div className="p-5 sm:p-6 rounded-xl bg-white border border-slate-200 space-y-4">
        <div className="flex items-center gap-2 text-slate-900">
          <ShieldCheck className="w-5 h-5 text-teal-700" />
          <h2 className="text-base font-bold">3. Privacy & Device Storage Controls</h2>
        </div>

        <p className="text-xs text-slate-600">
          {untrustedDeviceMode
            ? 'Shared Device Mode is active: Patient records are not stored in local IndexedDB on this device.'
            : storageSafety.reason ||
              'Minimal patient demographics and last-4 phone digits are stored locally for offline work. Sensitive API responses are never cached in browser CacheStorage.'}
        </p>

        <label className="min-h-[44px] p-3.5 rounded-lg border border-slate-200 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-50">
          <div className="text-xs">
            <p className="font-semibold text-slate-900">
              Shared / Public Device Mode (Disable Local Offline Storage)
            </p>
            <p className="text-slate-500">
              Prevent saving patient records in IndexedDB when using a borrowed or shared device.
            </p>
          </div>
          <input
            type="checkbox"
            checked={untrustedDeviceMode}
            onChange={(e) => onToggleUntrustedDeviceMode(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-teal-700"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              const res = await onPurgeLocalRecords();
              if (res.blockedUnsyncedCount > 0) {
                setPurgeMessage(
                  `Blocked: ${res.blockedUnsyncedCount} unsynced record(s) are still waiting. Sync with the server before clearing local storage.`
                );
              } else {
                setPurgeMessage(
                  `Cleared ${res.deletedCount} synced local record(s) from IndexedDB.`
                );
              }
            }}
            className="min-h-[42px] px-4 py-2 rounded-lg border border-red-300 bg-white text-red-700 text-xs font-semibold hover:bg-red-50 transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            <span>Clear Synced Local Records</span>
          </button>
        </div>

        {purgeMessage && (
          <div className="p-3 rounded-lg bg-slate-100 border border-slate-200 text-xs text-slate-800 font-medium">
            {purgeMessage}
          </div>
        )}
      </div>

      {/* Collapsible Audit Logs */}
      <details className="bg-white rounded-xl border border-slate-200 p-5">
        <summary className="text-sm font-bold text-slate-900 cursor-pointer flex items-center justify-between select-none">
          <span className="flex items-center gap-2">
            <Database className="w-4 h-4 text-teal-700" />
            <span>Security & Access Audit Log ({auditLogs.length})</span>
          </span>
          <span className="text-xs font-normal text-slate-500">View log</span>
        </summary>
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-200 border border-slate-200 rounded-lg mt-4">
          {auditLogs.map((log) => (
            <div key={log.auditId} className="p-3 text-xs space-y-0.5 bg-white">
              <div className="flex items-center justify-between font-mono text-slate-500">
                <span className="font-bold text-slate-900">{log.action}</span>
                <span>{log.createdAt.slice(0, 19).replace('T', ' ')}</span>
              </div>
              <p className="text-slate-700">{log.summary}</p>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
};
