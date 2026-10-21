import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import {
  enforceSafetyGuardrailOnAiOutput,
  evaluateScreening,
} from '@/src/lib/screening-engine';
import { checkRateLimit, getClientIp, rateLimitHeaders } from '@/src/lib/rate-limit';
import {
  REQUEST_ID_HEADER,
  elapsedMs,
  getOrCreateRequestId,
  logRequest,
} from '@/src/lib/request-id';

/**
 * Gemini is used ONLY for a supplemental counselling note. The triage
 * category always comes from the deterministic screening engine and is
 * locked before any model call; model output passes the safety
 * guardrail. Without a GEMINI_API_KEY the route returns the
 * deterministic fallback — screening never depends on Gemini.
 * Model: GEMINI_MODEL env, defaulting to a current model.
 */
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function getAiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'swasthyasetu',
      },
    },
  });
}

export async function POST(req: NextRequest) {
  const requestId = getOrCreateRequestId(req.headers);
  const startedAt = Date.now();
  const respond = (body: Record<string, unknown>, status = 200): NextResponse => {
    const res = NextResponse.json(body, { status });
    res.headers.set(REQUEST_ID_HEADER, requestId);
    logRequest({
      requestId,
      route: '/api/ai-explain',
      method: 'POST',
      status,
      durationMs: elapsedMs(startedAt),
    });
    return res;
  };

  try {
    const rate = checkRateLimit(`ai-ip:${getClientIp(req.headers)}`, {
      limit: 60,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      const res = respond(
        { ok: false, error: 'Too many requests. Please retry later.', requestId },
        429
      );
      for (const [k, v] of Object.entries(rateLimitHeaders(rate))) res.headers.set(k, v);
      return res;
    }

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
      return respond({
        ok: true,
        requestId,
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

    const response = await getAiClient().models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });

    const rawText = response.text || '';
    const guarded = enforceSafetyGuardrailOnAiOutput(deterministicResult, rawText);

    return respond({
      ok: true,
      requestId,
      source: 'gemini_guarded',
      model: GEMINI_MODEL,
      finalCategory: guarded.finalCategory,
      supplementalNote: guarded.safeSupplementalNote,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'AI explanation service unavailable';
    return respond({ ok: false, error: message, requestId }, 500);
  }
}
