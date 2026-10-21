'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  CalendarCheck2,
  ClipboardList,
  Home,
  Languages,
  LayoutDashboard,
  ListOrdered,
  MapPin,
  ShieldCheck,
} from 'lucide-react';
import { calculateDashboardMetrics } from '@/src/lib/workflow-logic';
import type { AuditLogEntry, LanguageCode } from '@/src/lib/types';
import {
  DOCTOR_AUTH_HEADERS,
  DoctorProvider,
  type DoctorWorkspace,
} from './doctor-context';

interface NavItem {
  href: string;
  labelEn: string;
  labelHi: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: 'referrals';
}

interface NavSection {
  labelEn: string;
  labelHi: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    labelEn: 'Overview',
    labelHi: 'अवलोकन',
    items: [
      { href: '/doctor', labelEn: 'Dashboard', labelHi: 'डैशबोर्ड', icon: LayoutDashboard },
      { href: '/doctor/referrals', labelEn: 'Referral Review', labelHi: 'रेफरल समीक्षा', icon: ClipboardList, badge: 'referrals' },
      { href: '/doctor/screenings', labelEn: 'Screenings', labelHi: 'जांच रिकॉर्ड', icon: Activity },
    ],
  },
  {
    labelEn: 'Analytics',
    labelHi: 'विश्लेषण',
    items: [
      { href: '/doctor#priority-queue', labelEn: 'Priority Queue', labelHi: 'प्राथमिकता सूची', icon: ListOrdered },
      { href: '/doctor#village-clusters', labelEn: 'Population Health', labelHi: 'जनसंख्या स्वास्थ्य', icon: MapPin },
    ],
  },
  {
    labelEn: 'Operations',
    labelHi: 'संचालन',
    items: [
      { href: '/doctor#follow-ups', labelEn: 'Follow-ups', labelHi: 'फॉलो-अप', icon: CalendarCheck2 },
    ],
  },
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

  const isHi = language === 'hi';
  const pendingReferrals = metrics.referralsAwaitingReview;
  const profileName = actor?.fullName || 'PHC Medical Officer';
  const profileInitials =
    profileName
      .replace(/^Dr\.?\s+/i, '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || 'DR';
  const roleLabel =
    actor?.role === 'phc_admin'
      ? isHi
        ? 'PHC व्यवस्थापक'
        : 'PHC Admin'
      : isHi
        ? 'चिकित्सा अधिकारी'
        : 'Medical Officer';

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = !item.href.includes('#') && pathname === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`relative min-h-[40px] px-3 py-2 rounded-xl text-[13px] font-medium flex items-center gap-2.5 whitespace-nowrap transition-colors ${
          active
            ? 'bg-[#12291F] text-emerald-300'
            : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
        }`}
      >
        {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full bg-emerald-400" />}
        <Icon className="w-4 h-4 shrink-0" />
        <span className="flex-1">{isHi ? item.labelHi : item.labelEn}</span>
        {item.badge === 'referrals' && pendingReferrals > 0 && (
          <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center">
            {pendingReferrals}
          </span>
        )}
      </Link>
    );
  };

  return (
    <DoctorProvider value={workspace}>
      <div className="min-h-screen bg-[#0A0C0E] text-slate-100">
        <div className="flex flex-col lg:flex-row gap-4 p-3 sm:p-4 max-w-[1500px] mx-auto w-full">
          {/* Sidebar (desktop) */}
          <aside className="hidden lg:flex flex-col w-[248px] shrink-0 rounded-3xl border border-white/5 bg-[#101215] p-4 sticky top-4 h-[calc(100vh-2rem)]">
            <Link href="/doctor" className="flex items-center gap-2.5 px-1.5 pb-5 min-w-0">
              <span className="w-10 h-10 rounded-2xl bg-emerald-400/15 border border-emerald-300/20 text-emerald-300 flex items-center justify-center font-bold text-lg shrink-0">
                S
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate">SwasthyaSetu AI</p>
                <p className="text-[11px] text-slate-500 truncate">
                  {isHi ? 'पीएचसी डॉक्टर पोर्टल' : 'PHC Doctor Portal'} · Sitapur
                </p>
              </div>
            </Link>

            <nav className="flex-1 overflow-y-auto space-y-6 pr-0.5">
              {NAV_SECTIONS.map((section) => (
                <div key={section.labelEn} className="space-y-1.5">
                  <p className="px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    {isHi ? section.labelHi : section.labelEn}
                  </p>
                  {section.items.map(renderNavItem)}
                </div>
              ))}
            </nav>

            <div className="pt-4 space-y-1.5 border-t border-white/5">
              <button
                type="button"
                onClick={() => setLanguage(language === 'en' ? 'hi' : 'en')}
                className="w-full min-h-[40px] px-3 py-2 rounded-xl text-[13px] font-medium flex items-center gap-2.5 text-slate-400 hover:bg-white/5 hover:text-slate-100"
              >
                <Languages className="w-4 h-4 shrink-0" />
                <span>{language === 'en' ? 'हिंदी में देखें' : 'View in English'}</span>
              </button>
              <Link
                href="/admin"
                className="min-h-[40px] px-3 py-2 rounded-xl text-[13px] font-medium flex items-center gap-2.5 text-slate-400 hover:bg-white/5 hover:text-slate-100"
              >
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Admin</span>
              </Link>
              <Link
                href="/"
                className="min-h-[40px] px-3 py-2 rounded-xl text-[13px] font-medium flex items-center gap-2.5 text-slate-400 hover:bg-white/5 hover:text-slate-100"
              >
                <Home className="w-4 h-4 shrink-0" />
                <span>{isHi ? 'मुख्य ऐप' : 'Main App'}</span>
              </Link>
              <div className="mt-3 flex items-center gap-2.5 rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-2.5">
                <span className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {profileInitials}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-white truncate">{profileName}</p>
                  <p className="text-[11px] text-slate-500 truncate">{roleLabel}</p>
                </div>
              </div>
            </div>
          </aside>

          {/* Mobile top bar */}
          <div className="lg:hidden rounded-3xl border border-white/5 bg-[#101215] p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Link href="/doctor" className="flex items-center gap-2 min-w-0">
                <span className="w-9 h-9 rounded-xl bg-emerald-400/15 border border-emerald-300/20 text-emerald-300 flex items-center justify-center font-bold shrink-0">
                  S
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">SwasthyaSetu AI</p>
                  <p className="text-[10px] text-slate-500 truncate">
                    {isHi ? 'पीएचसी डॉक्टर पोर्टल' : 'PHC Doctor Portal'} · Sitapur
                  </p>
                </div>
              </Link>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setLanguage(language === 'en' ? 'hi' : 'en')}
                  className="min-h-[34px] px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-xs font-semibold text-slate-200"
                >
                  {language === 'en' ? 'हिंदी' : 'EN'}
                </button>
                <Link
                  href="/"
                  className="min-h-[34px] px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-xs font-semibold text-slate-200 flex items-center"
                >
                  <Home className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
            <nav className="flex gap-1.5 overflow-x-auto pb-0.5">
              {NAV_SECTIONS.flatMap((s) => s.items).map((item) => {
                const Icon = item.icon;
                const active = !item.href.includes('#') && pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`min-h-[34px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap ${
                      active ? 'bg-[#12291F] text-emerald-300' : 'text-slate-300 bg-white/5'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{isHi ? item.labelHi : item.labelEn}</span>
                    {item.badge === 'referrals' && pendingReferrals > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center">
                        {pendingReferrals}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Content */}
          <main className="flex-1 min-w-0 py-1 lg:py-2">
            {loadError && (
              <div className="mb-4 p-3.5 rounded-2xl bg-amber-400/10 border border-amber-300/30 text-xs text-amber-200 font-medium flex flex-wrap items-center justify-between gap-2">
                <span>{isHi ? 'डेटा लोड विफल:' : 'Data load failed:'} {loadError}</span>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="min-h-[34px] px-3 py-1.5 rounded-lg bg-white/5 border border-amber-300/40 text-amber-100 text-xs font-semibold hover:bg-white/10"
                >
                  {isHi ? 'पुनः प्रयास' : 'Retry'}
                </button>
              </div>
            )}
            {isLoading ? (
              <div className="p-10 text-center text-sm text-slate-500">
                {isHi ? 'पीएचसी डेटा लोड हो रहा है...' : 'Loading PHC workspace data...'}
              </div>
            ) : actor && actor.role === 'health_worker' ? (
              <div className="p-8 rounded-3xl bg-[#15171C] border border-red-400/20 text-center space-y-3">
                <p className="text-sm font-bold text-red-400">
                  {isHi ? 'पहुंच प्रतिबंधित' : 'Access Restricted'}
                </p>
                <p className="text-xs text-slate-400">
                  {isHi
                    ? 'डॉक्टर पोर्टल केवल डॉक्टर और PHC व्यवस्थापक खातों के लिए है। भूमिकाएं व्यवस्थापक द्वारा दी जाती हैं — ऐप में भूमिका नहीं बदली जा सकती।'
                    : 'The doctor portal is for doctor and PHC admin accounts only. Roles are assigned by an administrator on your account — they cannot be switched in the app.'}
                </p>
                <Link href="/" className="inline-block min-h-[40px] px-4 py-2 rounded-lg bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-600">
                  {isHi ? 'मुख्य ऐप पर वापस' : 'Return to Main App'}
                </Link>
              </div>
            ) : (
              children
            )}
          </main>
        </div>
      </div>
    </DoctorProvider>
  );
}
