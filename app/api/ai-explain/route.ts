import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import {
  enforceSafetyGuardrailOnAiOutput,
  evaluateScreening,
} from '@/src/lib/screening-engine';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { screeningInput, language = 'en' } = body;

    // 1. Always run deterministic rule engine first
    const deterministicResult = evaluateScreening(screeningInput);

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MY_GEMINI_API_KEY') {
      const fallbackText =
        language === 'hi'
          ? 'आशा कार्यकर्ता मार्गदर्शन: कृपया निर्धारित रेफरल और फॉलो-अप चरणों का पालन करें। यह नियम-आधारित सारांश बिना किसी बाहरी AI मॉडल के भी पूरी तरह कार्यात्मक है।'
          : 'ASHA Counseling Note: Follow the structured next steps above and ensure patient consent is documented before PHC referral.';
      const guarded = enforceSafetyGuardrailOnAiOutput(deterministicResult, fallbackText);
      return NextResponse.json({
        ok: true,
        source: 'deterministic_fallback',
        finalCategory: guarded.finalCategory,
        supplementalNote: guarded.safeSupplementalNote,
      });
    }

    const prompt = `You are assisting an ASHA community health worker in rural India.
A deterministic prototype screening rule engine evaluated a patient screening and returned:
- Workflow Category (LOCKED, DO NOT CHANGE): ${deterministicResult.resultCategory}
- Flagged Reasons: ${deterministicResult.flaggedReasons.map((r) => `${r.titleEn} (${r.observedValue})`).join('; ') || 'None'}
- Missing Measurements: ${deterministicResult.missingFields.join(', ') || 'None'}

Write a brief, plain-language 2-sentence communication tip in ${language === 'hi' ? 'Hindi (with simple terms)' : 'English'} helping the ASHA worker explain why this follow-up or PHC referral step is important to the patient and family.
Rules:
- NEVER diagnose any condition or prescribe medication.
- NEVER contradict or downgrade the locked workflow category (${deterministicResult.resultCategory}).`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
    });

    const rawText = response.text || '';
    const guarded = enforceSafetyGuardrailOnAiOutput(deterministicResult, rawText);

    return NextResponse.json({
      ok: true,
      source: 'gemini_guarded',
      finalCategory: guarded.finalCategory,
      supplementalNote: guarded.safeSupplementalNote,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'AI explanation service unavailable';
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
