import { z } from 'zod';
import {
  CbacEvaluation,
  CbacInput,
  FlaggedReason,
  RecommendedStep,
  ScreeningCategory,
  ScreeningEvaluationResult,
  ScreeningInput,
} from './types';
import { SYMPTOM_CATALOG, UI_LABELS } from './i18n';

export const PROTOTYPE_ENGINE_VERSION = 'PROTOTYPE-RULES-v1.0';

/**
 * Generates a deterministic 14-digit ABHA-style Health Account ID (91-XXXX-XXXX-XXXX)
 * from any patient identifier so offline and online devices display the exact same ID.
 */
export function formatAbhaId(patientId: string): string {
  let hash = 2166136261;
  const clean = (patientId || 'PAT-0000').trim().toUpperCase();
  for (let i = 0; i < clean.length; i++) {
    hash ^= clean.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const positive = Math.abs(hash >>> 0);
  const digits = String(positive).padStart(12, '4').slice(0, 12);
  return `91-${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}`;
}

/**
 * Evaluates the MoHFW Community Based Assessment Checklist (CBAC) 0–10 NCD Risk Score.
 * A total score > 4 indicates elevated risk requiring priority NCD screening at the PHC.
 */
export function evaluateCbacScore(cbac?: CbacInput): CbacEvaluation {
  if (!cbac) {
    return {
      totalScore: 0,
      isHighNcdRisk: false,
      riskLabelEn: 'Low NCD Risk (Score 0/10)',
      riskLabelHi: 'कम एनसीडी जोखिम (स्कोर 0/10)',
    };
  }
  const totalScore =
    (cbac.ageScore || 0) +
    (cbac.tobaccoScore || 0) +
    (cbac.alcoholScore || 0) +
    (cbac.waistScore || 0) +
    (cbac.physicalActivityScore || 0) +
    (cbac.familyHistoryScore || 0);
  const isHighNcdRisk = totalScore > 4;
  return {
    totalScore,
    isHighNcdRisk,
    riskLabelEn: isHighNcdRisk
      ? `High NCD Risk (CBAC Score ${totalScore}/10 > 4 — Refer to Weekly PHC NCD Day)`
      : `Routine NCD Risk (CBAC Score ${totalScore}/10 ≤ 4)`,
    riskLabelHi: isHighNcdRisk
      ? `उच्च एनसीडी जोखिम (CBAC स्कोर ${totalScore}/10 > 4 — साप्ताहिक पीएचसी एनसीडी जांच आवश्यक)`
      : `सामान्य एनसीडी जोखिम (CBAC स्कोर ${totalScore}/10 ≤ 4)`,
  };
}

export const patientRegistrationSchema = z.object({
  patientId: z
    .string()
    .trim()
    .regex(/^PAT-[A-Z0-9-]+$/, 'Patient ID must follow format PAT-XXX-0000'),
  fullName: z.string().trim().min(2, 'Patient name must be at least 2 characters').max(80),
  ageYears: z.number().int().min(1, 'Age must be between 1 and 115 years').max(115),
  sex: z.enum(['female', 'male', 'other']),
  village: z.string().trim().min(2, 'Village name is required').max(60),
  blockName: z.string().trim().min(2, 'Block name is required').max(60),
  phoneLastFour: z
    .string()
    .trim()
    .regex(/^\d{4}$/, 'Enter only the last 4 digits of phone for privacy minimization'),
  consentObtained: z
    .boolean()
    .refine((val) => val === true, {
      message: 'Informed patient consent is required before saving health records',
    }),
  knownConditions: z.array(z.string()).default([]),
});

export function evaluateScreening(input: ScreeningInput): ScreeningEvaluationResult {
  const validationErrors: { field: string; messageEn: string; messageHi: string }[] = [];

  if (!input.patientId || input.patientId.trim().length < 3) {
    validationErrors.push({
      field: 'patientId',
      messageEn: 'Valid Patient ID is required.',
      messageHi: 'मान्य मरीज आईडी आवश्यक है।',
    });
  }

  // Validate physiologic bounds for provided measurements
  if (input.systolicBp !== null && input.systolicBp !== undefined) {
    if (
      typeof input.systolicBp !== 'number' ||
      Number.isNaN(input.systolicBp) ||
      input.systolicBp < 50 ||
      input.systolicBp > 260
    ) {
      validationErrors.push({
        field: 'systolicBp',
        messageEn: 'Systolic BP must be between 50 and 260 mmHg.',
        messageHi: 'सिस्टोलिक बीपी 50 और 260 mmHg के बीच होना चाहिए।',
      });
    }
  }

  if (input.diastolicBp !== null && input.diastolicBp !== undefined) {
    if (
      typeof input.diastolicBp !== 'number' ||
      Number.isNaN(input.diastolicBp) ||
      input.diastolicBp < 30 ||
      input.diastolicBp > 160
    ) {
      validationErrors.push({
        field: 'diastolicBp',
        messageEn: 'Diastolic BP must be between 30 and 160 mmHg.',
        messageHi: 'डायस्टोलिक बीपी 30 और 160 mmHg के बीच होना चाहिए।',
      });
    }
  }

  if (
    input.systolicBp !== null &&
    input.systolicBp !== undefined &&
    input.diastolicBp !== null &&
    input.diastolicBp !== undefined &&
    !Number.isNaN(input.systolicBp) &&
    !Number.isNaN(input.diastolicBp) &&
    input.diastolicBp >= input.systolicBp
  ) {
    validationErrors.push({
      field: 'bloodPressure',
      messageEn: 'Systolic BP must be strictly greater than Diastolic BP.',
      messageHi: 'सिस्टोलिक बीपी डायस्टोलिक बीपी से अधिक होना चाहिए।',
    });
  }

  if (input.spo2Percent !== null && input.spo2Percent !== undefined) {
    if (
      typeof input.spo2Percent !== 'number' ||
      Number.isNaN(input.spo2Percent) ||
      input.spo2Percent < 50 ||
      input.spo2Percent > 100
    ) {
      validationErrors.push({
        field: 'spo2Percent',
        messageEn: 'Oxygen saturation (SpO2) must be between 50% and 100%.',
        messageHi: 'ऑक्सीजन स्तर (SpO2) 50% और 100% के बीच होना चाहिए।',
      });
    }
  }

  if (input.temperatureC !== null && input.temperatureC !== undefined) {
    if (
      typeof input.temperatureC !== 'number' ||
      Number.isNaN(input.temperatureC) ||
      input.temperatureC < 33.0 ||
      input.temperatureC > 43.0
    ) {
      validationErrors.push({
        field: 'temperatureC',
        messageEn: 'Body temperature must be between 33.0 °C and 43.0 °C.',
        messageHi: 'शरीर का तापमान 33.0 °C और 43.0 °C के बीच होना चाहिए।',
      });
    }
  }

  if (input.heartRateBpm !== null && input.heartRateBpm !== undefined) {
    if (
      typeof input.heartRateBpm !== 'number' ||
      Number.isNaN(input.heartRateBpm) ||
      input.heartRateBpm < 30 ||
      input.heartRateBpm > 240
    ) {
      validationErrors.push({
        field: 'heartRateBpm',
        messageEn: 'Heart rate must be between 30 and 240 bpm.',
        messageHi: 'हृदय गति 30 और 240 प्रति मिनट के बीच होनी चाहिए।',
      });
    }
  }

  if (input.randomBloodGlucoseMgDl !== null && input.randomBloodGlucoseMgDl !== undefined) {
    if (
      typeof input.randomBloodGlucoseMgDl !== 'number' ||
      Number.isNaN(input.randomBloodGlucoseMgDl) ||
      input.randomBloodGlucoseMgDl < 20 ||
      input.randomBloodGlucoseMgDl > 650
    ) {
      validationErrors.push({
        field: 'randomBloodGlucoseMgDl',
        messageEn: 'Random blood glucose must be between 20 and 650 mg/dL.',
        messageHi: 'रैंडम ब्लड शुगर 20 और 650 mg/dL के बीच होना चाहिए।',
      });
    }
  }

  if (input.hemoglobinGDl !== null && input.hemoglobinGDl !== undefined) {
    if (
      typeof input.hemoglobinGDl !== 'number' ||
      Number.isNaN(input.hemoglobinGDl) ||
      input.hemoglobinGDl < 3.0 ||
      input.hemoglobinGDl > 22.0
    ) {
      validationErrors.push({
        field: 'hemoglobinGDl',
        messageEn: 'Hemoglobin must be between 3.0 and 22.0 g/dL.',
        messageHi: 'हीमोग्लोबिन 3.0 और 22.0 g/dL के बीच होना चाहिए।',
      });
    }
  }

  if (input.respiratoryRateBpm !== null && input.respiratoryRateBpm !== undefined) {
    if (
      typeof input.respiratoryRateBpm !== 'number' ||
      Number.isNaN(input.respiratoryRateBpm) ||
      input.respiratoryRateBpm < 6 ||
      input.respiratoryRateBpm > 70
    ) {
      validationErrors.push({
        field: 'respiratoryRateBpm',
        messageEn: 'Respiratory rate must be between 6 and 70 breaths/min.',
        messageHi: 'श्वसन दर 6 और 70 प्रति मिनट के बीच होनी चाहिए।',
      });
    }
  }

  if (input.symptomDurationDays < 0 || input.symptomDurationDays > 365) {
    validationErrors.push({
      field: 'symptomDurationDays',
      messageEn: 'Symptom duration must be between 0 and 365 days.',
      messageHi: 'लक्षणों की अवधि 0 से 365 दिनों के बीच होनी चाहिए।',
    });
  }

  if (validationErrors.length > 0) {
    return {
      isValid: false,
      validationErrors,
      resultCategory: 'incomplete_information',
      missingFields: [],
      flaggedReasons: [],
      recommendedNextSteps: [],
      requiresReferral: false,
      requiresFollowUp: false,
      suggestedFollowUpDays: 0,
      disclaimerEn: UI_LABELS.en.disclaimerBody,
      disclaimerHi: UI_LABELS.hi.disclaimerBody,
      engineVersion: PROTOTYPE_ENGINE_VERSION,
    };
  }

  // Check for missing core measurements (never interpret missing data as normal)
  const missingFields: string[] = [];
  if (input.systolicBp === null || input.systolicBp === undefined) {
    missingFields.push('systolicBp');
  }
  if (input.diastolicBp === null || input.diastolicBp === undefined) {
    missingFields.push('diastolicBp');
  }
  if (input.temperatureC === null || input.temperatureC === undefined) {
    missingFields.push('temperatureC');
  }
  if (input.spo2Percent === null || input.spo2Percent === undefined) {
    missingFields.push('spo2Percent');
  }
  if (input.isPregnant && (input.gestationalWeeks === null || input.gestationalWeeks === undefined)) {
    missingFields.push('gestationalWeeks');
  }

  const flaggedReasons: FlaggedReason[] = [];

  // 1. Evaluate Red-Flag Symptoms
  const selectedSymptoms = input.symptoms || [];
  for (const symId of selectedSymptoms) {
    const catalogItem = SYMPTOM_CATALOG.find((s) => s.id === symId);
    if (catalogItem && catalogItem.isRedFlag) {
      flaggedReasons.push({
        code: `RED_FLAG_${symId.toUpperCase()}`,
        field: 'symptoms',
        severity: 'urgent',
        titleEn: `Red-flag symptom reported: ${catalogItem.labelEn}`,
        titleHi: `गंभीर खतरे का लक्षण: ${catalogItem.labelHi}`,
        explanationEn:
          'Presence of a clinical danger sign requires immediate medical officer evaluation at the nearest Primary Healthcare Centre.',
        explanationHi:
          'खतरे के लक्षण दिखने पर तुरंत प्राथमिक स्वास्थ्य केंद्र (PHC) के चिकित्सा अधिकारी द्वारा जांच आवश्यक है।',
        observedValue: catalogItem.labelEn,
        referenceRule: 'Prototype Frontline Red-Flag Escalation Rule #RF-01',
      });
    }
  }

  // 2. Evaluate Blood Pressure
  if (input.systolicBp != null && input.diastolicBp != null) {
    const bpString = `${input.systolicBp}/${input.diastolicBp} mmHg`;
    if (input.systolicBp >= 180 || input.diastolicBp >= 110) {
      flaggedReasons.push({
        code: 'BP_URGENT_ELEVATION',
        field: 'bloodPressure',
        severity: 'urgent',
        titleEn: 'Severely elevated blood pressure reading',
        titleHi: 'रक्तचाप (BP) में अत्यधिक वृद्धि',
        explanationEn: `Recorded blood pressure (${bpString}) exceeds the prototype critical threshold (≥180/110 mmHg). Immediate PHC evaluation is required.`,
        explanationHi: `दर्ज रक्तचाप (${bpString}) गंभीर सीमा (≥180/110 mmHg) से अधिक है। तत्काल पीएचसी रेफरल आवश्यक है।`,
        observedValue: bpString,
        referenceRule: 'Prototype NPCDCS Triage Rule #BP-URG',
      });
    } else if (input.systolicBp < 90 || input.diastolicBp < 60) {
      flaggedReasons.push({
        code: 'BP_HYPOTENSION_ALERT',
        field: 'bloodPressure',
        severity: 'urgent',
        titleEn: 'Low blood pressure (hypotension threshold)',
        titleHi: 'निम्न रक्तचाप (Low BP) चेतावनी',
        explanationEn: `Recorded blood pressure (${bpString}) is below 90/60 mmHg. Assess for shock, dehydration, or acute illness at PHC.`,
        explanationHi: `दर्ज रक्तचाप (${bpString}) 90/60 mmHg से कम है। तुरंत डॉक्टर से जांच कराएं।`,
        observedValue: bpString,
        referenceRule: 'Prototype Vitals Triage Rule #BP-LOW',
      });
    } else if (input.isPregnant && (input.systolicBp >= 140 || input.diastolicBp >= 90)) {
      flaggedReasons.push({
        code: 'MATERNAL_HYPERTENSION_URGENT',
        field: 'bloodPressure',
        severity: 'urgent',
        titleEn: 'Elevated blood pressure during pregnancy',
        titleHi: 'गर्भावस्था में उच्च रक्तचाप (High BP)',
        explanationEn: `Pregnant patient with BP ${bpString} (≥140/90 mmHg) requires urgent maternal assessment to rule out pre-eclampsia.`,
        explanationHi: `गर्भवती महिला में बीपी ${bpString} (≥140/90 mmHg) होने पर तुरंत पीएचसी में मातृ स्वास्थ्य जांच आवश्यक है।`,
        observedValue: bpString,
        referenceRule: 'Prototype Maternal Safety Rule #MAT-BP',
      });
    } else if (input.systolicBp >= 140 || input.diastolicBp >= 90) {
      flaggedReasons.push({
        code: 'BP_FURTHER_ASSESSMENT',
        field: 'bloodPressure',
        severity: 'moderate',
        titleEn: 'Elevated blood pressure requiring medical assessment',
        titleHi: 'बढ़ा हुआ रक्तचाप — डॉक्टर की जांच आवश्यक',
        explanationEn: `Recorded blood pressure (${bpString}) is at or above 140/90 mmHg. Repeat measurement after rest and refer to PHC doctor for confirmation.`,
        explanationHi: `दर्ज रक्तचाप (${bpString}) 140/90 mmHg या अधिक है। पीएचसी डॉक्टर द्वारा जांच हेतु रेफर करें।`,
        observedValue: bpString,
        referenceRule: 'Prototype NPCDCS Screening Rule #BP-MOD',
      });
    }
  }

  // 3. Evaluate Oxygen Saturation (SpO2)
  if (input.spo2Percent != null) {
    if (input.spo2Percent < 92) {
      flaggedReasons.push({
        code: 'SPO2_CRITICAL_HYPOXIA',
        field: 'spo2Percent',
        severity: 'urgent',
        titleEn: 'Critical low oxygen saturation (SpO2 < 92%)',
        titleHi: 'ऑक्सीजन स्तर में गंभीर कमी (SpO2 < 92%)',
        explanationEn: `SpO2 reading of ${input.spo2Percent}% indicates potential hypoxemia requiring immediate supplemental oxygen evaluation and referral.`,
        explanationHi: `SpO2 ${input.spo2Percent}% होना गंभीर स्थिति दर्शाता है। तुरंत अस्पताल/पीएचसी रेफर करें।`,
        observedValue: `${input.spo2Percent}%`,
        referenceRule: 'Prototype Respiratory Triage Rule #OX-URG',
      });
    } else if (input.spo2Percent <= 94) {
      flaggedReasons.push({
        code: 'SPO2_MODERATE_DROP',
        field: 'spo2Percent',
        severity: 'moderate',
        titleEn: 'Borderline oxygen saturation (92%–94%)',
        titleHi: 'ऑक्सीजन स्तर सामान्य से कम (92%–94%)',
        explanationEn: `SpO2 of ${input.spo2Percent}% warrants prompt medical assessment by a PHC physician.`,
        explanationHi: `SpO2 ${input.spo2Percent}% होने पर पीएचसी डॉक्टर से जांच आवश्यक है।`,
        observedValue: `${input.spo2Percent}%`,
        referenceRule: 'Prototype Respiratory Triage Rule #OX-MOD',
      });
    }
  }

  // 4. Evaluate Temperature
  if (input.temperatureC != null) {
    if (input.temperatureC >= 39.5) {
      flaggedReasons.push({
        code: 'TEMP_HIGH_FEVER_URGENT',
        field: 'temperatureC',
        severity: 'urgent',
        titleEn: 'Very high fever (≥ 39.5 °C)',
        titleHi: 'अत्यधिक तेज बुखार (≥ 39.5 °C)',
        explanationEn: `Body temperature of ${input.temperatureC.toFixed(1)} °C requires urgent clinical evaluation for acute systemic infection.`,
        explanationHi: `शरीर का तापमान ${input.temperatureC.toFixed(1)} °C है। तुरंत डॉक्टर से जांच आवश्यक है।`,
        observedValue: `${input.temperatureC.toFixed(1)} °C`,
        referenceRule: 'Prototype Febrile Triage Rule #TMP-URG',
      });
    } else if (input.temperatureC >= 38.0) {
      flaggedReasons.push({
        code: 'TEMP_FEVER_ASSESSMENT',
        field: 'temperatureC',
        severity: 'moderate',
        titleEn: 'Elevated body temperature (Fever ≥ 38.0 °C)',
        titleHi: 'बुखार (तापमान ≥ 38.0 °C)',
        explanationEn: `Temperature of ${input.temperatureC.toFixed(1)} °C indicates fever requiring medical assessment and vector-borne/infectious workup.`,
        explanationHi: `तापमान ${input.temperatureC.toFixed(1)} °C होने पर बुखार की जांच हेतु पीएचसी दिखाएं।`,
        observedValue: `${input.temperatureC.toFixed(1)} °C`,
        referenceRule: 'Prototype Febrile Triage Rule #TMP-MOD',
      });
    }
  }

  // 5. Evaluate Random Blood Glucose (optional field when glucometer available)
  if (input.randomBloodGlucoseMgDl != null) {
    if (input.randomBloodGlucoseMgDl >= 300 || input.randomBloodGlucoseMgDl < 70) {
      flaggedReasons.push({
        code: 'GLUCOSE_CRITICAL',
        field: 'randomBloodGlucoseMgDl',
        severity: 'urgent',
        titleEn:
          input.randomBloodGlucoseMgDl < 70
            ? 'Low blood glucose (Hypoglycemia alert < 70 mg/dL)'
            : 'Severely elevated random blood glucose (≥ 300 mg/dL)',
        titleHi:
          input.randomBloodGlucoseMgDl < 70
            ? 'ब्लड शुगर अत्यधिक कम (< 70 mg/dL)'
            : 'ब्लड शुगर अत्यधिक अधिक (≥ 300 mg/dL)',
        explanationEn: `Random blood glucose of ${input.randomBloodGlucoseMgDl} mg/dL requires urgent clinical management.`,
        explanationHi: `रैंडम ब्लड शुगर ${input.randomBloodGlucoseMgDl} mg/dL होने पर तत्काल चिकित्सा सहायता आवश्यक है।`,
        observedValue: `${input.randomBloodGlucoseMgDl} mg/dL`,
        referenceRule: 'Prototype Metabolic Triage Rule #GLU-URG',
      });
    } else if (input.randomBloodGlucoseMgDl >= 200) {
      flaggedReasons.push({
        code: 'GLUCOSE_ELEVATED',
        field: 'randomBloodGlucoseMgDl',
        severity: 'moderate',
        titleEn: 'Elevated random blood glucose (≥ 200 mg/dL)',
        titleHi: 'बढ़ा हुआ ब्लड शुगर (≥ 200 mg/dL)',
        explanationEn: `Random blood glucose of ${input.randomBloodGlucoseMgDl} mg/dL requires fasting laboratory confirmation and physician review at PHC.`,
        explanationHi: `रैंडम ब्लड शुगर ${input.randomBloodGlucoseMgDl} mg/dL है। पीएचसी में खाली पेट जांच के लिए रेफर करें।`,
        observedValue: `${input.randomBloodGlucoseMgDl} mg/dL`,
        referenceRule: 'Prototype NPCDCS Diabetes Screening Rule #GLU-MOD',
      });
    }
  }

  // 6. Evaluate Hemoglobin (optional field when hemoglobinometer available)
  if (input.hemoglobinGDl != null) {
    if (input.hemoglobinGDl < 7.0) {
      flaggedReasons.push({
        code: 'HB_SEVERE_ANEMIA',
        field: 'hemoglobinGDl',
        severity: 'urgent',
        titleEn: 'Critically low hemoglobin (< 7.0 g/dL)',
        titleHi: 'हीमोग्लोबिन में गंभीर कमी (< 7.0 g/dL)',
        explanationEn: `Hemoglobin of ${input.hemoglobinGDl} g/dL meets the prototype threshold for urgent severe anemia referral.`,
        explanationHi: `हीमोग्लोबिन ${input.hemoglobinGDl} g/dL अत्यंत कम है। तुरंत पीएचसी रेफरल आवश्यक है।`,
        observedValue: `${input.hemoglobinGDl} g/dL`,
        referenceRule: 'Prototype Anemia Mukt Bharat Rule #HB-URG',
      });
    } else if (input.hemoglobinGDl < 10.0) {
      flaggedReasons.push({
        code: 'HB_MODERATE_ANEMIA',
        field: 'hemoglobinGDl',
        severity: 'moderate',
        titleEn: 'Low hemoglobin (< 10.0 g/dL)',
        titleHi: 'कम हीमोग्लोबिन (< 10.0 g/dL)',
        explanationEn: `Hemoglobin of ${input.hemoglobinGDl} g/dL warrants medical officer assessment and supplementation plan.`,
        explanationHi: `हीमोग्लोबिन ${input.hemoglobinGDl} g/dL कम है। आयरन उपचार और डॉक्टर की सलाह हेतु रेफर करें।`,
        observedValue: `${input.hemoglobinGDl} g/dL`,
        referenceRule: 'Prototype Anemia Mukt Bharat Rule #HB-MOD',
      });
    }
  }

  // 7. Evaluate Heart Rate & Respiratory Rate
  if (input.heartRateBpm != null && (input.heartRateBpm > 120 || input.heartRateBpm < 50)) {
    flaggedReasons.push({
      code: 'HEART_RATE_ABNORMAL',
      field: 'heartRateBpm',
      severity: input.heartRateBpm >= 140 || input.heartRateBpm < 45 ? 'urgent' : 'moderate',
      titleEn: `Abnormal pulse rate (${input.heartRateBpm} bpm)`,
      titleHi: `असामान्य नाड़ी गति (${input.heartRateBpm} bpm)`,
      explanationEn: `Pulse rate of ${input.heartRateBpm} bpm is outside standard resting bounds (50–120 bpm).`,
      explanationHi: `नाड़ी की गति ${input.heartRateBpm} प्रति मिनट सामान्य सीमा से बाहर है।`,
      observedValue: `${input.heartRateBpm} bpm`,
      referenceRule: 'Prototype Vitals Rule #HR-01',
    });
  }

  if (input.respiratoryRateBpm != null && input.respiratoryRateBpm >= 30) {
    flaggedReasons.push({
      code: 'RESP_RATE_URGENT',
      field: 'respiratoryRateBpm',
      severity: 'urgent',
      titleEn: `Rapid respiratory rate (${input.respiratoryRateBpm} breaths/min)`,
      titleHi: `तेज श्वसन दर (${input.respiratoryRateBpm} प्रति मिनट)`,
      explanationEn: 'Respiratory rate ≥ 30 breaths/min indicates significant respiratory distress.',
      explanationHi: 'श्वसन दर 30 प्रति मिनट या अधिक होना सांस की गंभीर तकलीफ दर्शाता है।',
      observedValue: `${input.respiratoryRateBpm}/min`,
      referenceRule: 'Prototype Respiratory Rule #RR-URG',
    });
  }

  // 8. Evaluate Moderate Symptoms & Prolonged Duration
  const nonRedFlagSymptoms = selectedSymptoms.filter((id) => {
    const item = SYMPTOM_CATALOG.find((s) => s.id === id);
    return item && !item.isRedFlag;
  });

  if (selectedSymptoms.includes('persistent_cough_2w') || (input.symptomDurationDays >= 14 && nonRedFlagSymptoms.length > 0)) {
    flaggedReasons.push({
      code: 'PROLONGED_SYMPTOMS_2W',
      field: 'symptoms',
      severity: 'moderate',
      titleEn: 'Symptoms persisting for 14 days or longer',
      titleHi: '14 दिनों या अधिक समय से लगातार लक्षण',
      explanationEn: `Symptom duration of ${Math.max(input.symptomDurationDays, 14)} days requires PHC diagnostic workup (including sputum/infectious screening where indicated).`,
      explanationHi: `${Math.max(input.symptomDurationDays, 14)} दिनों से लक्षण बने रहने पर पीएचसी में बलगम व अन्य जांच आवश्यक है।`,
      observedValue: `${Math.max(input.symptomDurationDays, 14)} days`,
      referenceRule: 'Prototype Respiratory/Infectious Rule #SYM-14D',
    });
  } else if (nonRedFlagSymptoms.length >= 2) {
    const names = nonRedFlagSymptoms
      .map((id) => SYMPTOM_CATALOG.find((s) => s.id === id)?.labelEn || id)
      .join(', ');
    flaggedReasons.push({
      code: 'MULTIPLE_SYMPTOMS_MODERATE',
      field: 'symptoms',
      severity: 'moderate',
      titleEn: 'Multiple clinical symptoms reported',
      titleHi: 'एक से अधिक स्वास्थ्य लक्षण दर्ज',
      explanationEn: `Patient reported multiple symptoms (${names}) requiring medical officer evaluation.`,
      explanationHi: `मरीज में एक से अधिक लक्षण (${names}) पाए गए हैं जिनकी डॉक्टर द्वारा जांच आवश्यक है।`,
      observedValue: `${nonRedFlagSymptoms.length} symptoms`,
      referenceRule: 'Prototype Multi-Symptom Rule #SYM-MOD',
    });
  }

  // 8b. Evaluate MoHFW CBAC NCD Risk Score (when provided)
  const cbacEvaluation = input.cbacInput ? evaluateCbacScore(input.cbacInput) : undefined;
  if (cbacEvaluation && cbacEvaluation.isHighNcdRisk) {
    flaggedReasons.push({
      code: 'CBAC_NCD_HIGH_RISK',
      field: 'cbacScore',
      severity: 'moderate',
      titleEn: `Elevated CBAC NCD Risk Score (${cbacEvaluation.totalScore}/10)`,
      titleHi: `उच्च CBAC एनसीडी जोखिम स्कोर (${cbacEvaluation.totalScore}/10)`,
      explanationEn: `CBAC score of ${cbacEvaluation.totalScore}/10 exceeds threshold (>4). Beneficiary should attend the weekly PHC NCD screening clinic for hypertension, diabetes, and cancer prevention assessment.`,
      explanationHi: `CBAC स्कोर ${cbacEvaluation.totalScore}/10 (>4) होने पर साप्ताहिक पीएचसी एनसीडी क्लिनिक में बीपी, शुगर और निवारक जांच आवश्यक है।`,
      observedValue: `CBAC ${cbacEvaluation.totalScore}/10`,
      referenceRule: 'Prototype CPHC-NCD CBAC Rule #CBAC-04',
    });
  }

  // Record missing fields explicitly as reasons so missing data is never hidden
  if (missingFields.length > 0) {
    flaggedReasons.push({
      code: 'CORE_VITALS_MISSING',
      field: missingFields.join(', '),
      severity: 'missing',
      titleEn: `Missing required screening measurements: ${missingFields.join(', ')}`,
      titleHi: `आवश्यक जांच माप अधूरे हैं: ${missingFields.join(', ')}`,
      explanationEn:
        'Missing measurements are never interpreted as normal. Capture all core vitals (BP, SpO2, Temperature) to complete baseline screening.',
      explanationHi:
        'अधूरे माप को सामान्य नहीं माना जा सकता। पूरी जांच के लिए कृपया छूटे हुए माप (BP, SpO2, तापमान) दर्ज करें।',
      observedValue: `Missing: ${missingFields.join(', ')}`,
      referenceRule: 'Prototype Data Completeness Safety Rule #SAFE-MISSING',
    });
  }

  // Determine overall workflow state according to safety hierarchy:
  // 1. Urgent escalation ALWAYS takes top priority (even if another field is missing)
  // 2. If no urgent flags, any missing core field results in 'incomplete_information'
  // 3. Otherwise, any moderate flag results in 'further_assessment_needed'
  // 4. Otherwise, 'routine_follow_up'
  const hasUrgent = flaggedReasons.some((r) => r.severity === 'urgent');
  const hasModerate = flaggedReasons.some((r) => r.severity === 'moderate');

  let resultCategory: ScreeningCategory = 'routine_follow_up';
  if (hasUrgent) {
    resultCategory = 'urgent_escalation';
  } else if (missingFields.length > 0) {
    resultCategory = 'incomplete_information';
  } else if (hasModerate) {
    resultCategory = 'further_assessment_needed';
  } else {
    resultCategory = 'routine_follow_up';
  }

  const recommendedNextSteps: RecommendedStep[] = buildRecommendedSteps(resultCategory, missingFields);

  const suggestedFollowUpDays =
    resultCategory === 'urgent_escalation'
      ? 1
      : resultCategory === 'incomplete_information'
        ? 2
        : resultCategory === 'further_assessment_needed'
          ? 7
          : 30;

  return {
    isValid: true,
    validationErrors: [],
    resultCategory,
    missingFields,
    flaggedReasons,
    recommendedNextSteps,
    requiresReferral:
      resultCategory === 'urgent_escalation' || resultCategory === 'further_assessment_needed',
    requiresFollowUp: true,
    suggestedFollowUpDays,
    disclaimerEn: UI_LABELS.en.disclaimerBody,
    disclaimerHi: UI_LABELS.hi.disclaimerBody,
    engineVersion: PROTOTYPE_ENGINE_VERSION,
    cbacEvaluation,
  };
}

function buildRecommendedSteps(category: ScreeningCategory, missingFields: string[]): RecommendedStep[] {
  switch (category) {
    case 'urgent_escalation':
      return [
        {
          stepOrder: 1,
          actionEn:
            'Generate an Urgent PHC Referral immediately and arrange transport/accompaniment to the nearest Primary Healthcare Centre.',
          actionHi:
            'तुरंत अर्जेंट पीएचसी रेफरल बनाएं और मरीज को निकटतम प्राथमिक स्वास्थ्य केंद्र पहुंचाने की व्यवस्था करें।',
          timeframeEn: 'Immediate (Within 2–4 hours)',
          timeframeHi: 'तत्काल (2–4 घंटे के भीतर)',
        },
        {
          stepOrder: 2,
          actionEn:
            'Keep the patient resting comfortably and share the printed/digital screening summary with the PHC Medical Officer.',
          actionHi:
            'मरीज को आराम की स्थिति में रखें और जांच का विवरण पीएचसी डॉक्टर के साथ साझा करें।',
          timeframeEn: 'During transit',
          timeframeHi: 'रेफरल के दौरान',
        },
        {
          stepOrder: 3,
          actionEn: 'Schedule an ASHA home follow-up check within 24–48 hours to confirm PHC attendance.',
          actionHi: 'पीएचसी जांच की पुष्टि के लिए 24–48 घंटे के भीतर आशा फॉलो-अप तय करें।',
          timeframeEn: 'Within 24–48 hours',
          timeframeHi: '24–48 घंटे के भीतर',
        },
      ];
    case 'incomplete_information':
      return [
        {
          stepOrder: 1,
          actionEn: `Obtain the missing screening measurements (${missingFields.join(', ')}) using calibrated kit instruments.`,
          actionHi: `छूटे हुए आवश्यक माप (${missingFields.join(', ')}) जांच किट की सहायता से दर्ज करें।`,
          timeframeEn: 'Within 24–48 hours',
          timeframeHi: '24–48 घंटे के भीतर',
        },
        {
          stepOrder: 2,
          actionEn:
            'Do not reassure the patient that vitals are normal until all required measurements are completed.',
          actionHi:
            'जब तक सभी आवश्यक माप पूरे न हों, तब तक जांच को सामान्य न मानें।',
          timeframeEn: 'Immediate guidance',
          timeframeHi: 'तत्काल निर्देश',
        },
      ];
    case 'further_assessment_needed':
      return [
        {
          stepOrder: 1,
          actionEn:
            'Create a PHC Referral for non-emergency medical officer assessment and confirmatory laboratory testing.',
          actionHi:
            'पीएचसी डॉक्टर द्वारा जांच और लैब टेस्ट की पुष्टि के लिए रेफरल जनरेट करें।',
          timeframeEn: 'Within 3–7 days',
          timeframeHi: '3–7 दिनों के भीतर',
        },
        {
          stepOrder: 2,
          actionEn:
            'Record a 7-day follow-up reminder to verify whether the patient visited the PHC and received a treatment plan.',
          actionHi:
            'मरीज पीएचसी गया या नहीं, इसकी पुष्टि के लिए 7 दिन बाद का फॉलो-अप रिकॉर्ड करें।',
          timeframeEn: 'Within 7 days',
          timeframeHi: '7 दिनों के भीतर',
        },
      ];
    case 'routine_follow_up':
    default:
      return [
        {
          stepOrder: 1,
          actionEn:
            'Continue routine community health counseling (balanced nutrition, hydration, salt/sugar moderation, and symptom awareness).',
          actionHi:
            'नियमित स्वास्थ्य परामर्श दें (संतुलित आहार, स्वच्छ जल, नमक/चीनी नियंत्रण और लक्षणों के प्रति जागरूकता)।',
          timeframeEn: 'During current visit',
          timeframeHi: 'वर्तमान भेंट के दौरान',
        },
        {
          stepOrder: 2,
          actionEn: 'Schedule next routine community screening check in 30 days or earlier if new symptoms appear.',
          actionHi: '30 दिनों के बाद अगली नियमित जांच तय करें, या नए लक्षण दिखने पर पहले संपर्क करें।',
          timeframeEn: 'In 30 days',
          timeframeHi: '30 दिनों में',
        },
      ];
  }
}

/**
 * Safety Guardrail: Ensures an external AI language model can NEVER downgrade or override
 * deterministic workflow categories (especially 'urgent_escalation' or 'incomplete_information')
 * or claim a clinical diagnosis.
 */
export function enforceSafetyGuardrailOnAiOutput(
  deterministicEvaluation: ScreeningEvaluationResult,
  aiCandidateNote: string,
  aiAttemptedCategoryOverride?: ScreeningCategory
): {
  finalCategory: ScreeningCategory;
  safeSupplementalNote: string;
  overrideBlocked: boolean;
} {
  const overrideBlocked =
    aiAttemptedCategoryOverride !== undefined &&
    aiAttemptedCategoryOverride !== deterministicEvaluation.resultCategory;

  // Strip any language that claims a definitive medical diagnosis
  const sanitizedNote = aiCandidateNote
    .replace(/\b(diagnosed with|definitive diagnosis|confirmed diagnosis)\b/gi, 'screened with indicators for')
    .trim();

  const prefix =
    '[Prototype AI Communication Aid — Non-Diagnostic, Subordinate to Deterministic Rules]: ';

  return {
    // NEVER allow AI to change the deterministic resultCategory
    finalCategory: deterministicEvaluation.resultCategory,
    safeSupplementalNote: sanitizedNote ? `${prefix}${sanitizedNote}` : '',
    overrideBlocked,
  };
}
