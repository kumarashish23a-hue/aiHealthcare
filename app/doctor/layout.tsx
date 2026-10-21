'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, ClipboardList, Home, LayoutDashboard } from 'lucide-react';
import { calculateDashboardMetrics } from '@/src/lib/workflow-logic';
import type { AuditLogEntry, LanguageCode } from '@/src/lib/types';
import {
  DOCTOR_AUTH_HEADERS,
  DoctorProvider,
  type DoctorWorkspace,
} from './doctor-context';

const NAV_ITEMS: Array<{ href: string; labelEn: string; labelHi: string; icon: React.ComponentType<{ className?: string }> }> = [
  { href: '/doctor', labelEn: 'Overview', labelHi: 'समीक्षा', icon: LayoutDashboard },
  { href: '/doctor/referrals', labelEn: 'Referral Review', labelHi: 'रेफरल समीक्षा', icon: ClipboardList },
  { href: '/doctor/screenings', labelEn: 'Screenings', labelHi: 'जांच रिकॉर्ड', icon: Activity },
];

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [language, setLanguage] = useState<LanguageCode>('en');
  const [patients, setPatients] = useState<DoctorWorkspace['patients']>([]);
  const [screenings, setScreenings] = useState<DoctorWorkspace['screenings']>([]);
  const [referrals, setReferrals] = useState<DoctorWorkspace['referrals']>([]);
  const [followUps, setFollowUps] = useState<DoctorWorkspace['followUps']>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [actor, setActor] = useState<{ fullName: string; role: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/workspace', { method: 'GET', headers: DOCTOR_AUTH_HEADERS() });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load PHC data');
      setPatients(data.patients || []);
      setScreenings(data.screenings || []);
      setReferrals(data.referrals || []);
      setFollowUps(data.followUps || []);
      setAuditLogs(data.auditLogs || []);
      if (data.actor) setActor({ fullName: data.actor.fullName, role: data.actor.role });
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load PHC data');
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/workspace', { method: 'GET', headers: DOCTOR_AUTH_HEADERS() })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!active) return;
        if (!ok) throw new Error(data.error || 'Failed to load PHC data');
        setPatients(data.patients || []);
        setScreenings(data.screenings || []);
        setReferrals(data.referrals || []);
        setFollowUps(data.followUps || []);
        setAuditLogs(data.auditLogs || []);
        if (data.actor) setActor({ fullName: data.actor.fullName, role: data.actor.role });
        setLoadError(null);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load PHC data');
        setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const metrics = useMemo(
    () => calculateDashboardMetrics(patients, screenings, referrals, followUps),
    [patients, screenings, referrals, followUps]
  );

  const updateReferral = useCallback<DoctorWorkspace['updateReferral']>(async (params) => {
    const res = await fetch('/api/workspace', {
      method: 'POST',
      headers: DOCTOR_AUTH_HEADERS(),
      body: JSON.stringify({ action: 'update_referral', payload: params }),
    });
    return res.json();
  }, []);

  const workspace: DoctorWorkspace = useMemo(
    () => ({
      patients,
      screenings,
      referrals,
      followUps,
      metrics,
      language,
      setLanguage,
      doctorName: actor?.fullName || 'PHC Medical Officer',
      refresh,
      updateReferral,
    }),
    [patients, screenings, referrals, followUps, metrics, language, refresh, updateReferral, actor]
  );

  return (
    <DoctorProvider value={workspace}>
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <Link href="/doctor" className="flex items-center gap-2 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-teal-700 text-white flex items-center justify-center font-bold shrink-0">
                S
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-teal-800 truncate">SwasthyaSetu AI</p>
                <p className="text-[11px] text-slate-500 truncate">
                  PHC Doctor Portal · Sitapur, Uttar Pradesh
                </p>
              </div>
            </Link>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setLanguage(language === 'en' ? 'hi' : 'en')}
                className="min-h-[34px] px-2.5 py-1 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                {language === 'en' ? 'हिंदी' : 'EN'}
              </button>
              <Link
                href="/admin"
                className="min-h-[34px] px-2.5 py-1 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Admin
              </Link>
              <Link
                href="/"
                className="min-h-[34px] px-2.5 py-1 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 flex items-center gap-1.5"
              >
                <Home className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{language === 'hi' ? 'मुख्य ऐप' : 'Main App'}</span>
              </Link>
            </div>
          </div>

          <nav className="max-w-6xl mx-auto px-4 pb-2 flex gap-1.5 overflow-x-auto">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap ${
                    active
                      ? 'bg-teal-700 text-white'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{language === 'hi' ? item.labelHi : item.labelEn}</span>
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="max-w-6xl mx-auto px-4 py-6">
          {loadError && (
            <div className="mb-4 p-3.5 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-900 font-medium flex flex-wrap items-center justify-between gap-2">
              <span>{language === 'hi' ? 'डेटा लोड विफल:' : 'Data load failed:'} {loadError}</span>
              <button
                type="button"
                onClick={() => void refresh()}
                className="min-h-[34px] px-3 py-1.5 rounded-lg bg-white border border-amber-400 text-amber-900 text-xs font-semibold hover:bg-amber-100"
              >
                {language === 'hi' ? 'पुनः प्रयास' : 'Retry'}
              </button>
            </div>
          )}
          {isLoading ? (
            <div className="p-10 text-center text-sm text-slate-500">
              {language === 'hi' ? 'पीएचसी डेटा लोड हो रहा है...' : 'Loading PHC workspace data...'}
            </div>
          ) : actor && actor.role === 'health_worker' ? (
            <div className="p-8 rounded-xl bg-white border border-red-200 text-center space-y-3">
              <p className="text-sm font-bold text-red-700">
                {language === 'hi' ? 'पहुंच प्रतिबंधित' : 'Access Restricted'}
              </p>
              <p className="text-xs text-slate-600">
                {language === 'hi'
                  ? 'डॉक्टर पोर्टल केवल डॉक्टर और PHC व्यवस्थापक खातों के लिए है। भूमिकाएं व्यवस्थापक द्वारा दी जाती हैं — ऐप में भूमिका नहीं बदली जा सकती।'
                  : 'The doctor portal is for doctor and PHC admin accounts only. Roles are assigned by an administrator on your account — they cannot be switched in the app.'}
              </p>
              <Link href="/" className="inline-block min-h-[40px] px-4 py-2 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800">
                {language === 'hi' ? 'मुख्य ऐप पर वापस' : 'Return to Main App'}
              </Link>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </DoctorProvider>
  );
}
