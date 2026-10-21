'use client';

import React, { useState } from 'react';
import {
  ChevronLeft,
  Globe,
  HeartHandshake,
  Plus,
  Stethoscope,
  Trash2,
  UserCircle,
} from 'lucide-react';
import { UI_LABELS } from '@/src/lib/i18n';
import type { LanguageCode, UserRole } from '@/src/lib/types';
import { getSupabaseBrowserClient } from '@/src/lib/supabase-client';
import { buildAuthHeaders, setAccessToken } from '@/src/lib/auth-token';
import ThemeToggle from './ThemeToggle';

export interface LocalProfile {
  uid: string;
  role: UserRole;
  fullName: string;
  phoneLastFour: string;
  facilityName: string;
  createdAt: string;
  lastUsedAt: string;
}

const STORAGE_KEY = 'swasthya-profiles-v1';

function loadProfiles(): LocalProfile[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? (parsed as LocalProfile[]) : [];
  } catch {
    return [];
  }
}

function persistProfiles(list: LocalProfile[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable (private mode): profiles stay session-only
  }
}

interface LoginPanelProps {
  language: LanguageCode;
  onSetLanguage: (lang: LanguageCode) => void;
  onEnter: (profile: LocalProfile) => void;
}

const roleMeta: Array<{
  role: UserRole;
  icon: React.ComponentType<{ className?: string }>;
  titleEn: string;
  titleHi: string;
  descEn: string;
  descHi: string;
  facilityDefaultEn: string;
  facilityDefaultHi: string;
  facilityPlaceholderEn: string;
  facilityPlaceholderHi: string;
}> = [
  {
    role: 'health_worker',
    icon: HeartHandshake,
    titleEn: 'ASHA / Health Worker',
    titleHi: 'आशा / स्वास्थ्य कार्यकर्ता',
    descEn: 'Register patients, record village screenings, manage referrals & follow-up visits.',
    descHi: 'मरीज पंजीकरण, गांव में जांच, रेफरल और फॉलो-अप का प्रबंधन।',
    facilityDefaultEn: 'Sub-Centre Rampur · Sitapur, Uttar Pradesh',
    facilityDefaultHi: 'उप-केंद्र रामपुर · सीतापुर, उत्तर प्रदेश',
    facilityPlaceholderEn: 'e.g., Sub-Centre Rampur, Sitapur (UP)',
    facilityPlaceholderHi: 'उदा., उप-केंद्र रामपुर, सीतापुर (उप्र)',
  },
  {
    role: 'doctor',
    icon: Stethoscope,
    titleEn: 'PHC Doctor / Medical Officer',
    titleHi: 'पीएचसी डॉक्टर / चिकित्सा अधिकारी',
    descEn: 'Review incoming referrals, confirm diagnoses, and manage the PHC dashboard.',
    descHi: 'आने वाले रेफरल की समीक्षा, निदान की पुष्टि और पीएचसी डैशबोर्ड प्रबंधन।',
    facilityDefaultEn: 'PHC Rampur · Sitapur, Uttar Pradesh',
    facilityDefaultHi: 'पीएचसी रामपुर · सीतापुर, उत्तर प्रदेश',
    facilityPlaceholderEn: 'e.g., PHC Rampur, Sitapur (UP)',
    facilityPlaceholderHi: 'उदा., पीएचसी रामपुर, सीतापुर (उप्र)',
  },
];

type Stage = 'role' | 'profiles' | 'details';

export const LoginPanel: React.FC<LoginPanelProps> = ({
  language,
  onSetLanguage,
  onEnter,
}) => {
  const labels = UI_LABELS[language];
  const [stage, setStage] = useState<Stage>('role');
  const [activeRole, setActiveRole] = useState<UserRole>('health_worker');
  const [profiles, setProfiles] = useState<LocalProfile[]>([]);
  const [fullName, setFullName] = useState('');
  const [phoneLastFour, setPhoneLastFour] = useState('');
  const [facilityName, setFacilityName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const supabase = getSupabaseBrowserClient();
  const authConfigured = supabase !== null;

  const meta = roleMeta.find((m) => m.role === activeRole) || roleMeta[0];
  const isHi = language === 'hi';

  const enter = async (profile: LocalProfile) => {
    // Entering a saved profile requires a live Supabase session for the
    // SAME account; otherwise go to the sign-in form.
    if (!supabase) {
      setFormError(
        isHi
          ? 'साइन-इन कॉन्फ़िगर नहीं है — व्यवस्थापक से संपर्क करें।'
          : 'Sign-in is not configured on this install — contact your administrator.'
      );
      setStage('details');
      return;
    }
    const { data } = await supabase.auth.getSession();
    if (!data.session || data.session.user.id !== profile.uid) {
      setFormError(
        isHi
          ? 'इस प्रोफाइल के लिए पहले ईमेल और पासवर्ड से साइन इन करें।'
          : 'Please sign in with this profile’s email and password first.'
      );
      setFullName(profile.fullName);
      setPhoneLastFour(profile.phoneLastFour);
      setFacilityName(profile.facilityName);
      setStage('details');
      return;
    }
    setAccessToken(data.session.access_token);
    const updated = loadProfiles().map((p) =>
      p.uid === profile.uid ? { ...p, lastUsedAt: new Date().toISOString() } : p
    );
    persistProfiles(updated);
    onEnter(profile);
  };

  const openRole = (role: UserRole) => {
    setActiveRole(role);
    setProfiles(loadProfiles().filter((p) => p.role === role));
    setStage('profiles');
  };

  const deleteProfile = (uid: string) => {
    const next = loadProfiles().filter((p) => p.uid !== uid);
    persistProfiles(next);
    setProfiles(next.filter((p) => p.role === activeRole));
  };

  const openDetails = () => {
    setFullName('');
    setPhoneLastFour('');
    setFacilityName('');
    setEmail('');
    setPassword('');
    setFormError(null);
    setStage('details');
  };

  const saveAndEnter = async (mode: 'signin' | 'signup') => {
    const name = fullName.trim();
    const phone = phoneLastFour.trim();
    const facility =
      facilityName.trim() || (isHi ? meta.facilityDefaultHi : meta.facilityDefaultEn);
    const emailClean = email.trim().toLowerCase();

    if (name.length < 2) {
      setFormError(
        isHi ? 'कृपया पूरा नाम दर्ज करें (कम से कम 2 अक्षर)।' : 'Please enter your full name (min 2 characters).'
      );
      return;
    }
    if (!/^\d{4}$/.test(phone)) {
      setFormError(
        isHi ? 'कृपया फोन के अंतिम 4 अंक दर्ज करें।' : 'Please enter the last 4 digits of your phone.'
      );
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) {
      setFormError(isHi ? 'कृपया सही ईमेल दर्ज करें।' : 'Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setFormError(
        isHi ? 'पासवर्ड कम से कम 6 अक्षरों का होना चाहिए।' : 'Password must be at least 6 characters.'
      );
      return;
    }
    if (!supabase) {
      setFormError(
        isHi
          ? 'साइन-इन कॉन्फ़िगर नहीं है (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY गायब) — व्यवस्थापक से संपर्क करें।'
          : 'Sign-in is not configured (missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY) — contact your administrator.'
      );
      return;
    }

    setAuthBusy(true);
    setFormError(null);
    try {
      const authResult =
        mode === 'signup'
          ? await supabase.auth.signUp({ email: emailClean, password })
          : await supabase.auth.signInWithPassword({ email: emailClean, password });
      if (authResult.error) {
        setFormError(authResult.error.message);
        return;
      }
      const session = authResult.data.session;
      const user = authResult.data.user;
      if (!user) {
        setFormError('Sign-in did not return a user. Please try again.');
        return;
      }
      if (!session) {
        // Sign-up with email confirmation enabled: no session yet.
        setFormError(
          isHi
            ? 'खाता बनाया गया। कृपया ईमेल की पुष्टि करें (या व्यवस्थापक से कहें), फिर साइन इन करें।'
            : 'Account created. Please confirm your email (or ask your admin to confirm it), then sign in.'
        );
        return;
      }
      setAccessToken(session.access_token);

      const profile: LocalProfile = {
        uid: user.id,
        role: activeRole,
        fullName: name,
        phoneLastFour: phone,
        facilityName: facility,
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
      };
      const stored = [...loadProfiles().filter((p) => p.uid !== profile.uid), profile];
      persistProfiles(stored);
      setProfiles(stored.filter((p) => p.role === activeRole));
      // Persist to the server store so the /admin panel lists this
      // profile. The server requires payload.uid === the authenticated
      // uid and payload.role === the role ON THE ACCOUNT (set by an
      // admin); a mismatch is reported in the response, not hidden.
      void fetch('/api/workspace', {
        method: 'POST',
        headers: buildAuthHeaders(),
        body: JSON.stringify({ action: 'save_profile', payload: profile }),
      }).catch(() => {
        // Device-local copy remains if the server is unreachable.
      });
      onEnter(profile);
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-xl bg-teal-700 text-white flex items-center justify-center font-bold text-lg shrink-0">
              S
            </span>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-teal-800">
                SwasthyaSetu AI
              </h1>
              <p className="text-xs text-slate-500">{labels.appSubtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onSetLanguage(language === 'en' ? 'hi' : 'en')}
              className="min-h-[36px] px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 flex items-center gap-1.5"
            >
              <Globe className="w-3.5 h-3.5 text-teal-700" />
              <span>{language === 'en' ? 'हिंदी' : 'EN'}</span>
            </button>
            <ThemeToggle />
          </div>
        </div>

        {/* Auth notice: login is disabled for this prototype build */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 space-y-5">
          {stage === 'role' && (
            <div className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-slate-900">
                  {isHi ? 'अपनी भूमिका चुनें' : 'Select your role to continue'}
                </h2>
                <p className="text-xs text-slate-500">
                  {isHi
                    ? 'अपनी भूमिका चुनें, फिर ईमेल और पासवर्ड से साइन इन करें। आपकी भूमिका आपके खाते पर व्यवस्थापक द्वारा तय की जाती है।'
                    : 'Select your role, then sign in with email and password. Your role is set on your account by the PHC admin — it must match the role you pick here.'}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {roleMeta.map((card) => {
                  const Icon = card.icon;
                  return (
                    <button
                      key={card.role}
                      type="button"
                      onClick={() => openRole(card.role)}
                      className="text-left rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col gap-3 hover:border-teal-500 hover:shadow-sm transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="w-9 h-9 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center shrink-0">
                          <Icon className="w-4.5 h-4.5 text-teal-700" />
                        </span>
                        <h3 className="text-sm font-bold text-slate-900">
                          {isHi ? card.titleHi : card.titleEn}
                        </h3>
                      </div>
                      <p className="text-xs text-slate-600 flex-1">
                        {isHi ? card.descHi : card.descEn}
                      </p>
                      <span className="text-xs font-semibold text-teal-800">
                        {isHi ? 'आगे बढ़ें →' : 'Continue →'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {stage === 'profiles' && (
            <div className="space-y-5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStage('role')}
                  className="min-h-[36px] px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 flex items-center gap-1.5"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  {isHi ? 'वापस' : 'Back'}
                </button>
              </div>

              <div className="space-y-1">
                <h2 className="text-lg font-bold text-slate-900">
                  {isHi
                    ? `${meta.titleHi}: सहेजे गए प्रोफाइल`
                    : `${meta.titleEn}: Saved Profiles`}
                </h2>
                <p className="text-xs text-slate-500">
                  {isHi
                    ? 'पहले से साइन इन की गई प्रोफाइल चुनें, या नए खाते से साइन इन करें।'
                    : 'Continue with a profile you signed in with before, or sign in with a new account.'}
                </p>
              </div>

              {profiles.length > 0 && (
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                  {profiles.map((p) => (
                    <div
                      key={p.uid}
                      className="p-3.5 bg-white hover:bg-slate-50 flex items-center justify-between gap-3"
                    >
                      <button
                        type="button"
                        onClick={() => enter(p)}
                        className="text-left flex items-center gap-3 min-w-0 flex-1"
                      >
                        <UserCircle className="w-9 h-9 text-teal-600 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate">{p.fullName}</p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {p.facilityName} · •••• {p.phoneLastFour} ·{' '}
                            {new Date(p.lastUsedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </button>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => enter(p)}
                          className="min-h-[36px] px-3 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800"
                        >
                          {isHi ? 'प्रवेश' : 'Enter'}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteProfile(p.uid)}
                          aria-label="Delete profile"
                          title="Delete profile"
                          className="min-h-[36px] min-w-[36px] px-2 py-1.5 rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50 flex items-center justify-center"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={openDetails}
                className="w-full min-h-[44px] px-4 py-2 rounded-lg border-2 border-dashed border-teal-400 bg-teal-50/40 text-teal-800 text-sm font-semibold hover:bg-teal-50 flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                {isHi ? 'नए खाते से साइन इन करें' : 'Sign in with a new account'}
              </button>
            </div>
          )}

          {stage === 'details' && (
            <div className="space-y-5">
              <button
                type="button"
                onClick={() => setStage('profiles')}
                className="min-h-[36px] px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 flex items-center gap-1.5"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                {isHi ? 'सहेजे गए प्रोफाइल' : 'Saved profiles'}
              </button>

              <div className="space-y-1">
                <h2 className="text-lg font-bold text-slate-900">
                  {isHi ? `${meta.titleHi} — साइन इन` : `${meta.titleEn} — Sign In`}
                </h2>
                <p className="text-xs text-slate-500">
                  {isHi
                    ? 'ईमेल और पासवर्ड से साइन इन करें। नाम, फोन के अंतिम 4 अंक और सुविधा इस डिवाइस पर प्रोफाइल के रूप में सेव होते हैं।'
                    : 'Sign in with your email and password. Your name, phone last-4 and facility are saved on this device as your profile.'}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    {isHi ? 'पूरा नाम (Full Name)' : 'Full Name'}{' '}
                    <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={isHi ? 'उदा., अनीता देवी' : 'e.g., Anita Devi'}
                    className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    {isHi ? 'फोन अंतिम 4 अंक' : 'Phone (Last 4 Digits)'}{' '}
                    <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={phoneLastFour}
                    onChange={(e) => setPhoneLastFour(e.target.value.replace(/\D/g, ''))}
                    placeholder="e.g., 4812"
                    className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono text-slate-900 bg-white"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    {isHi ? 'उप-केंद्र / प्राथमिक स्वास्थ्य केंद्र (Optional)' : 'Sub-Centre / PHC Facility (Optional)'}
                  </label>
                  <input
                    type="text"
                    value={facilityName}
                    onChange={(e) => setFacilityName(e.target.value)}
                    placeholder={isHi ? meta.facilityPlaceholderHi : meta.facilityPlaceholderEn}
                    className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    {isHi ? 'ईमेल (Email)' : 'Email'} <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.org"
                    className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    {isHi ? 'पासवर्ड (Password)' : 'Password'} <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={isHi ? 'कम से कम 6 अक्षर' : 'Min 6 characters'}
                    className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white"
                  />
                </div>
              </div>

              {!authConfigured && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium">
                  {isHi
                    ? 'साइन-इन कॉन्फ़िगर नहीं है: NEXT_PUBLIC_SUPABASE_URL और NEXT_PUBLIC_SUPABASE_ANON_KEY सेट नहीं हैं। व्यवस्थापक से संपर्क करें।'
                    : 'Sign-in is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not set. Contact your administrator.'}
                </div>
              )}

              {formError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs font-medium">
                  {formError}
                </div>
              )}

              <div className="space-y-2">
                <button
                  type="button"
                  disabled={authBusy || !authConfigured}
                  onClick={() => void saveAndEnter('signin')}
                  className="w-full min-h-[48px] px-6 py-3 rounded-lg bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 transition-colors disabled:opacity-50"
                >
                  {authBusy
                    ? isHi
                      ? 'कृपया प्रतीक्षा करें…'
                      : 'Please wait…'
                    : isHi
                      ? 'साइन इन करें और आगे बढ़ें'
                      : 'Sign In & Continue'}
                </button>
                <button
                  type="button"
                  disabled={authBusy || !authConfigured}
                  onClick={() => void saveAndEnter('signup')}
                  className="w-full min-h-[40px] px-6 py-2 rounded-lg border border-teal-700 text-teal-800 bg-white text-xs font-semibold hover:bg-teal-50 transition-colors disabled:opacity-50"
                >
                  {isHi ? 'नया खाता बनाएं' : 'Create a new account'}
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-[11px] text-slate-400">{labels.disclaimerBody}</p>
      </div>
    </div>
  );
};
