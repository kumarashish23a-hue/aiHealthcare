import { LanguageCode, ScreeningCategory, ReferralStatus, FollowUpStatus } from './types';

export const SYMPTOM_CATALOG: {
  id: string;
  labelEn: string;
  labelHi: string;
  isRedFlag: boolean;
}[] = [
  {
    id: 'chest_pain',
    labelEn: 'Severe chest pain or tightness',
    labelHi: 'सीने में तेज दर्द या जकड़न',
    isRedFlag: true,
  },
  {
    id: 'severe_breathlessness',
    labelEn: 'Severe shortness of breath at rest',
    labelHi: 'आराम की स्थिति में भी सांस फूलना',
    isRedFlag: true,
  },
  {
    id: 'seizures_confusion',
    labelEn: 'Convulsions, confusion, or sudden weakness',
    labelHi: 'दौरे पड़ना, बेहोशी या अचानक कमजोरी',
    isRedFlag: true,
  },
  {
    id: 'pregnancy_bleeding_vision',
    labelEn: 'Pregnancy danger sign: bleeding, blurred vision, or severe swelling',
    labelHi: 'गर्भावस्था खतरे के लक्षण: रक्तस्राव, धुंधला दिखना या तेज सूजन',
    isRedFlag: true,
  },
  {
    id: 'persistent_cough_2w',
    labelEn: 'Persistent cough for more than 14 days',
    labelHi: '14 दिनों से अधिक समय से लगातार खांसी',
    isRedFlag: false,
  },
  {
    id: 'high_fever',
    labelEn: 'Recurrent fever with chills or night sweats',
    labelHi: 'ठंड लगने या रात में पसीने के साथ बुखार',
    isRedFlag: false,
  },
  {
    id: 'headache_dizziness',
    labelEn: 'Frequent headache or dizziness',
    labelHi: 'बार-बार सिरदर्द या चक्कर आना',
    isRedFlag: false,
  },
  {
    id: 'fatigue_pallor',
    labelEn: 'Marked fatigue or pale palms/conjunctiva',
    labelHi: 'अत्यधिक थकान या हथेलियों/आंखों में पीलापन',
    isRedFlag: false,
  },
  {
    id: 'excessive_thirst_urination',
    labelEn: 'Excessive thirst or frequent urination',
    labelHi: 'अधिक प्यास लगना या बार-बार पेशाब आना',
    isRedFlag: false,
  },
  {
    id: 'pedal_edema',
    labelEn: 'Swelling in feet or ankles',
    labelHi: 'पैरों या टखनों में सूजन',
    isRedFlag: false,
  },
];

export const VILLAGE_CATALOG: string[] = [
  'Rampur',
  'Khairabad',
  'Chandpur',
  'Maholi',
  'Biswan',
  'Sidhauli',
  'Laharpur',
  'Misrikh',
  'Mahmudabad',
  'Hargaon',
  'Kamlapur',
  'Pisawan',
  'Machhrehta',
  'Gondlamau',
  'Sakran',
  'Paharpur',
];

export function formatSymptomLabel(
  symId: string,
  lang: LanguageCode = 'en'
): { label: string; isRedFlag: boolean } {
  const catalogItem = SYMPTOM_CATALOG.find((s) => s.id === symId);
  if (catalogItem) {
    return {
      label: lang === 'hi' ? catalogItem.labelHi : catalogItem.labelEn,
      isRedFlag: catalogItem.isRedFlag,
    };
  }
  if (symId.startsWith('urgent:')) {
    return {
      label: symId.replace(/^urgent:/, '').trim(),
      isRedFlag: true,
    };
  }
  if (symId.startsWith('custom:')) {
    return {
      label: symId.replace(/^custom:/, '').trim(),
      isRedFlag: false,
    };
  }
  return {
    label: symId,
    isRedFlag: false,
  };
}

export const KNOWN_CONDITIONS_CATALOG: { id: string; labelEn: string; labelHi: string }[] = [
  { id: 'Hypertension', labelEn: 'Known Hypertension (High BP)', labelHi: 'उच्च रक्तचाप (हाई बीपी)' },
  { id: 'Diabetes', labelEn: 'Known Diabetes Mellitus', labelHi: 'मधुमेह (शुगर)' },
  { id: 'Anemia', labelEn: 'Prior Anemia History', labelHi: 'एनीमिया (खून की कमी)' },
  { id: 'Respiratory_Asthma', labelEn: 'Chronic Respiratory / Asthma', labelHi: 'दमा / सांस की पुरानी बीमारी' },
  { id: 'Past_TB', labelEn: 'Prior Tuberculosis Treatment', labelHi: 'पूर्व में टीबी का इलाज' },
  { id: 'High_Risk_Pregnancy', labelEn: 'Previous High-Risk Pregnancy', labelHi: 'पूर्व उच्च जोखिम गर्भावस्था' },
];

export const UI_LABELS: Record<
  LanguageCode,
  {
    appName: string;
    appSubtitle: string;
    navHome: string;
    navPatients: string;
    navNewScreening: string;
    navReferrals: string;
    navSettings: string;
    navWorkerDashboard: string;
    navRegisterPatient: string;
    navPhcDashboard: string;
    navSyncPrivacy: string;
    demoBannerText: string;
    prototypeEngineBadge: string;
    onlineStatus: string;
    offlineStatus: string;
    syncingStatus: string;
    syncFailedStatus: string;
    pendingSyncStatus: string;
    syncNowBtn: string;
    simulateOfflineBtn: string;
    simulateOnlineBtn: string;
    switchRoleLabel: string;
    roleHealthWorker: string;
    roleDoctor: string;
    patientRegistrationTitle: string;
    patientScreeningTitle: string;
    followUpQueueTitle: string;
    previousScreeningsTitle: string;
    consentLabel: string;
    disclaimerHeader: string;
    disclaimerBody: string;
    simulatedPhcNotice: string;
    doctorPagesLink: string;
  }
> = {
  en: {
    appName: 'SwasthyaSetu AI',
    appSubtitle: 'Rural Healthcare Screening & Referral',
    navHome: 'Home',
    navPatients: 'Patients',
    navNewScreening: 'New Screening',
    navReferrals: 'Referrals',
    navSettings: 'Settings',
    navWorkerDashboard: 'Home',
    navRegisterPatient: 'Register Patient',
    navPhcDashboard: 'Doctor / PHC Dashboard',
    navSyncPrivacy: 'Settings & Offline Sync',
    demoBannerText: 'Synthetic Demo Dataset Active · No real patient PII is stored.',
    prototypeEngineBadge: 'Prototype Rules Engine v1.0 · Non-Diagnostic Triage',
    onlineStatus: 'Online',
    offlineStatus: 'Offline',
    syncingStatus: 'Syncing',
    syncFailedStatus: 'Sync failed',
    pendingSyncStatus: 'Unsynced',
    syncNowBtn: 'Sync Now',
    simulateOfflineBtn: 'Simulate Offline',
    simulateOnlineBtn: 'Go Online',
    switchRoleLabel: 'Role',
    roleHealthWorker: 'ASHA Worker',
    roleDoctor: 'PHC Doctor',
    patientRegistrationTitle: 'Patient Registration',
    patientScreeningTitle: 'Patient Screening',
    followUpQueueTitle: 'Pending Follow-ups',
    previousScreeningsTitle: 'Recent Screening Results',
    consentLabel: 'I confirm that informed patient consent has been obtained for health screening and PHC referral.',
    disclaimerHeader: 'Clinical Screening Disclaimer (Not a Diagnosis)',
    disclaimerBody:
      'This result is generated by a prototype rule-based screening module to help prioritize care. It is NOT a clinical diagnosis or confirmed medical diagnosis. Urgent cases must always be referred immediately to a qualified doctor.',
    simulatedPhcNotice:
      'PHC Referral Workflow: Referrals are saved in SwasthyaSetu for the PHC team. They are not yet connected to an external hospital or ABDM system.',
    doctorPagesLink: 'Open Dedicated Doctor Pages',
  },
  hi: {
    appName: 'स्वास्थ्यसेतु AI',
    appSubtitle: 'ग्रामीण स्वास्थ्य जांच एवं रेफरल',
    navHome: 'होम (Home)',
    navPatients: 'मरीज (Patients)',
    navNewScreening: 'नई जांच (Screening)',
    navReferrals: 'रेफरल (Referrals)',
    navSettings: 'सेटिंग्स (Settings)',
    navWorkerDashboard: 'होम',
    navRegisterPatient: 'नया मरीज जोड़ें',
    navPhcDashboard: 'डॉक्टर / PHC डैशबोर्ड',
    navSyncPrivacy: 'सेटिंग्स और ऑफलाइन सिंक',
    demoBannerText: 'डेमो डेटा सक्रिय · किसी वास्तविक मरीज की निजी जानकारी नहीं है।',
    prototypeEngineBadge: 'प्रोटोटाइप नियम इंजन v1.0 · गैर-नैदानिक सहायता',
    onlineStatus: 'ऑनलाइन (Online)',
    offlineStatus: 'ऑफलाइन (Offline)',
    syncingStatus: 'सिंक हो रहा है (Syncing)',
    syncFailedStatus: 'सिंक विफल (Sync failed)',
    pendingSyncStatus: 'सिंक बाकी',
    syncNowBtn: 'अभी सिंक करें',
    simulateOfflineBtn: 'ऑफलाइन मोड टेस्ट करें',
    simulateOnlineBtn: 'ऑनलाइन करें',
    switchRoleLabel: 'भूमिका',
    roleHealthWorker: 'आशा कार्यकर्ता',
    roleDoctor: 'PHC डॉक्टर',
    patientRegistrationTitle: 'नया मरीज पंजीकरण',
    patientScreeningTitle: 'मरीज स्वास्थ्य जांच',
    followUpQueueTitle: 'बाकी फॉलो-अप (Pending Follow-ups)',
    previousScreeningsTitle: 'हाल के जांच परिणाम',
    consentLabel: 'स्वास्थ्य जांच और पीएचसी रेफरल के लिए मरीज की सहमति प्राप्त कर ली गई है।',
    disclaimerHeader: 'स्वास्थ्य जांच अस्वीकरण (यह डॉक्टरी निदान नहीं है)',
    disclaimerBody:
      'यह परिणाम केवल देखभाल की प्राथमिकता तय करने के लिए है। यह कोई पक्का डॉक्टरी निदान (Diagnosis) नहीं है। गंभीर लक्षणों वाले मरीजों को तुरंत डॉक्टर के पास भेजें।',
    simulatedPhcNotice:
      'पीएचसी रेफरल: रेफरल स्वास्थ्यसेतु में पीएचसी टीम के लिए सेव होते हैं। यह अभी किसी बाहरी अस्पताल या ABDM सिस्टम से नहीं जुड़ा है।',
    doctorPagesLink: 'डॉक्टर पेज खोलें',
  },
};

export function formatCategoryLabel(category: ScreeningCategory, lang: LanguageCode = 'en'): string {
  const map: Record<ScreeningCategory, { en: string; hi: string }> = {
    incomplete_information: {
      en: 'Information incomplete',
      hi: 'अधूरी जानकारी (Information incomplete)',
    },
    routine_follow_up: {
      en: 'Routine follow-up',
      hi: 'नियमित फॉलो-अप (Routine follow-up)',
    },
    further_assessment_needed: {
      en: 'Medical assessment needed',
      hi: 'चिकित्सा जांच आवश्यक (Assessment needed)',
    },
    urgent_escalation: {
      en: 'Urgent medical assessment',
      hi: 'तत्काल चिकित्सा जांच (Urgent assessment)',
    },
  };
  return map[category]?.[lang] ?? category;
}

export function formatReferralStatus(status: ReferralStatus, lang: LanguageCode = 'en'): string {
  const map: Record<ReferralStatus, { en: string; hi: string }> = {
    pending: { en: 'Pending', hi: 'लंबित (Pending)' },
    acknowledged: { en: 'Acknowledged', hi: 'स्वीकृत (Acknowledged)' },
    under_review: { en: 'Under Review', hi: 'जांच जारी (Under Review)' },
    completed: { en: 'Completed', hi: 'पूर्ण (Completed)' },
    unable_to_complete: { en: 'Unable to Complete', hi: 'अपूर्ण (Unable to Complete)' },
  };
  return map[status]?.[lang] ?? status;
}

export function formatFollowUpStatus(status: FollowUpStatus, lang: LanguageCode = 'en'): string {
  const map: Record<FollowUpStatus, { en: string; hi: string }> = {
    pending: { en: 'Pending', hi: 'लंबित (Pending)' },
    acknowledged: { en: 'Acknowledged', hi: 'स्वीकृत (Acknowledged)' },
    completed: { en: 'Completed', hi: 'पूर्ण (Completed)' },
    overdue: { en: 'Overdue', hi: 'समय-सीमा समाप्त (Overdue)' },
  };
  return map[status]?.[lang] ?? status;
}
