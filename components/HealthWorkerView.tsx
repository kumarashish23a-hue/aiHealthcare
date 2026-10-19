'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  HeartPulse,
  MapPin,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  CbacInput,
  FollowUpRecord,
  FollowUpStatus,
  LanguageCode,
  PatientRecord,
  ReferralRecord,
  ScreeningCategory,
  ScreeningEvaluationResult,
  ScreeningRecord,
} from '@/src/lib/types';
import {
  formatCategoryLabel,
  formatFollowUpStatus,
  formatReferralStatus,
  KNOWN_CONDITIONS_CATALOG,
  SYMPTOM_CATALOG,
  UI_LABELS,
  VILLAGE_CATALOG,
} from '@/src/lib/i18n';
import { evaluateCbacScore, evaluateScreening, formatAbhaId } from '@/src/lib/screening-engine';
import { offlineDb } from '@/src/lib/offline-db';

interface HealthWorkerViewProps {
  activeSubTab: 'overview' | 'register' | 'screening' | 'referrals';
  onChangeSubTab: (tab: 'overview' | 'register' | 'screening' | 'referrals') => void;
  patients: PatientRecord[];
  screenings: ScreeningRecord[];
  referrals: ReferralRecord[];
  followUps: FollowUpRecord[];
  language: LanguageCode;
  isOffline: boolean;
  untrustedDeviceMode: boolean;
  onRegisterPatient: (payload: {
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
  }) => Promise<{ ok: boolean; message: string; patientId?: string }>;
  onSaveScreening: (payload: {
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
  }) => Promise<{
    ok: boolean;
    message: string;
    screeningId?: string;
    referralId?: string;
    evaluation?: ScreeningEvaluationResult;
  }>;
  onCreateReferralFromExisting: (screening: ScreeningRecord) => Promise<{
    ok: boolean;
    message: string;
  }>;
  onUpdateFollowUp: (params: {
    followUpId: string;
    status: FollowUpStatus;
    notes: string;
    expectedVersion: number;
  }) => Promise<{ ok: boolean; message: string }>;
  onOpenScreeningDetail: (screening: ScreeningRecord) => void;
}

export const HealthWorkerView: React.FC<HealthWorkerViewProps> = ({
  activeSubTab,
  onChangeSubTab,
  patients,
  screenings,
  referrals,
  followUps,
  language,
  onRegisterPatient,
  onSaveScreening,
  onUpdateFollowUp,
  onOpenScreeningDetail,
  untrustedDeviceMode,
}) => {
  const labels = UI_LABELS[language];

  // --- Patients View State (List vs Registration Form) ---
  const [patientDirectorySearch, setPatientDirectorySearch] = useState('');
  const [showRegistrationForm, setShowRegistrationForm] = useState(true);

  // --- Patient Registration Form State (No pre-set clinical data) ---
  const [regId, setRegId] = useState('PAT-RMP-1001');
  const [regName, setRegName] = useState('');
  const [regAge, setRegAge] = useState('');
  const [regSex, setRegSex] = useState<'female' | 'male' | 'other'>('female');
  const [regIsPregnant, setRegIsPregnant] = useState(false);
  const [regVillage, setRegVillage] = useState(VILLAGE_CATALOG[0]);
  const [customVillageInput, setCustomVillageInput] = useState('');
  const [isCustomVillage, setIsCustomVillage] = useState(false);
  const [regBlock] = useState('Sitapur Rural');
  const [regPhone4, setRegPhone4] = useState('');
  const [regConditions, setRegConditions] = useState<string[]>([]);
  const [regConsent, setRegConsent] = useState(false);
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [regFeedback, setRegFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // --- Guided Screening Form State (Clean, empty defaults without pre-set vitals) ---
  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState<string>(
    patients[0]?.patientId || ''
  );
  const [systolicBp, setSystolicBp] = useState<string>('');
  const [diastolicBp, setDiastolicBp] = useState<string>('');
  const [spo2Percent, setSpo2Percent] = useState<string>('');
  const [temperatureC, setTemperatureC] = useState<string>('');
  const [heartRateBpm, setHeartRateBpm] = useState<string>('');
  const [glucoseMgDl, setGlucoseMgDl] = useState<string>('');
  const [hemoglobinGDl, setHemoglobinGDl] = useState<string>('');
  const [respRateBpm, setRespRateBpm] = useState<string>('');
  const [isPregnant, setIsPregnant] = useState<boolean>(false);
  const [gestationalWeeks, setGestationalWeeks] = useState<string>('');
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [customSymptomsList, setCustomSymptomsList] = useState<
    { id: string; labelEn: string; labelHi: string; isRedFlag: boolean }[]
  >([]);
  const [showAddSymptomForm, setShowAddSymptomForm] = useState<boolean>(false);
  const [newSymptomText, setNewSymptomText] = useState<string>('');
  const [newSymptomIsRedFlag, setNewSymptomIsRedFlag] = useState<boolean>(false);
  const [symptomDurationDays, setSymptomDurationDays] = useState<string>('0');
  const [historyNotes, setHistoryNotes] = useState<string>('');
  const [aiNote, setAiNote] = useState<string>('');
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [createReferralChecked, setCreateReferralChecked] = useState<boolean>(true);
  const [referralDestination, setReferralDestination] = useState<string>(
    'Simulated PHC Rampur (Demo)'
  );
  const [customFollowUpDate, setCustomFollowUpDate] = useState<string>('');
  const [customFollowUpNotes, setCustomFollowUpNotes] = useState<string>('');
  const [scrSubmitting, setScrSubmitting] = useState<boolean>(false);
  const [lastSavedSignature, setLastSavedSignature] = useState<string | null>(null);
  const [scrFeedback, setScrFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
    screeningId?: string;
    referralId?: string;
  } | null>(null);

  // --- Follow-up Quick Action State ---
  const [editingFollowUpId, setEditingFollowUpId] = useState<string | null>(null);
  const [followUpNoteInput, setFollowUpNoteInput] = useState<string>('');
  const [followUpActionFeedback, setFollowUpActionFeedback] = useState<string | null>(null);
  const [selectedVillageBeat, setSelectedVillageBeat] = useState<string>('all');

  // --- MoHFW CBAC (Community Based Assessment Checklist) NCD Risk State ---
  const [cbacInput, setCbacInput] = useState<CbacInput>({
    ageScore: 0,
    tobaccoScore: 0,
    alcoholScore: 0,
    waistScore: 0,
    physicalActivityScore: 0,
    familyHistoryScore: 0,
  });

  // --- Bilingual Voice Counseling State (Web Speech API) ---
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  // --- Referrals Filter State ---
  const [referralStatusFilter, setReferralStatusFilter] = useState<string>('all');
  const [referralSearch, setReferralSearch] = useState<string>('');

  const availableVillages = useMemo(() => {
    const set = new Set<string>(VILLAGE_CATALOG);
    for (const p of patients) {
      if (p.village) set.add(p.village);
    }
    return Array.from(set);
  }, [patients]);

  const effectiveSelectedPatientId = useMemo(() => {
    if (patients.length > 0 && !patients.some((p) => p.patientId === selectedPatientId)) {
      return patients[0].patientId;
    }
    return selectedPatientId;
  }, [patients, selectedPatientId]);

  const selectedPatient = useMemo(
    () => patients.find((p) => p.patientId === effectiveSelectedPatientId) || patients[0],
    [patients, effectiveSelectedPatientId]
  );

  const filteredPatientsForSelect = useMemo(() => {
    const q = patientSearchQuery.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(
      (p) =>
        p.fullName.toLowerCase().includes(q) ||
        p.patientId.toLowerCase().includes(q) ||
        p.village.toLowerCase().includes(q)
    );
  }, [patients, patientSearchQuery]);

  const filteredDirectoryPatients = useMemo(() => {
    const q = patientDirectorySearch.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(
      (p) =>
        p.fullName.toLowerCase().includes(q) ||
        p.patientId.toLowerCase().includes(q) ||
        p.village.toLowerCase().includes(q)
    );
  }, [patients, patientDirectorySearch]);

  const currentFormSignature = useMemo(
    () =>
      JSON.stringify([
        effectiveSelectedPatientId,
        systolicBp,
        diastolicBp,
        spo2Percent,
        temperatureC,
        heartRateBpm,
        glucoseMgDl,
        hemoglobinGDl,
        respRateBpm,
        isPregnant,
        gestationalWeeks,
        selectedSymptoms,
        symptomDurationDays,
      ]),
    [
      effectiveSelectedPatientId,
      systolicBp,
      diastolicBp,
      spo2Percent,
      temperatureC,
      heartRateBpm,
      glucoseMgDl,
      hemoglobinGDl,
      respRateBpm,
      isPregnant,
      gestationalWeeks,
      selectedSymptoms,
      symptomDurationDays,
    ]
  );

  const hasSavedCurrentForm = lastSavedSignature === currentFormSignature;

  // Auto-save screening draft to IndexedDB when permitted
  useEffect(() => {
    const dbInstance = offlineDb;
    if (!dbInstance || untrustedDeviceMode || activeSubTab !== 'screening') return;
    const timer = setTimeout(() => {
      dbInstance.drafts
        .put({
          draftId: 'current-asha-draft',
          patientId: effectiveSelectedPatientId,
          systolicBp,
          diastolicBp,
          heartRateBpm,
          temperatureC,
          spo2Percent,
          randomBloodGlucoseMgDl: glucoseMgDl,
          hemoglobinGDl,
          respiratoryRateBpm: respRateBpm,
          isPregnant,
          gestationalWeeks,
          symptoms: selectedSymptoms,
          symptomDurationDays: Number(symptomDurationDays || 0),
          medicalHistoryNotes: historyNotes,
          updatedAt: new Date().toISOString(),
        })
        .catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [
    activeSubTab,
    effectiveSelectedPatientId,
    systolicBp,
    diastolicBp,
    heartRateBpm,
    temperatureC,
    spo2Percent,
    glucoseMgDl,
    hemoglobinGDl,
    respRateBpm,
    isPregnant,
    gestationalWeeks,
    selectedSymptoms,
    symptomDurationDays,
    historyNotes,
    untrustedDeviceMode,
  ]);

  const parseNullableNumber = (val: string): number | null => {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isNaN(num) ? NaN : num;
  };

  const liveCbac = useMemo(() => evaluateCbacScore(cbacInput), [cbacInput]);

  // Live deterministic evaluation preview
  const liveEvaluation: ScreeningEvaluationResult = useMemo(() => {
    return evaluateScreening({
      patientId: effectiveSelectedPatientId,
      systolicBp: parseNullableNumber(systolicBp),
      diastolicBp: parseNullableNumber(diastolicBp),
      heartRateBpm: parseNullableNumber(heartRateBpm),
      temperatureC: parseNullableNumber(temperatureC),
      spo2Percent: parseNullableNumber(spo2Percent),
      randomBloodGlucoseMgDl: parseNullableNumber(glucoseMgDl),
      hemoglobinGDl: parseNullableNumber(hemoglobinGDl),
      respiratoryRateBpm: parseNullableNumber(respRateBpm),
      isPregnant,
      gestationalWeeks: isPregnant ? parseNullableNumber(gestationalWeeks) : null,
      symptoms: selectedSymptoms,
      symptomDurationDays: Number(symptomDurationDays || 0),
      medicalHistoryNotes: historyNotes,
      cbacInput,
    });
  }, [
    effectiveSelectedPatientId,
    systolicBp,
    diastolicBp,
    heartRateBpm,
    temperatureC,
    spo2Percent,
    glucoseMgDl,
    hemoglobinGDl,
    respRateBpm,
    isPregnant,
    gestationalWeeks,
    selectedSymptoms,
    symptomDurationDays,
    historyNotes,
    cbacInput,
  ]);

  const handleToggleVoiceCounseling = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const categoryText = formatCategoryLabel(liveEvaluation.resultCategory, language);
    const reasonsText =
      liveEvaluation.flaggedReasons.length > 0
        ? liveEvaluation.flaggedReasons
            .map((r) => (language === 'hi' ? r.titleHi : r.titleEn))
            .join('. ')
        : language === 'hi'
          ? 'सभी मुख्य जांच माप सामान्य सीमा में हैं।'
          : 'All core measurements are within standard range.';
    const stepsText = liveEvaluation.recommendedNextSteps
      .map((s) => (language === 'hi' ? s.actionHi : s.actionEn))
      .join(' ');
    const fullSpeech =
      language === 'hi'
        ? `स्वास्थ्य जांच परिणाम: ${categoryText}. मुख्य कारण: ${reasonsText}. अगला कदम: ${stepsText}`
        : `Screening status: ${categoryText}. Key findings: ${reasonsText}. Recommended action: ${stepsText}`;

    const utterance = new SpeechSynthesisUtterance(fullSpeech);
    utterance.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
    utterance.rate = 0.95;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const defaultFollowUpDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + (liveEvaluation.suggestedFollowUpDays || 7));
    return d.toISOString().slice(0, 10);
  }, [liveEvaluation.suggestedFollowUpDays]);

  const handleAddCustomSymptom = () => {
    const trimmed = newSymptomText.trim();
    if (!trimmed) return;
    const customId = newSymptomIsRedFlag ? `urgent:${trimmed}` : `custom:${trimmed}`;
    if (!customSymptomsList.some((s) => s.id === customId)) {
      setCustomSymptomsList((prev) => [
        ...prev,
        {
          id: customId,
          labelEn: trimmed,
          labelHi: trimmed,
          isRedFlag: newSymptomIsRedFlag,
        },
      ]);
    }
    if (!selectedSymptoms.includes(customId)) {
      setSelectedSymptoms((prev) => [...prev, customId]);
    }
    setNewSymptomText('');
    setNewSymptomIsRedFlag(false);
    setShowAddSymptomForm(false);
  };

  const handleRequestAiNote = async () => {
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai-explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language,
          screeningInput: {
            patientId: effectiveSelectedPatientId,
            systolicBp: parseNullableNumber(systolicBp),
            diastolicBp: parseNullableNumber(diastolicBp),
            heartRateBpm: parseNullableNumber(heartRateBpm),
            temperatureC: parseNullableNumber(temperatureC),
            spo2Percent: parseNullableNumber(spo2Percent),
            randomBloodGlucoseMgDl: parseNullableNumber(glucoseMgDl),
            hemoglobinGDl: parseNullableNumber(hemoglobinGDl),
            respiratoryRateBpm: parseNullableNumber(respRateBpm),
            isPregnant,
            gestationalWeeks: isPregnant ? parseNullableNumber(gestationalWeeks) : null,
            symptoms: selectedSymptoms,
            symptomDurationDays: Number(symptomDurationDays || 0),
          },
        }),
      });
      const data = await res.json();
      if (data.ok && data.supplementalNote) {
        setAiNote(data.supplementalNote);
      } else {
        setAiNote(
          'Follow the recommended next steps above. Screening rules work completely offline without external AI.'
        );
      }
    } catch {
      setAiNote(
        'Offline mode: Follow the clinician-reviewed action steps above. External AI is not required.'
      );
    } finally {
      setAiLoading(false);
    }
  };

  const handlePatientRegistrationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegFeedback(null);

    if (!regName.trim() || regName.trim().length < 2) {
      setRegFeedback({
        type: 'error',
        text:
          language === 'hi'
            ? 'कृपया मरीज का पूरा नाम दर्ज करें।'
            : 'Please enter the patient’s full name.',
      });
      return;
    }

    if (!regConsent) {
      setRegFeedback({
        type: 'error',
        text:
          language === 'hi'
            ? 'मरीज का रिकॉर्ड सुरक्षित करने से पहले सहमति (Consent) पर टिक करना अनिवार्य है।'
            : 'Patient consent is required before saving the registration.',
      });
      return;
    }

    if (!/^\d{4}$/.test(regPhone4.trim())) {
      setRegFeedback({
        type: 'error',
        text:
          language === 'hi'
            ? 'कृपया फोन नंबर के केवल अंतिम 4 अंक दर्ज करें (उदा. 4812)।'
            : 'Please enter exactly the last 4 digits of the phone number (e.g., 4812).',
      });
      return;
    }

    setRegSubmitting(true);
    try {
      const conditionsToSave = [...regConditions];
      if (regSex === 'female' && regIsPregnant && !conditionsToSave.includes('High_Risk_Pregnancy')) {
        conditionsToSave.push('Pregnant');
      }

      const finalVillage = isCustomVillage
        ? customVillageInput.trim() || regVillage.trim()
        : regVillage.trim();

      if (!finalVillage || finalVillage.length < 2) {
        setRegFeedback({
          type: 'error',
          text:
            language === 'hi'
              ? 'कृपया गांव का नाम चुनें या दर्ज करें।'
              : 'Please select or enter a valid village name.',
        });
        setRegSubmitting(false);
        return;
      }

      const savedPatientId = regId.trim().toUpperCase();
      const res = await onRegisterPatient({
        patientId: savedPatientId,
        fullName: regName.trim(),
        ageYears: Number(regAge),
        sex: regSex,
        village: finalVillage,
        blockName: regBlock.trim(),
        phoneLastFour: regPhone4.trim(),
        consentObtained: regConsent,
        consentTimestamp: new Date().toISOString(),
        knownConditions: conditionsToSave,
      });

      if (res.ok) {
        setSelectedPatientId(savedPatientId);
        if (regSex === 'female' && regIsPregnant) {
          setIsPregnant(true);
        }
        setRegFeedback({
          type: 'success',
          text: res.message,
        });
        setRegName('');
        setRegAge('');
        setRegPhone4('');
        setRegConditions([]);
        setRegIsPregnant(false);
        setRegConsent(false);
        setCustomVillageInput('');
        setIsCustomVillage(false);
        setRegId(`PAT-RMP-${Math.floor(1002 + Math.random() * 8900)}`);
      } else {
        setRegFeedback({
          type: 'error',
          text: res.message,
        });
      }
    } finally {
      setRegSubmitting(false);
    }
  };

  const handleScreeningSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (scrSubmitting || hasSavedCurrentForm) return;
    setScrFeedback(null);

    if (!liveEvaluation.isValid) {
      setScrFeedback({
        type: 'error',
        text: liveEvaluation.validationErrors
          .map((err) => (language === 'hi' ? err.messageHi : err.messageEn))
          .join(' '),
      });
      return;
    }

    setScrSubmitting(true);
    try {
      const newScreeningId = `SCR-2026-${Math.floor(1000 + Math.random() * 8999)}`;
      const shouldCreateReferral =
        createReferralChecked &&
        (liveEvaluation.resultCategory === 'urgent_escalation' ||
          liveEvaluation.resultCategory === 'further_assessment_needed');

      const res = await onSaveScreening({
        screeningId: newScreeningId,
        patientId: effectiveSelectedPatientId,
        screeningDate: new Date().toISOString().slice(0, 10),
        systolicBp: parseNullableNumber(systolicBp),
        diastolicBp: parseNullableNumber(diastolicBp),
        heartRateBpm: parseNullableNumber(heartRateBpm),
        temperatureC: parseNullableNumber(temperatureC),
        spo2Percent: parseNullableNumber(spo2Percent),
        randomBloodGlucoseMgDl: parseNullableNumber(glucoseMgDl),
        hemoglobinGDl: parseNullableNumber(hemoglobinGDl),
        respiratoryRateBpm: parseNullableNumber(respRateBpm),
        isPregnant,
        gestationalWeeks: isPregnant ? parseNullableNumber(gestationalWeeks) : null,
        symptoms: selectedSymptoms,
        symptomDurationDays: Number(symptomDurationDays || 0),
        medicalHistoryNotes: historyNotes,
        aiSupplementalNote: aiNote,
        createReferralImmediately: shouldCreateReferral,
        referralDestination,
        customFollowUpDate: customFollowUpDate || defaultFollowUpDate,
        customFollowUpNotes: customFollowUpNotes.trim(),
      });

      if (res.ok) {
        setLastSavedSignature(currentFormSignature);
        setScrFeedback({
          type: 'success',
          text: res.message,
          screeningId: res.screeningId,
          referralId: res.referralId,
        });
      } else {
        setScrFeedback({
          type: 'error',
          text: res.message,
        });
      }
    } finally {
      setScrSubmitting(false);
    }
  };

  // Follow-up lookup by patientId or screeningId
  const followUpByScreeningId = useMemo(() => {
    return new Map(followUps.map((f) => [f.screeningId, f]));
  }, [followUps]);

  const followUpByPatientId = useMemo(() => {
    const map = new Map<string, FollowUpRecord>();
    for (const f of followUps) {
      if (!map.has(f.patientId) || f.status === 'overdue') {
        map.set(f.patientId, f);
      }
    }
    return map;
  }, [followUps]);

  const pendingFollowUpsList = useMemo(() => {
    return [...followUps]
      .filter((f) => f.status !== 'completed')
      .filter((f) => {
        if (selectedVillageBeat === 'all') return true;
        const pat = patients.find((p) => p.patientId === f.patientId);
        const village = f.patientVillage || pat?.village || 'Rampur';
        return village === selectedVillageBeat;
      })
      .sort((a, b) => {
        if (a.status === 'overdue' && b.status !== 'overdue') return -1;
        if (a.status !== 'overdue' && b.status === 'overdue') return 1;
        return a.scheduledDate.localeCompare(b.scheduledDate);
      });
  }, [followUps, selectedVillageBeat, patients]);

  const beatFilteredPatients = useMemo(() => {
    if (selectedVillageBeat === 'all') return patients;
    return patients.filter((p) => p.village === selectedVillageBeat);
  }, [patients, selectedVillageBeat]);

  const filteredReferrals = useMemo(() => {
    return referrals.filter((r) => {
      const matchesStatus = referralStatusFilter === 'all' || r.status === referralStatusFilter;
      const q = referralSearch.trim().toLowerCase();
      const matchesSearch =
        !q ||
        r.patientId.toLowerCase().includes(q) ||
        (r.patientName || '').toLowerCase().includes(q) ||
        r.referralId.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [referrals, referralStatusFilter, referralSearch]);

  const renderCategoryBadge = (category: ScreeningCategory) => {
    if (category === 'urgent_escalation') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-50 border border-red-200 text-red-800 text-xs font-semibold">
          <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
          <span>{formatCategoryLabel(category, language)}</span>
        </span>
      );
    }
    if (category === 'further_assessment_needed') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
          <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span>{formatCategoryLabel(category, language)}</span>
        </span>
      );
    }
    if (category === 'incomplete_information') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold">
          <ShieldAlert className="w-3.5 h-3.5 text-slate-600 shrink-0" />
          <span>{formatCategoryLabel(category, language)}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        <span>{formatCategoryLabel(category, language)}</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* =====================================================================
          4. HOME DASHBOARD (activeSubTab === 'overview')
         ===================================================================== */}
      {activeSubTab === 'overview' && (
        <div className="space-y-6">
          {/* Top Action Header */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                {language === 'hi' ? 'आशा स्वास्थ्य डैशबोर्ड' : 'ASHA Health Worker Dashboard'}
              </h1>
              <p className="text-sm text-slate-600 mt-0.5">
                {language === 'hi'
                  ? 'मरीज की तलाश करें, स्वास्थ्य जांच शुरू करें, या फॉलो-अप दर्ज करें।'
                  : 'Find a patient, record a new screening, or complete pending home follow-ups.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => onChangeSubTab('screening')}
                className="w-full sm:w-auto min-h-[48px] px-5 py-2.5 rounded-lg bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>{language === 'hi' ? '+ नई जांच (+ New Screening)' : '+ New Screening'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRegistrationForm(true);
                  onChangeSubTab('register');
                }}
                className="w-full sm:w-auto min-h-[48px] px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-800 text-sm font-semibold hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
              >
                <UserPlus className="w-4 h-4 text-teal-700" />
                <span>{language === 'hi' ? 'नया मरीज' : 'Register Patient'}</span>
              </button>
            </div>
          </div>

          {/* 4 Simple Summary Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-medium">
                  {language === 'hi' ? 'कुल मरीज (Total Patients)' : 'Total patients'}
                </span>
                <Users className="w-4 h-4 text-teal-700" />
              </div>
              <p className="text-2xl font-bold text-slate-900 tabular-nums">{patients.length}</p>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-medium">
                  {language === 'hi' ? 'पूर्ण जांच (Screenings)' : 'Screenings completed'}
                </span>
                <HeartPulse className="w-4 h-4 text-teal-700" />
              </div>
              <p className="text-2xl font-bold text-slate-900 tabular-nums">{screenings.length}</p>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-medium">
                  {language === 'hi' ? 'फॉलो-अप बाकी (Follow-ups)' : 'Patients requiring follow-up'}
                </span>
                <Clock className="w-4 h-4 text-amber-600" />
              </div>
              <p className="text-2xl font-bold text-amber-700 tabular-nums">
                {pendingFollowUpsList.length}
              </p>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-medium">
                  {language === 'hi' ? 'लंबित रेफरल (Pending Referrals)' : 'Pending referrals'}
                </span>
                <Send className="w-4 h-4 text-teal-700" />
              </div>
              <p className="text-2xl font-bold text-slate-900 tabular-nums">
                {referrals.filter((r) => r.status !== 'completed').length}
              </p>
            </div>
          </div>

          {/* Daily Village Beat Filter Bar (Inspired by CommCare / CHT Prioritized Task Queue) */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-teal-700 shrink-0" />
              <div>
                <h2 className="text-xs font-bold text-slate-900">
                  {language === 'hi'
                    ? 'दैनिक ग्राम दौरा फ़िल्टर (Daily Village Beat Route)'
                    : 'Daily Village Beat & Home-Visit Filter'}
                </h2>
                <p className="text-xs text-slate-500">
                  {language === 'hi'
                    ? 'एक ही गांव के सभी लंबित फॉलो-अप और मरीजों को एक साथ देखने के लिए गांव चुनें।'
                    : 'Filter patients and due home-visits by village to plan today’s field beat.'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-100 rounded-lg max-h-28 overflow-y-auto">
              {['all', ...availableVillages].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setSelectedVillageBeat(v)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    selectedVillageBeat === v
                      ? 'bg-white text-teal-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {v === 'all' ? (language === 'hi' ? 'सभी गांव (All)' : 'All Villages') : v}
                </button>
              ))}
            </div>
          </div>

          {/* Main Home Lists: Recent Patients, Recent Screenings, Pending Follow-ups */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left 7 Cols: Recent Screening Results & Recent Patients */}
            <div className="lg:col-span-7 space-y-6">
              {/* Recent Screening Results */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-slate-900">
                    {language === 'hi'
                      ? 'हाल के जांच परिणाम (Recent Screening Results)'
                      : 'Recent screening results'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => onChangeSubTab('screening')}
                    className="text-xs font-semibold text-teal-700 hover:underline"
                  >
                    {language === 'hi' ? '+ नई जांच' : '+ New Screening'}
                  </button>
                </div>

                {screenings.length === 0 ? (
                  <p className="text-sm text-slate-500 py-4 text-center">
                    No screenings recorded yet.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                    {screenings.slice(0, 5).map((scr) => (
                      <div
                        key={scr.screeningId}
                        className="p-3.5 bg-white hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-slate-900">
                              {scr.patientName || scr.patientId}
                            </span>
                            <span className="text-xs font-mono text-slate-500">
                              ({scr.patientId})
                            </span>
                            <span className="text-xs text-slate-500">· {scr.screeningDate}</span>
                          </div>
                          <p className="text-xs text-slate-600 font-mono">
                            BP:{' '}
                            {scr.systolicBp != null && scr.diastolicBp != null
                              ? `${scr.systolicBp}/${scr.diastolicBp} mmHg`
                              : 'Missing'}{' '}
                            · SpO2: {scr.spo2Percent != null ? `${scr.spo2Percent}%` : 'Missing'} ·
                            Temp: {scr.temperatureC != null ? `${scr.temperatureC}°C` : 'Missing'}
                          </p>
                          <div className="pt-1">{renderCategoryBadge(scr.resultCategory)}</div>
                        </div>

                        <button
                          type="button"
                          onClick={() => onOpenScreeningDetail(scr)}
                          className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 shrink-0 self-start sm:self-center"
                        >
                          {language === 'hi' ? 'विवरण देखें' : 'View Details'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Patients */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-slate-900">
                    {language === 'hi' ? 'हाल के मरीज (Recent Patients)' : 'Recent patients'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRegistrationForm(false);
                      onChangeSubTab('register');
                    }}
                    className="text-xs font-semibold text-teal-700 hover:underline"
                  >
                    {language === 'hi' ? 'सभी मरीज देखें' : 'View all patients'}
                  </button>
                </div>

                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                  {beatFilteredPatients.length === 0 ? (
                    <div className="p-6 text-center text-slate-500 text-xs">
                      {language === 'hi'
                        ? 'इस गांव में अभी कोई मरीज पंजीकृत नहीं है।'
                        : 'No patients registered for this village beat yet.'}
                    </div>
                  ) : (
                    beatFilteredPatients.slice(0, 5).map((pat) => (
                    <div
                      key={pat.patientId}
                      className="p-3.5 bg-white hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-900">
                          {pat.fullName}{' '}
                          <span className="font-normal text-xs text-slate-500">
                            ({pat.ageYears}y, {pat.sex})
                          </span>
                        </p>
                        <p className="text-xs text-slate-500 font-mono tabular-nums">
                          {pat.patientId} · {pat.village} · ABHA: {formatAbhaId(pat.patientId)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPatientId(pat.patientId);
                          onChangeSubTab('screening');
                        }}
                        className="min-h-[40px] px-3 py-1.5 rounded-lg bg-teal-50 border border-teal-200 text-teal-800 text-xs font-semibold hover:bg-teal-100 shrink-0 self-start sm:self-center flex items-center gap-1.5"
                      >
                        <span>{language === 'hi' ? 'जांच शुरू करें' : 'Start Screening'}</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))) }
                </div>
              </div>
            </div>

            {/* Right 5 Cols: Pending Follow-ups */}
            <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-900">
                  {language === 'hi' ? 'बाकी फॉलो-अप (Pending Follow-ups)' : 'Pending follow-ups'}
                </h2>
                <button
                  type="button"
                  onClick={() => onChangeSubTab('referrals')}
                  className="text-xs font-semibold text-teal-700 hover:underline"
                >
                  {language === 'hi' ? 'सभी रेफरल' : 'All referrals'}
                </button>
              </div>

              {followUpActionFeedback && (
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-medium">
                  {followUpActionFeedback}
                </div>
              )}

              {pendingFollowUpsList.length === 0 ? (
                <div className="p-6 text-center rounded-lg bg-slate-50 border border-slate-100">
                  <p className="text-sm text-slate-600">All scheduled follow-ups are complete.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingFollowUpsList.map((fup) => {
                    const isOverdue = fup.status === 'overdue';
                    return (
                      <div
                        key={fup.followUpId}
                        className={`p-3.5 rounded-lg border space-y-2 ${
                          isOverdue
                            ? 'bg-red-50/40 border-red-200'
                            : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-bold text-slate-900">
                              {fup.patientName || fup.patientId}
                            </p>
                            <p className="text-xs text-slate-500 font-mono">
                              {fup.patientId} · Due: {fup.scheduledDate}
                            </p>
                          </div>
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold shrink-0 ${
                              isOverdue
                                ? 'bg-red-100 text-red-800 border border-red-200'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {isOverdue ? (
                              <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                            ) : (
                              <Clock className="w-3.5 h-3.5 text-amber-600" />
                            )}
                            <span>{formatFollowUpStatus(fup.status, language)}</span>
                          </span>
                        </div>

                        <p className="text-xs text-slate-700">{fup.notes}</p>

                        {editingFollowUpId === fup.followUpId ? (
                          <div className="space-y-2 pt-2 border-t border-slate-200">
                            <input
                              type="text"
                              value={followUpNoteInput}
                              onChange={(e) => setFollowUpNoteInput(e.target.value)}
                              placeholder="Enter home visit notes..."
                              className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white text-slate-900"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={async () => {
                                  const res = await onUpdateFollowUp({
                                    followUpId: fup.followUpId,
                                    status: 'completed',
                                    notes:
                                      followUpNoteInput.trim() ||
                                      `${fup.notes} [Completed during ASHA home visit]`,
                                    expectedVersion: fup.version,
                                  });
                                  setEditingFollowUpId(null);
                                  setFollowUpNoteInput('');
                                  setFollowUpActionFeedback(res.message);
                                }}
                                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800"
                              >
                                Save Completed
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingFollowUpId(null);
                                  setFollowUpNoteInput('');
                                }}
                                className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-medium"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingFollowUpId(fup.followUpId);
                              setFollowUpNoteInput(fup.notes);
                            }}
                            className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50"
                          >
                            {language === 'hi' ? 'फॉलो-अप पूरा करें' : 'Mark Follow-up Complete'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          5. PATIENTS & PATIENT REGISTRATION (activeSubTab === 'register')
         ===================================================================== */}
      {activeSubTab === 'register' && (
        <div className="space-y-6">
          {/* Clean Header with Toggle between Registration Form & Patient Directory */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                {language === 'hi' ? 'मरीज और पंजीकरण (Patients)' : 'Patients & Registration'}
              </h1>
              <p className="text-sm text-slate-600 mt-0.5">
                {language === 'hi'
                  ? 'नया मरीज पंजीकृत करें या मौजूदा मरीज को खोजें।'
                  : 'Register a new patient with consent or search existing village patients.'}
              </p>
            </div>
            <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg self-start sm:self-center">
              <button
                type="button"
                onClick={() => setShowRegistrationForm(true)}
                className={`min-h-[40px] px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  showRegistrationForm
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {language === 'hi' ? '+ नया मरीज पंजीकरण' : '+ Register Patient'}
              </button>
              <button
                type="button"
                onClick={() => setShowRegistrationForm(false)}
                className={`min-h-[40px] px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  !showRegistrationForm
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {language === 'hi'
                  ? `मरीज सूची (${patients.length})`
                  : `Patient List (${patients.length})`}
              </button>
            </div>
          </div>

          {showRegistrationForm ? (
            <div className="max-w-2xl mx-auto bg-white rounded-xl border border-slate-200 p-6">
              <form onSubmit={handlePatientRegistrationSubmit} className="space-y-6">
                {/* Group 1: Basic Information */}
                <div className="space-y-4">
                  <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-2">
                    {language === 'hi' ? '1. सामान्य जानकारी (Basic Information)' : '1. Basic information'}
                  </h2>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-800 mb-1">
                        {language === 'hi' ? 'मरीज का पूरा नाम (Full Name)' : 'Patient Full Name'}{' '}
                        <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={regName}
                        onChange={(e) => setRegName(e.target.value)}
                        placeholder="e.g., Geeta Devi"
                        className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900"
                      />
                      <p className="text-xs text-slate-500 mt-1">
                        Enter the patient&apos;s name as used on their village health card.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-800 mb-1">
                        {language === 'hi' ? 'आयु (Age in Years)' : 'Age (Years)'}{' '}
                        <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="number"
                        required
                        min={1}
                        max={115}
                        value={regAge}
                        onChange={(e) => setRegAge(e.target.value)}
                        className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono text-slate-900"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-800 mb-1">
                        {language === 'hi' ? 'लिंग (Sex)' : 'Sex'}{' '}
                        <span className="text-red-600">*</span>
                      </label>
                      <select
                        value={regSex}
                        onChange={(e) =>
                          setRegSex(e.target.value as 'female' | 'male' | 'other')
                        }
                        className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white"
                      >
                        <option value="female">Female (महिला)</option>
                        <option value="male">Male (पुरुष)</option>
                        <option value="other">Other (अन्य)</option>
                      </select>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-800 mb-1">
                        {language === 'hi' ? 'मरीज आईडी (Patient ID)' : 'Patient ID'}{' '}
                        <span className="text-red-600">*</span>
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          required
                          value={regId}
                          onChange={(e) => setRegId(e.target.value)}
                          className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono text-slate-900 bg-slate-50"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setRegId(`PAT-RMP-${Math.floor(1007 + Math.random() * 8900)}`)
                          }
                          className="min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 shrink-0"
                        >
                          Generate ID
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Group 2: Contact Information */}
                <div className="space-y-4">
                  <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-2">
                    {language === 'hi'
                      ? '2. संपर्क जानकारी (Contact Information)'
                      : '2. Contact information'}
                  </h2>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-semibold text-slate-800">
                          {language === 'hi' ? 'गांव (Village)' : 'Village'}{' '}
                          <span className="text-red-600">*</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => setIsCustomVillage((prev) => !prev)}
                          className="text-[11px] font-semibold text-teal-700 hover:underline"
                        >
                          {isCustomVillage
                            ? language === 'hi'
                              ? 'सूची से चुनें'
                              : 'Select from list'
                            : language === 'hi'
                              ? '+ अन्य गांव जोड़ें'
                              : '+ Add other village'}
                        </button>
                      </div>
                      {isCustomVillage ? (
                        <input
                          type="text"
                          required
                          value={customVillageInput}
                          onChange={(e) => setCustomVillageInput(e.target.value)}
                          placeholder={
                            language === 'hi'
                              ? 'गांव का नाम दर्ज करें...'
                              : 'Enter custom village name...'
                          }
                          className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white"
                        />
                      ) : (
                        <select
                          value={regVillage}
                          onChange={(e) => setRegVillage(e.target.value)}
                          className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white"
                        >
                          {availableVillages.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-800 mb-1">
                        {language === 'hi'
                          ? 'फोन के अंतिम 4 अंक (Phone Last 4 Digits)'
                          : 'Phone (Last 4 Digits)'}{' '}
                        <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        required
                        maxLength={4}
                        value={regPhone4}
                        onChange={(e) => setRegPhone4(e.target.value.replace(/\D/g, ''))}
                        placeholder="e.g., 4812"
                        className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono text-slate-900"
                      />
                      <p className="text-xs text-slate-500 mt-1">
                        Only the last 4 digits are collected to protect patient privacy.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Group 3: Pregnancy Status (when relevant) & Medical History */}
                <div className="space-y-4">
                  <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-2">
                    {language === 'hi'
                      ? '3. गर्भावस्था और स्वास्थ्य इतिहास (Pregnancy & Medical History)'
                      : '3. Pregnancy status & medical history'}
                  </h2>

                  {regSex === 'female' && (
                    <label className="min-h-[44px] p-3.5 rounded-lg border border-slate-200 bg-slate-50 flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={regIsPregnant}
                        onChange={(e) => setRegIsPregnant(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-teal-700"
                      />
                      <span className="text-sm font-medium text-slate-900">
                        {language === 'hi'
                          ? 'मरीज वर्तमान में गर्भवती है (Currently Pregnant)'
                          : 'Patient is currently pregnant (गर्भवती महिला)'}
                      </span>
                    </label>
                  )}

                  <div>
                    <p className="text-xs font-semibold text-slate-700 mb-2">
                      {language === 'hi'
                        ? 'यदि पहले से कोई बीमारी ज्ञात हो तो चुनें (Optional):'
                        : 'Select any known medical conditions (Optional):'}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {KNOWN_CONDITIONS_CATALOG.map((cond) => {
                        const checked = regConditions.includes(cond.id);
                        return (
                          <label
                            key={cond.id}
                            className={`min-h-[42px] px-3 py-2 rounded-lg border text-xs font-medium flex items-center gap-2.5 cursor-pointer ${
                              checked
                                ? 'bg-teal-50 border-teal-600 text-slate-900'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setRegConditions([...regConditions, cond.id]);
                                } else {
                                  setRegConditions(regConditions.filter((c) => c !== cond.id));
                                }
                              }}
                              className="w-4 h-4 rounded border-slate-300 text-teal-700"
                            />
                            <span>{language === 'hi' ? cond.labelHi : cond.labelEn}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Group 4: Consent */}
                <div className="space-y-3">
                  <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-2">
                    {language === 'hi' ? '4. मरीज की सहमति (Consent)' : '4. Patient consent'}
                  </h2>

                  <label className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={regConsent}
                      onChange={(e) => setRegConsent(e.target.checked)}
                      className="mt-1 w-4 h-4 rounded border-slate-300 text-teal-700"
                    />
                    <div className="text-xs text-slate-700 space-y-1">
                      <p className="font-semibold text-slate-900">
                        {labels.consentLabel} <span className="text-red-600">*</span>
                      </p>
                      <p className="text-slate-500">
                        Required before recording health measurements or sharing referrals with the PHC doctor.
                      </p>
                    </div>
                  </label>
                </div>

                {regFeedback && (
                  <div
                    className={`p-4 rounded-lg border text-xs font-medium flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      regFeedback.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-red-50 border-red-200 text-red-900'
                    }`}
                  >
                    <span>{regFeedback.text}</span>
                    {regFeedback.type === 'success' && (
                      <button
                        type="button"
                        onClick={() => onChangeSubTab('screening')}
                        className="min-h-[40px] px-4 py-2 rounded-lg bg-emerald-700 text-white font-semibold shrink-0"
                      >
                        Start Screening Now →
                      </button>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={regSubmitting}
                  className="w-full min-h-[48px] px-6 py-3 rounded-lg bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 transition-colors disabled:opacity-60"
                >
                  {regSubmitting
                    ? 'Saving Patient...'
                    : language === 'hi'
                      ? 'मरीज सुरक्षित करें (Save Patient)'
                      : 'Save Patient'}
                </button>
              </form>
            </div>
          ) : (
            /* Searchable Patient Directory */
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <div className="relative max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={patientDirectorySearch}
                  onChange={(e) => setPatientDirectorySearch(e.target.value)}
                  placeholder="Search patient by name, ID, or village..."
                  className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900"
                />
              </div>

              <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                {filteredDirectoryPatients.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs">
                    {patientDirectorySearch
                      ? (language === 'hi' ? 'कोई मरीज नहीं मिला।' : 'No matching patients found.')
                      : (language === 'hi' ? 'कोई मरीज पंजीकृत नहीं है। नया मरीज पंजीकृत करने के लिए ऊपर "नया मरीज पंजीकृत करें" बटन दबाएं।' : 'No patients registered yet. Use the form above to register your first patient.')}
                  </div>
                ) : (
                  filteredDirectoryPatients.map((pat) => (
                  <div
                    key={pat.patientId}
                    className="p-4 bg-white hover:bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-0.5">
                      <p className="text-sm font-bold text-slate-900">
                        {pat.fullName}{' '}
                        <span className="font-normal text-slate-500">
                          ({pat.ageYears} yrs · {pat.sex})
                        </span>
                      </p>
                      <p className="text-xs text-slate-500 font-mono tabular-nums">
                        ID: {pat.patientId} · ABHA: {formatAbhaId(pat.patientId)} · Village: {pat.village} · Phone: ****
                        {pat.phoneLastFour}
                      </p>
                      {pat.knownConditions.length > 0 && (
                        <p className="text-xs text-slate-600">
                          History: {pat.knownConditions.join(', ')}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPatientId(pat.patientId);
                        onChangeSubTab('screening');
                      }}
                      className="min-h-[42px] px-4 py-2 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 shrink-0 self-start sm:self-center"
                    >
                      {language === 'hi' ? 'जांच शुरू करें' : 'Start Screening'}
                    </button>
                  </div>
                ))) }
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          6. PATIENT SCREENING — GUIDED 4-STEP WORKFLOW (activeSubTab === 'screening')
         ===================================================================== */}
      {activeSubTab === 'screening' && (
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Clean Page Header & Step Indicator Bar */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h1 className="text-xl font-bold text-slate-900">{labels.patientScreeningTitle}</h1>
                <p className="text-sm text-slate-600">
                  {language === 'hi'
                    ? 'नीचे दिए गए 4 आसान चरणों में मरीज की जांच पूरी करें।'
                    : 'Complete the patient screening in 4 guided steps below.'}
                </p>
              </div>
              <span className="text-xs text-slate-500 font-medium">
                * Required core measurements
              </span>
            </div>

            {/* 4-Step Anchor Progress Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <a
                href="#step-1-patient"
                className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 hover:border-teal-600 text-xs font-semibold text-slate-800 flex items-center gap-2"
              >
                <span className="w-5 h-5 rounded-full bg-teal-700 text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                  1
                </span>
                <span className="truncate">Select Patient</span>
              </a>
              <a
                href="#step-2-measurements"
                className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 hover:border-teal-600 text-xs font-semibold text-slate-800 flex items-center gap-2"
              >
                <span className="w-5 h-5 rounded-full bg-teal-700 text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                  2
                </span>
                <span className="truncate">Measurements</span>
              </a>
              <a
                href="#step-3-results"
                className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 hover:border-teal-600 text-xs font-semibold text-slate-800 flex items-center gap-2"
              >
                <span className="w-5 h-5 rounded-full bg-teal-700 text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                  3
                </span>
                <span className="truncate">Review Results</span>
              </a>
              <a
                href="#step-4-save"
                className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 hover:border-teal-600 text-xs font-semibold text-slate-800 flex items-center gap-2"
              >
                <span className="w-5 h-5 rounded-full bg-teal-700 text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                  4
                </span>
                <span className="truncate">Save & Continue</span>
              </a>
            </div>
          </div>

          <form onSubmit={handleScreeningSubmit} className="space-y-6">
            {/* ---------------------------------------------------------------
                STEP 1: SELECT PATIENT
               --------------------------------------------------------------- */}
            <section
              id="step-1-patient"
              className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">
                  {language === 'hi' ? 'चरण 1: मरीज चुनें (STEP 1: Select Patient)' : 'STEP 1: Select Patient'}
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setShowRegistrationForm(true);
                    onChangeSubTab('register');
                  }}
                  className="text-xs font-semibold text-teal-700 hover:underline flex items-center gap-1"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>+ New Patient</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {language === 'hi' ? 'मरीज खोजें (Search Patient)' : 'Search Existing Patients'}
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={patientSearchQuery}
                      onChange={(e) => {
                        setPatientSearchQuery(e.target.value);
                        const q = e.target.value.trim().toLowerCase();
                        const firstMatch = patients.find(
                          (p) =>
                            p.fullName.toLowerCase().includes(q) ||
                            p.patientId.toLowerCase().includes(q) ||
                            p.village.toLowerCase().includes(q)
                        );
                        if (firstMatch) setSelectedPatientId(firstMatch.patientId);
                      }}
                      placeholder="Type name, ID, or village..."
                      className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {language === 'hi' ? 'मरीज का चयन करें' : 'Select Patient'}{' '}
                    <span className="text-red-600">*</span>
                  </label>
                  <select
                    value={effectiveSelectedPatientId}
                    onChange={(e) => setSelectedPatientId(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white"
                  >
                    {filteredPatientsForSelect.map((p) => (
                      <option key={p.patientId} value={p.patientId}>
                        {p.fullName} ({p.patientId}) — {p.village}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Selected Patient Necessary Summary */}
              {selectedPatient && (
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="space-y-0.5">
                    <p className="font-bold text-slate-900 text-sm">
                      {selectedPatient.fullName}{' '}
                      <span className="font-mono font-normal text-slate-600">
                        ({selectedPatient.patientId})
                      </span>
                    </p>
                    <p className="text-slate-600">
                      Age: <strong>{selectedPatient.ageYears} yrs</strong> · Sex:{' '}
                      <strong className="capitalize">{selectedPatient.sex}</strong> · Village:{' '}
                      <strong>{selectedPatient.village}</strong> ·{' '}
                      <span className="font-mono text-teal-800">
                        ABHA: {formatAbhaId(selectedPatient.patientId)}
                      </span>
                    </p>
                  </div>
                  <div className="text-slate-600">
                    <span className="font-semibold text-slate-800">Known History: </span>
                    {selectedPatient.knownConditions.length > 0
                      ? selectedPatient.knownConditions.join(', ')
                      : 'None reported'}
                  </div>
                </div>
              )}
            </section>

            {/* ---------------------------------------------------------------
                STEP 2: RECORD MEASUREMENTS & SYMPTOMS
               --------------------------------------------------------------- */}
            <section
              id="step-2-measurements"
              className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 space-y-6"
            >
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">
                  {language === 'hi'
                    ? 'चरण 2: माप और लक्षण दर्ज करें (STEP 2: Record Measurements)'
                    : 'STEP 2: Record Measurements'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Core measurements are marked with <span className="text-red-600 font-bold">*</span>. Leave optional fields blank if an instrument is unavailable.
                </p>
              </div>

              {/* Vitals Grid: 1 or 2 fields per row on mobile, 2 on desktop */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Blood Pressure (Systolic & Diastolic) */}
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Systolic Blood Pressure <span className="text-slate-500 font-normal">(mmHg)</span>{' '}
                    <span className="text-red-600">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={systolicBp}
                      onChange={(e) => setSystolicBp(e.target.value)}
                      placeholder="e.g., 120"
                      className={`w-full min-h-[44px] px-3 pr-16 py-2 rounded-lg border text-sm font-mono text-slate-900 ${
                        !systolicBp.trim() ? 'border-amber-400 bg-amber-50/30' : 'border-slate-300'
                      }`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-mono">
                      mmHg
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Diastolic Blood Pressure <span className="text-slate-500 font-normal">(mmHg)</span>{' '}
                    <span className="text-red-600">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={diastolicBp}
                      onChange={(e) => setDiastolicBp(e.target.value)}
                      placeholder="e.g., 80"
                      className={`w-full min-h-[44px] px-3 pr-16 py-2 rounded-lg border text-sm font-mono text-slate-900 ${
                        !diastolicBp.trim() ? 'border-amber-400 bg-amber-50/30' : 'border-slate-300'
                      }`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-mono">
                      mmHg
                    </span>
                  </div>
                </div>

                {/* SpO2 */}
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    SpO2 Oxygen Saturation <span className="text-slate-500 font-normal">(%)</span>{' '}
                    <span className="text-red-600">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={spo2Percent}
                      onChange={(e) => setSpo2Percent(e.target.value)}
                      placeholder="e.g., 98"
                      className={`w-full min-h-[44px] px-3 pr-12 py-2 rounded-lg border text-sm font-mono text-slate-900 ${
                        !spo2Percent.trim() ? 'border-amber-400 bg-amber-50/30' : 'border-slate-300'
                      }`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-mono">
                      %
                    </span>
                  </div>
                </div>

                {/* Temperature */}
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Body Temperature <span className="text-slate-500 font-normal">(°C)</span>{' '}
                    <span className="text-red-600">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      value={temperatureC}
                      onChange={(e) => setTemperatureC(e.target.value)}
                      placeholder="e.g., 37.0"
                      className={`w-full min-h-[44px] px-3 pr-12 py-2 rounded-lg border text-sm font-mono text-slate-900 ${
                        !temperatureC.trim() ? 'border-amber-400 bg-amber-50/30' : 'border-slate-300'
                      }`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-mono">
                      °C
                    </span>
                  </div>
                </div>

                {/* Heart Rate */}
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Heart Rate <span className="text-slate-500 font-normal">(bpm · Optional)</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={heartRateBpm}
                      onChange={(e) => setHeartRateBpm(e.target.value)}
                      placeholder="Optional"
                      className="w-full min-h-[44px] px-3 pr-14 py-2 rounded-lg border border-slate-300 text-sm font-mono text-slate-900"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-mono">
                      bpm
                    </span>
                  </div>
                </div>

                {/* Random Blood Glucose */}
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Random Blood Glucose{' '}
                    <span className="text-slate-500 font-normal">(mg/dL · Optional)</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={glucoseMgDl}
                      onChange={(e) => setGlucoseMgDl(e.target.value)}
                      placeholder="Optional"
                      className="w-full min-h-[44px] px-3 pr-16 py-2 rounded-lg border border-slate-300 text-sm font-mono text-slate-900"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-mono">
                      mg/dL
                    </span>
                  </div>
                </div>

                {/* Hemoglobin */}
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Hemoglobin <span className="text-slate-500 font-normal">(g/dL · Optional)</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      value={hemoglobinGDl}
                      onChange={(e) => setHemoglobinGDl(e.target.value)}
                      placeholder="Optional"
                      className="w-full min-h-[44px] px-3 pr-14 py-2 rounded-lg border border-slate-300 text-sm font-mono text-slate-900"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-mono">
                      g/dL
                    </span>
                  </div>
                </div>

                {/* Respiratory Rate */}
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Respiratory Rate{' '}
                    <span className="text-slate-500 font-normal">(breaths/min · Optional)</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={respRateBpm}
                      onChange={(e) => setRespRateBpm(e.target.value)}
                      placeholder="Optional"
                      className="w-full min-h-[44px] px-3 pr-16 py-2 rounded-lg border border-slate-300 text-sm font-mono text-slate-900"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-mono">
                      /min
                    </span>
                  </div>
                </div>
              </div>

              {/* Missing Required Measurement Indicator */}
              {liveEvaluation.missingFields.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-xs text-amber-900">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Missing Core Measurements: </span>
                    <span>
                      {liveEvaluation.missingFields.join(', ')}. Leaving core vitals blank will mark
                      this screening as &quot;Information incomplete&quot; unless urgent signs are present.
                    </span>
                  </div>
                </div>
              )}

              {/* Pregnancy Information */}
              <div className="pt-2 border-t border-slate-100 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <label className="min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-200 bg-slate-50 flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-slate-800">
                    <input
                      type="checkbox"
                      checked={isPregnant}
                      onChange={(e) => setIsPregnant(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-teal-700"
                    />
                    <span>
                      {language === 'hi'
                        ? 'मरीज वर्तमान में गर्भवती है (Currently Pregnant)'
                        : 'Patient is currently pregnant (गर्भवती महिला)'}
                    </span>
                  </label>

                  {isPregnant && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold text-slate-700 whitespace-nowrap">
                        Gestational Weeks:
                      </label>
                      <input
                        type="number"
                        min={4}
                        max={44}
                        value={gestationalWeeks}
                        onChange={(e) => setGestationalWeeks(e.target.value)}
                        placeholder="Weeks (4-44)"
                        className="w-32 min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-mono text-slate-900"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Symptoms Selection + Add Custom Symptom Button */}
              <div className="pt-2 border-t border-slate-100 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-900">
                      {language === 'hi'
                        ? 'लक्षण चुनें (Reported Symptoms)'
                        : 'Reported Symptoms (Select all that apply)'}
                    </label>
                    <p className="text-xs text-slate-500">
                      {language === 'hi'
                        ? 'मरीज के लक्षण चुनें या "+ लक्षण जोड़ें" बटन से नया लक्षण दर्ज करें।'
                        : 'Select observed symptoms below or click "+ Add Symptom" to record a custom symptom.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAddSymptomForm((prev) => !prev)}
                    className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-teal-50 border border-teal-200 text-teal-800 hover:bg-teal-100 text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{language === 'hi' ? '+ लक्षण जोड़ें (Add Symptom)' : '+ Add Symptom'}</span>
                  </button>
                </div>

                {/* Inline Add Custom Symptom Drawer */}
                {showAddSymptomForm && (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900">
                        {language === 'hi'
                          ? 'नया लक्षण जोड़ें (Add Custom Symptom)'
                          : 'Add Custom Patient Symptom'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowAddSymptomForm(false)}
                        className="text-slate-400 hover:text-slate-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <input
                        type="text"
                        value={newSymptomText}
                        onChange={(e) => setNewSymptomText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddCustomSymptom();
                          }
                        }}
                        placeholder={
                          language === 'hi'
                            ? 'उदा. जोड़ों में दर्द, पेट दर्द, उल्टी...'
                            : 'e.g., Severe abdominal pain, joint swelling, rash...'
                        }
                        className="flex-1 min-h-[42px] px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
                      />
                      <label className="min-h-[42px] px-3 py-2 rounded-lg border border-slate-300 bg-white flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={newSymptomIsRedFlag}
                          onChange={(e) => setNewSymptomIsRedFlag(e.target.checked)}
                          className="w-4 h-4 rounded border-slate-300 text-red-600"
                        />
                        <span className="text-red-700">
                          {language === 'hi' ? 'गंभीर खतरा (Urgent Sign)' : 'Urgent Danger Sign'}
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={handleAddCustomSymptom}
                        disabled={!newSymptomText.trim()}
                        className="min-h-[42px] px-4 py-2 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 disabled:opacity-50 shrink-0"
                      >
                        {language === 'hi' ? 'जोड़ें (Add)' : 'Add to List'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[...SYMPTOM_CATALOG, ...customSymptomsList].map((sym) => {
                    const checked = selectedSymptoms.includes(sym.id);
                    const isCustom = sym.id.startsWith('custom:') || sym.id.startsWith('urgent:');
                    return (
                      <label
                        key={sym.id}
                        className={`min-h-[44px] p-3 rounded-lg border text-xs font-medium flex items-start justify-between gap-2.5 cursor-pointer transition-colors ${
                          checked
                            ? sym.isRedFlag
                              ? 'bg-red-50 border-red-400 text-red-950'
                              : 'bg-teal-50 border-teal-600 text-slate-900'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedSymptoms([...selectedSymptoms, sym.id]);
                              } else {
                                setSelectedSymptoms(
                                  selectedSymptoms.filter((id) => id !== sym.id)
                                );
                              }
                            }}
                            className="mt-0.5 w-4 h-4 rounded border-slate-300"
                          />
                          <div>
                            <span>{language === 'hi' ? sym.labelHi : sym.labelEn}</span>
                            {sym.isRedFlag && (
                              <span className="block text-[11px] font-semibold text-red-700">
                                Urgent Danger Sign
                              </span>
                            )}
                            {isCustom && !sym.isRedFlag && (
                              <span className="block text-[11px] font-medium text-teal-700">
                                Custom Added Symptom
                              </span>
                            )}
                          </div>
                        </div>
                        {isCustom && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              setCustomSymptomsList((prev) =>
                                prev.filter((item) => item.id !== sym.id)
                              );
                              setSelectedSymptoms((prev) =>
                                prev.filter((id) => id !== sym.id)
                              );
                            }}
                            title="Remove custom symptom"
                            className="text-slate-400 hover:text-red-600 p-0.5"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </label>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Symptom Duration (Days)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={365}
                      value={symptomDurationDays}
                      onChange={(e) => setSymptomDurationDays(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono text-slate-900"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Additional Observation Notes (Optional)
                    </label>
                    <input
                      type="text"
                      value={historyNotes}
                      onChange={(e) => setHistoryNotes(e.target.value)}
                      placeholder="Brief notes from home visit..."
                      className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900"
                    />
                  </div>
                </div>
              </div>

              {/* MoHFW CBAC (Community Based Assessment Checklist) NCD Risk Scoring (0-10) — Redesigned Touch UI/UX */}
              <div className="pt-5 border-t border-slate-100 space-y-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-teal-700 shrink-0" />
                        <h3 className="text-sm font-bold text-slate-900">
                          {language === 'hi'
                            ? 'MoHFW CBAC एनसीडी जोखिम तालिका (CBAC NCD Risk Checklist)'
                            : 'MoHFW CBAC NCD Risk Checklist (0–10 Scale)'}
                        </h3>
                      </div>
                      <p className="text-xs text-slate-600">
                        {language === 'hi'
                          ? 'प्रत्येक प्रश्न के लिए उपयुक्त विकल्प पर टैप करें। कुल स्कोर > 4 होने पर साप्ताहिक पीएचसी एनसीडी जांच आवश्यक है।'
                          : 'Tap an option for each of the 6 community risk factors below. A score > 4 triggers priority PHC NCD screening.'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                      <div
                        className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold tabular-nums flex items-center gap-2 ${
                          liveCbac.isHighNcdRisk
                            ? 'bg-amber-100 border-amber-400 text-amber-950'
                            : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        }`}
                      >
                        <span>Score: {liveCbac.totalScore}/10</span>
                        <span className="text-[11px] font-sans font-semibold px-1.5 py-0.5 rounded bg-white/80">
                          {liveCbac.isHighNcdRisk
                            ? language === 'hi'
                              ? 'उच्च जोखिम (>4)'
                              : 'High Risk (>4)'
                            : language === 'hi'
                              ? 'सामान्य (≤4)'
                              : 'Routine (≤4)'}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setCbacInput({
                            ageScore: 0,
                            tobaccoScore: 0,
                            alcoholScore: 0,
                            waistScore: 0,
                            physicalActivityScore: 0,
                            familyHistoryScore: 0,
                          })
                        }
                        title="Reset CBAC Checklist"
                        className="min-h-[36px] px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 text-xs font-semibold flex items-center gap-1"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>{language === 'hi' ? 'रीसेट' : 'Reset'}</span>
                      </button>
                    </div>
                  </div>

                  {/* 10-Segment Visual Score Bar */}
                  <div className="space-y-1">
                    <div className="grid grid-cols-10 gap-1">
                      {Array.from({ length: 10 }).map((_, idx) => {
                        const pointNum = idx + 1;
                        const active = pointNum <= liveCbac.totalScore;
                        const isHighZone = pointNum > 4;
                        return (
                          <div
                            key={pointNum}
                            className={`h-2 rounded-sm transition-colors ${
                              active
                                ? isHighZone
                                  ? 'bg-amber-500'
                                  : 'bg-teal-600'
                                : 'bg-slate-200'
                            }`}
                          />
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                      <span>0 pts (Low Risk)</span>
                      <span>Threshold: &gt;4 pts (PHC NCD Referral)</span>
                      <span>10 pts (Max)</span>
                    </div>
                  </div>
                </div>

                {/* 6 Interactive Touch Cards for CBAC Questions */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
                  {/* Question 1: Age Group */}
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">
                        1. {language === 'hi' ? 'आयु वर्ग (Age Group)' : 'Age Group'}
                      </span>
                      <span className="font-mono font-semibold text-teal-800">
                        +{cbacInput.ageScore} pt{cbacInput.ageScore === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { val: 0 as const, labelEn: '< 30 yrs', labelHi: '< 30 वर्ष', pts: '0 pt' },
                        { val: 1 as const, labelEn: '30–49 yrs', labelHi: '30–49 वर्ष', pts: '+1 pt' },
                        { val: 2 as const, labelEn: '≥ 50 yrs', labelHi: '≥ 50 वर्ष', pts: '+2 pts' },
                      ].map((opt) => {
                        const active = cbacInput.ageScore === opt.val;
                        return (
                          <button
                            key={opt.val}
                            type="button"
                            onClick={() =>
                              setCbacInput((prev) => ({ ...prev, ageScore: opt.val }))
                            }
                            className={`min-h-[44px] px-2 py-1.5 rounded-lg border text-center transition-colors flex flex-col items-center justify-center ${
                              active
                                ? 'bg-teal-700 text-white border-teal-700 font-semibold'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            <span>{language === 'hi' ? opt.labelHi : opt.labelEn}</span>
                            <span
                              className={`text-[10px] font-mono ${
                                active ? 'text-teal-100' : 'text-slate-500'
                              }`}
                            >
                              {opt.pts}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Question 2: Smoke / Smokeless Tobacco */}
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">
                        2. {language === 'hi' ? 'तंबाकू / गुटखा (Tobacco Use)' : 'Tobacco / Gutkha Use'}
                      </span>
                      <span className="font-mono font-semibold text-teal-800">
                        +{cbacInput.tobaccoScore} pt{cbacInput.tobaccoScore === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { val: 0 as const, labelEn: 'Never', labelHi: 'कभी नहीं', pts: '0 pt' },
                        { val: 1 as const, labelEn: 'Past / Rare', labelHi: 'कभी-कभार', pts: '+1 pt' },
                        { val: 2 as const, labelEn: 'Daily User', labelHi: 'प्रतिदिन', pts: '+2 pts' },
                      ].map((opt) => {
                        const active = cbacInput.tobaccoScore === opt.val;
                        return (
                          <button
                            key={opt.val}
                            type="button"
                            onClick={() =>
                              setCbacInput((prev) => ({ ...prev, tobaccoScore: opt.val }))
                            }
                            className={`min-h-[44px] px-2 py-1.5 rounded-lg border text-center transition-colors flex flex-col items-center justify-center ${
                              active
                                ? 'bg-teal-700 text-white border-teal-700 font-semibold'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            <span>{language === 'hi' ? opt.labelHi : opt.labelEn}</span>
                            <span
                              className={`text-[10px] font-mono ${
                                active ? 'text-teal-100' : 'text-slate-500'
                              }`}
                            >
                              {opt.pts}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Question 3: Alcohol Consumption */}
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">
                        3. {language === 'hi' ? 'शराब का सेवन (Daily Alcohol)' : 'Daily Alcohol Intake'}
                      </span>
                      <span className="font-mono font-semibold text-teal-800">
                        +{cbacInput.alcoholScore} pt{cbacInput.alcoholScore === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { val: 0 as const, labelEn: 'No', labelHi: 'नहीं (No)', pts: '0 pt' },
                        {
                          val: 1 as const,
                          labelEn: 'Yes (Daily / Frequent)',
                          labelHi: 'हां (प्रतिदिन)',
                          pts: '+1 pt',
                        },
                      ].map((opt) => {
                        const active = cbacInput.alcoholScore === opt.val;
                        return (
                          <button
                            key={opt.val}
                            type="button"
                            onClick={() =>
                              setCbacInput((prev) => ({ ...prev, alcoholScore: opt.val }))
                            }
                            className={`min-h-[44px] px-2.5 py-1.5 rounded-lg border text-center transition-colors flex flex-col items-center justify-center ${
                              active
                                ? 'bg-teal-700 text-white border-teal-700 font-semibold'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            <span>{language === 'hi' ? opt.labelHi : opt.labelEn}</span>
                            <span
                              className={`text-[10px] font-mono ${
                                active ? 'text-teal-100' : 'text-slate-500'
                              }`}
                            >
                              {opt.pts}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Question 4: Waist Circumference */}
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">
                        4. {language === 'hi' ? 'कमर का घेरा (Waist Size)' : 'Waist Circumference'}
                      </span>
                      <span className="font-mono font-semibold text-teal-800">
                        +{cbacInput.waistScore} pt{cbacInput.waistScore === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        {
                          val: 0 as const,
                          labelEn: 'Normal (<80F/90M)',
                          labelHi: 'सामान्य',
                          pts: '0 pt',
                        },
                        {
                          val: 1 as const,
                          labelEn: 'High (80–90F/90–100M)',
                          labelHi: 'मध्यम वृद्धि',
                          pts: '+1 pt',
                        },
                        {
                          val: 2 as const,
                          labelEn: 'Very High (>90F/>100M)',
                          labelHi: 'अधिक (>90/100)',
                          pts: '+2 pts',
                        },
                      ].map((opt) => {
                        const active = cbacInput.waistScore === opt.val;
                        return (
                          <button
                            key={opt.val}
                            type="button"
                            onClick={() =>
                              setCbacInput((prev) => ({ ...prev, waistScore: opt.val }))
                            }
                            className={`min-h-[44px] px-2 py-1.5 rounded-lg border text-center transition-colors flex flex-col items-center justify-center ${
                              active
                                ? 'bg-teal-700 text-white border-teal-700 font-semibold'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            <span className="leading-tight">
                              {language === 'hi' ? opt.labelHi : opt.labelEn}
                            </span>
                            <span
                              className={`text-[10px] font-mono ${
                                active ? 'text-teal-100' : 'text-slate-500'
                              }`}
                            >
                              {opt.pts}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Question 5: Physical Activity */}
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">
                        5. {language === 'hi' ? 'शारीरिक गतिविधि (Physical Activity)' : 'Physical Activity'}
                      </span>
                      <span className="font-mono font-semibold text-teal-800">
                        +{cbacInput.physicalActivityScore} pt
                        {cbacInput.physicalActivityScore === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        {
                          val: 0 as const,
                          labelEn: 'Active (≥150 min/wk)',
                          labelHi: 'सक्रिय (≥150 मिनट/सप्ताह)',
                          pts: '0 pt',
                        },
                        {
                          val: 1 as const,
                          labelEn: 'Low (<150 min/wk)',
                          labelHi: 'कम (<150 मिनट/सप्ताह)',
                          pts: '+1 pt',
                        },
                      ].map((opt) => {
                        const active = cbacInput.physicalActivityScore === opt.val;
                        return (
                          <button
                            key={opt.val}
                            type="button"
                            onClick={() =>
                              setCbacInput((prev) => ({
                                ...prev,
                                physicalActivityScore: opt.val,
                              }))
                            }
                            className={`min-h-[44px] px-2.5 py-1.5 rounded-lg border text-center transition-colors flex flex-col items-center justify-center ${
                              active
                                ? 'bg-teal-700 text-white border-teal-700 font-semibold'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            <span>{language === 'hi' ? opt.labelHi : opt.labelEn}</span>
                            <span
                              className={`text-[10px] font-mono ${
                                active ? 'text-teal-100' : 'text-slate-500'
                              }`}
                            >
                              {opt.pts}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Question 6: Family History */}
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">
                        6.{' '}
                        {language === 'hi'
                          ? 'पारिवारिक इतिहास: बीपी/शुगर/हृदय (Family History)'
                          : 'Family History (BP / Diabetes / Heart)'}
                      </span>
                      <span className="font-mono font-semibold text-teal-800">
                        +{cbacInput.familyHistoryScore} pts
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        {
                          val: 0 as const,
                          labelEn: 'No Family History',
                          labelHi: 'नहीं (No)',
                          pts: '0 pt',
                        },
                        {
                          val: 2 as const,
                          labelEn: 'Yes (Parents / Siblings)',
                          labelHi: 'हां (माता-पिता / भाई-बहन)',
                          pts: '+2 pts',
                        },
                      ].map((opt) => {
                        const active = cbacInput.familyHistoryScore === opt.val;
                        return (
                          <button
                            key={opt.val}
                            type="button"
                            onClick={() =>
                              setCbacInput((prev) => ({
                                ...prev,
                                familyHistoryScore: opt.val,
                              }))
                            }
                            className={`min-h-[44px] px-2.5 py-1.5 rounded-lg border text-center transition-colors flex flex-col items-center justify-center ${
                              active
                                ? 'bg-teal-700 text-white border-teal-700 font-semibold'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            <span>{language === 'hi' ? opt.labelHi : opt.labelEn}</span>
                            <span
                              className={`text-[10px] font-mono ${
                                active ? 'text-teal-100' : 'text-slate-500'
                              }`}
                            >
                              {opt.pts}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* ---------------------------------------------------------------
                STEP 3: REVIEW RESULTS
               --------------------------------------------------------------- */}
            <section
              id="step-3-results"
              className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 space-y-5"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">
                  {language === 'hi'
                    ? 'चरण 3: जांच परिणाम की समीक्षा (STEP 3: Review Results)'
                    : 'STEP 3: Review Results'}
                </h2>
                <span className="text-xs font-mono text-slate-500">
                  {liveEvaluation.engineVersion}
                </span>
              </div>

              {!liveEvaluation.isValid ? (
                <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900 space-y-1.5">
                  <p className="font-bold">Please fix the following measurement errors:</p>
                  <ul className="list-disc pl-4 space-y-1">
                    {liveEvaluation.validationErrors.map((err, i) => (
                      <li key={i}>{language === 'hi' ? err.messageHi : err.messageEn}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
                  {/* Prominent Status & Referral Needed Box */}
                  <div
                    className={`p-5 rounded-xl border-2 space-y-3 ${
                      liveEvaluation.resultCategory === 'urgent_escalation'
                        ? 'bg-red-50 border-red-500 text-red-950'
                        : liveEvaluation.resultCategory === 'further_assessment_needed'
                          ? 'bg-amber-50 border-amber-400 text-amber-950'
                          : liveEvaluation.resultCategory === 'incomplete_information'
                            ? 'bg-slate-100 border-slate-300 text-slate-900'
                            : 'bg-emerald-50 border-emerald-400 text-emerald-950'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        {liveEvaluation.resultCategory === 'urgent_escalation' && (
                          <AlertTriangle className="w-6 h-6 text-red-600 shrink-0" />
                        )}
                        {liveEvaluation.resultCategory === 'further_assessment_needed' && (
                          <Clock className="w-6 h-6 text-amber-600 shrink-0" />
                        )}
                        {liveEvaluation.resultCategory === 'incomplete_information' && (
                          <ShieldAlert className="w-6 h-6 text-slate-700 shrink-0" />
                        )}
                        {liveEvaluation.resultCategory === 'routine_follow_up' && (
                          <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                        )}
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide opacity-75">
                            Screening Status (Not a Confirmed Diagnosis)
                          </p>
                          <h3 className="text-lg sm:text-xl font-bold">
                            {formatCategoryLabel(liveEvaluation.resultCategory, language)}
                          </h3>
                        </div>
                      </div>

                      <div className="px-3 py-1.5 rounded-lg bg-white/90 border border-slate-200 text-xs font-bold text-slate-900 self-start sm:self-center">
                        {liveEvaluation.requiresReferral
                          ? language === 'hi'
                            ? 'पीएचसी रेफरल आवश्यक: हां (Referral Needed: Yes)'
                            : 'Referral Needed: Yes (PHC Doctor Review)'
                          : language === 'hi'
                            ? 'पीएचसी रेफरल आवश्यक: नहीं (Referral Needed: No)'
                            : 'Referral Needed: No'}
                      </div>
                    </div>

                    {/* Short Explanation */}
                    <p className="text-sm leading-relaxed">
                      {liveEvaluation.resultCategory === 'urgent_escalation'
                        ? 'Critical danger signs or severe measurements detected. Immediate referral to a medical officer is required.'
                        : liveEvaluation.resultCategory === 'further_assessment_needed'
                          ? 'One or more measurements or symptoms are outside normal screening range and require evaluation by a PHC doctor.'
                          : liveEvaluation.resultCategory === 'incomplete_information'
                            ? 'Required core measurements (BP, SpO2, or Temperature) are missing. Repeat screening with complete instruments before concluding routine status.'
                            : 'All core measurements are present and within standard screening bounds. Continue routine community follow-up.'}
                    </p>
                  </div>

                  {/* Reason for the Flag & Recommended Next Step */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-2.5">
                      <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                        Reason for the Flag ({liveEvaluation.flaggedReasons.length})
                      </h4>
                      {liveEvaluation.flaggedReasons.length === 0 ? (
                        <p className="text-xs text-slate-600">
                          No abnormal thresholds or danger signs were triggered.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {liveEvaluation.flaggedReasons.map((r, idx) => (
                            <li
                              key={`${r.code}-${idx}`}
                              className="p-2.5 rounded-md bg-white border border-slate-200 text-xs space-y-0.5"
                            >
                              <div className="flex items-center justify-between gap-2 font-semibold text-slate-900">
                                <span>{language === 'hi' ? r.titleHi : r.titleEn}</span>
                                <span className="font-mono text-teal-800">{r.observedValue}</span>
                              </div>
                              <p className="text-slate-600">
                                {language === 'hi' ? r.explanationHi : r.explanationEn}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-2.5">
                      <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                        Recommended Next Step
                      </h4>
                      <ul className="space-y-2">
                        {liveEvaluation.recommendedNextSteps.map((step) => (
                          <li
                            key={step.stepOrder}
                            className="p-2.5 rounded-md bg-white border border-slate-200 text-xs space-y-0.5"
                          >
                            <p className="font-semibold text-slate-900">
                              {step.stepOrder}.{' '}
                              {language === 'hi' ? step.actionHi : step.actionEn}
                            </p>
                            <p className="text-slate-500">
                              Timeframe: {language === 'hi' ? step.timeframeHi : step.timeframeEn}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Optional AI Counseling Helper (Guarded) + Bilingual Voice Read-Aloud */}
                  <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-800">
                        {language === 'hi'
                          ? 'मरीज परामर्श और ऑडियो मार्गदर्शन (Voice & Plain-Language Counseling)'
                          : 'Patient Counseling & Audio Guidance (AI cannot downgrade urgent rules)'}
                      </p>
                      {aiNote && <p className="text-xs text-slate-600">{aiNote}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-center">
                      <button
                        type="button"
                        onClick={handleToggleVoiceCounseling}
                        className={`min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                          isSpeaking
                            ? 'bg-teal-700 text-white border-teal-700'
                            : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-100'
                        }`}
                      >
                        {isSpeaking ? (
                          <>
                            <VolumeX className="w-3.5 h-3.5" />
                            <span>{language === 'hi' ? 'आवाज़ रोकें' : 'Stop Audio'}</span>
                          </>
                        ) : (
                          <>
                            <Volume2 className="w-3.5 h-3.5 text-teal-700" />
                            <span>
                              {language === 'hi'
                                ? 'हिंदी में सुनें (Listen)'
                                : 'Read Aloud (EN/HI)'}
                            </span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={aiLoading}
                        onClick={handleRequestAiNote}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-100 flex items-center gap-1.5"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-teal-700" />
                        <span>{aiLoading ? 'Generating...' : 'Explain for Patient'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Mandatory Non-Diagnostic Disclaimer */}
                  <div className="p-3 rounded-lg bg-slate-100 border border-slate-200 text-xs text-slate-600">
                    <strong className="text-slate-800">{labels.disclaimerHeader}: </strong>
                    {labels.disclaimerBody}
                  </div>
                </>
              )}
            </section>

            {/* ---------------------------------------------------------------
                STEP 4: SAVE AND CONTINUE
               --------------------------------------------------------------- */}
            <section
              id="step-4-save"
              className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 space-y-5"
            >
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">
                  {language === 'hi'
                    ? 'चरण 4: सुरक्षित करें और आगे बढ़ें (STEP 4: Save and Continue)'
                    : 'STEP 4: Save and Continue'}
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Create Referral Option (when indicated) */}
                <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                      1. PHC Referral Action
                    </span>
                    {liveEvaluation.requiresReferral && (
                      <span className="text-xs font-semibold text-teal-800">Recommended</span>
                    )}
                  </div>

                  {liveEvaluation.resultCategory === 'urgent_escalation' ||
                  liveEvaluation.resultCategory === 'further_assessment_needed' ? (
                    <>
                      <label className="flex items-start gap-2.5 cursor-pointer text-xs font-semibold text-slate-900">
                        <input
                          type="checkbox"
                          checked={createReferralChecked}
                          onChange={(e) => setCreateReferralChecked(e.target.checked)}
                          className="mt-0.5 w-4 h-4 rounded border-slate-300 text-teal-700"
                        />
                        <span>Create PHC Referral with this screening</span>
                      </label>
                      {createReferralChecked && (
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">
                            Referral Destination (Simulated)
                          </label>
                          <select
                            value={referralDestination}
                            onChange={(e) => setReferralDestination(e.target.value)}
                            className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white"
                          >
                            <option value="Simulated PHC Rampur (Demo)">
                              Simulated PHC Rampur (Demo)
                            </option>
                            <option value="Simulated PHC Rampur — Maternal High-Risk Clinic (Demo)">
                              Simulated PHC Rampur — Maternal Clinic (Demo)
                            </option>
                            <option value="Simulated CHC Sitapur Block (Demo)">
                              Simulated CHC Sitapur Block (Demo)
                            </option>
                          </select>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-slate-600">
                      No immediate PHC referral indicated for this result category.
                    </p>
                  )}
                </div>

                {/* Schedule Follow-up */}
                <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-3">
                  <span className="text-xs font-bold text-slate-900 uppercase tracking-wide block">
                    2. Schedule Follow-up
                  </span>
                  <div className="grid grid-cols-1 gap-2.5">
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">
                        Next Follow-up Date
                      </label>
                      <input
                        type="date"
                        value={customFollowUpDate || defaultFollowUpDate}
                        onChange={(e) => setCustomFollowUpDate(e.target.value)}
                        className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono text-slate-900 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">
                        Follow-up Instructions (Optional)
                      </label>
                      <input
                        type="text"
                        value={customFollowUpNotes}
                        onChange={(e) => setCustomFollowUpNotes(e.target.value)}
                        placeholder={`Default: Follow-up for ${formatCategoryLabel(liveEvaluation.resultCategory, 'en')}`}
                        className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {scrFeedback && (
                <div
                  className={`p-4 rounded-lg border text-xs space-y-2 ${
                    scrFeedback.type === 'success'
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                      : 'bg-red-50 border-red-200 text-red-900'
                  }`}
                >
                  <p className="font-bold text-sm">{scrFeedback.text}</p>
                  {scrFeedback.screeningId && (
                    <p className="font-mono">
                      Screening ID: {scrFeedback.screeningId}
                      {scrFeedback.referralId ? ` · Referral ID: ${scrFeedback.referralId}` : ''} ·
                      Follow-up Scheduled: {customFollowUpDate || defaultFollowUpDate}
                    </p>
                  )}
                  {scrFeedback.type === 'success' && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => onChangeSubTab('referrals')}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-semibold"
                      >
                        View Referrals & Follow-ups →
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setScrFeedback(null);
                          setLastSavedSignature(null);
                        }}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg border border-emerald-400 bg-white text-emerald-900 font-semibold"
                      >
                        Start Another Screening
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-3 pt-2">
                <button
                  type="submit"
                  disabled={scrSubmitting || hasSavedCurrentForm}
                  className="w-full sm:w-auto min-h-[48px] px-6 py-3 rounded-lg bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {scrSubmitting
                    ? 'Saving Screening...'
                    : hasSavedCurrentForm
                      ? 'Screening Saved ✓'
                      : createReferralChecked &&
                          (liveEvaluation.resultCategory === 'urgent_escalation' ||
                            liveEvaluation.resultCategory === 'further_assessment_needed')
                        ? language === 'hi'
                          ? 'जांच सुरक्षित करें और रेफरल बनाएं'
                          : 'Save Screening & Create Referral'
                        : language === 'hi'
                          ? 'जांच सुरक्षित करें (Save Screening)'
                          : 'Save Screening'}
                </button>
              </div>
            </section>
          </form>
        </div>
      )}

      {/* =====================================================================
          7. REFERRALS AND FOLLOW-UPS (activeSubTab === 'referrals')
         ===================================================================== */}
      {activeSubTab === 'referrals' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  {language === 'hi' ? 'रेफरल और फॉलो-अप (Referrals)' : 'Referrals & Follow-ups'}
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">{labels.simulatedPhcNotice}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-56">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={referralSearch}
                    onChange={(e) => setReferralSearch(e.target.value)}
                    placeholder="Search patient ID or name..."
                    className="w-full min-h-[40px] pl-9 pr-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900"
                  />
                </div>
                <select
                  value={referralStatusFilter}
                  onChange={(e) => setReferralStatusFilter(e.target.value)}
                  className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white"
                >
                  <option value="all">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="acknowledged">Acknowledged</option>
                  <option value="under_review">Under Review</option>
                  <option value="completed">Completed</option>
                  <option value="unable_to_complete">Unable to Complete</option>
                </select>
              </div>
            </div>

            {filteredReferrals.length === 0 ? (
              <div className="p-8 text-center rounded-lg bg-slate-50 border border-slate-100">
                <p className="text-sm text-slate-600">No referrals match your filter.</p>
              </div>
            ) : (
              <>
                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs text-slate-500">
                        <th className="py-3 px-3 font-semibold">Patient ID</th>
                        <th className="py-3 px-3 font-semibold">Referral Status</th>
                        <th className="py-3 px-3 font-semibold">Priority</th>
                        <th className="py-3 px-3 font-semibold">Referral Date</th>
                        <th className="py-3 px-3 font-semibold">Next Follow-up Date</th>
                        <th className="py-3 px-3 font-semibold text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {filteredReferrals.map((ref) => {
                        const scr = screenings.find((s) => s.screeningId === ref.screeningId);
                        const fup =
                          followUpByScreeningId.get(ref.screeningId) ||
                          followUpByPatientId.get(ref.patientId);
                        const isOverdue = fup?.status === 'overdue';
                        return (
                          <tr key={ref.referralId} className="hover:bg-slate-50">
                            <td className="py-3.5 px-3">
                              <span className="font-mono font-bold text-slate-900 block">
                                {ref.patientId}
                              </span>
                              <span className="text-slate-600">
                                {ref.patientName} · {ref.referralId}
                              </span>
                            </td>
                            <td className="py-3.5 px-3 font-semibold text-slate-900">
                              {formatReferralStatus(ref.status, language)}
                            </td>
                            <td className="py-3.5 px-3">{renderCategoryBadge(ref.priority)}</td>
                            <td className="py-3.5 px-3 font-mono text-slate-700">
                              {ref.createdDate}
                            </td>
                            <td className="py-3.5 px-3">
                              {fup ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-slate-800">
                                    {fup.scheduledDate}
                                  </span>
                                  {isOverdue && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 text-red-800 font-bold text-[11px]">
                                      <AlertTriangle className="w-3 h-3 text-red-600" />
                                      Overdue
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-400">Not scheduled</span>
                              )}
                            </td>
                            <td className="py-3.5 px-3 text-right">
                              {scr && (
                                <button
                                  type="button"
                                  onClick={() => onOpenScreeningDetail(scr)}
                                  className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 font-semibold hover:bg-slate-50"
                                >
                                  Open Referral
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Stacked Cards View */}
                <div className="md:hidden space-y-3">
                  {filteredReferrals.map((ref) => {
                    const scr = screenings.find((s) => s.screeningId === ref.screeningId);
                    const fup =
                      followUpByScreeningId.get(ref.screeningId) ||
                      followUpByPatientId.get(ref.patientId);
                    const isOverdue = fup?.status === 'overdue';
                    return (
                      <div
                        key={ref.referralId}
                        className="p-4 rounded-xl border border-slate-200 bg-white space-y-2.5 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-mono font-bold text-sm text-slate-900">
                              {ref.patientId} — {ref.patientName}
                            </p>
                            <p className="text-slate-500 font-mono">{ref.referralId}</p>
                          </div>
                          <span className="px-2.5 py-1 rounded-md bg-slate-100 font-semibold text-slate-800">
                            {formatReferralStatus(ref.status, language)}
                          </span>
                        </div>

                        <div>{renderCategoryBadge(ref.priority)}</div>

                        <div className="grid grid-cols-2 gap-2 pt-1 text-slate-600">
                          <div>
                            <span className="block text-slate-400">Referral Date</span>
                            <span className="font-mono font-medium text-slate-800">
                              {ref.createdDate}
                            </span>
                          </div>
                          <div>
                            <span className="block text-slate-400">Next Follow-up</span>
                            {fup ? (
                              <span
                                className={`font-mono font-semibold ${
                                  isOverdue ? 'text-red-700' : 'text-slate-800'
                                }`}
                              >
                                {fup.scheduledDate} {isOverdue ? '(Overdue)' : ''}
                              </span>
                            ) : (
                              <span>--</span>
                            )}
                          </div>
                        </div>

                        {scr && (
                          <button
                            type="button"
                            onClick={() => onOpenScreeningDetail(scr)}
                            className="w-full min-h-[42px] px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 font-semibold hover:bg-slate-100 mt-1"
                          >
                            Open Referral Details
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
