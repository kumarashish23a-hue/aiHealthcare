import { NextRequest, NextResponse } from 'next/server';
import { assertRole, authenticateRequest } from '@/src/lib/auth-server';
import { assertProductionPersistence, isSqlConfigured } from '@/src/db/index';
import {
  createPatientRecord,
  createReferralRecord,
  createScreeningAndFollowUp,
  findPatientById,
  getScopedWorkspaceData,
  listUsersForAdmin,
  logSyncEventInDb,
  setUserActive,
  updateFollowUpRecord,
  updateReferralByDoctor,
  updateUserAssignment,
  upsertProfileRecord,
} from '@/src/db/repository';
import type { AppUser, UserRole } from '@/src/lib/types';
import { evaluateScreening, patientRegistrationSchema } from '@/src/lib/screening-engine';
import { canAccessPatient } from '@/src/lib/scoping';
import { formatFacilityLabel, getDefaultReferralFacility } from '@/src/lib/facilities';
import { notifyOverdueFollowUp, notifyUrgentReferral } from '@/src/lib/notifications';
import {
  buildOverdueReportCsv,
  buildReferralsReportCsv,
  buildScreeningsReportCsv,
} from '@/src/lib/reports';
import { checkRateLimit, getClientIp, rateLimitHeaders } from '@/src/lib/rate-limit';
import {
  REQUEST_ID_HEADER,
  elapsedMs,
  getOrCreateRequestId,
  logRequest,
} from '@/src/lib/request-id';

function json(
  requestId: string,
  body: Record<string, unknown>,
  status = 200,
  extraHeaders?: Record<string, string>
): NextResponse {
  const res = NextResponse.json(body, { status });
  res.headers.set(REQUEST_ID_HEADER, requestId);
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) res.headers.set(k, v);
  }
  return res;
}

function statusForError(message: string): number {
  if (message.startsWith('Unauthorized')) return 401;
  if (message.startsWith('AuthorizationError')) return 403;
  if (message.startsWith('ConfigurationError')) return 503;
  if (message.startsWith('User not found')) return 404;
  return 500;
}

/** Rate-limit by IP (pre-auth) — returns a 429 response or null. */
function ipRateLimit(req: NextRequest, requestId: string): NextResponse | null {
  const result = checkRateLimit(`ws-ip:${getClientIp(req.headers)}`, {
    limit: 300,
    windowMs: 60_000,
  });
  if (result.allowed) return null;
  return json(
    requestId,
    { ok: false, error: 'Too many requests. Please retry later.', requestId },
    429,
    rateLimitHeaders(result)
  );
}

/** Rate-limit by authenticated user (POST mutations). */
function userRateLimit(actor: AppUser, requestId: string): NextResponse | null {
  const result = checkRateLimit(`ws-user:${actor.uid}`, {
    limit: 120,
    windowMs: 60_000,
  });
  if (result.allowed) return null;
  return json(
    requestId,
    { ok: false, error: 'Too many requests. Please retry later.', requestId },
    429,
    rateLimitHeaders(result)
  );
}

// Overdue follow-up notifications are fired at most once per follow-up
// per day per server instance (notifications default to log mode).
const overdueNotified = new Set<string>();
function fireOverdueNotifications(
  actor: AppUser,
  followUps: Array<{
    followUpId: string;
    patientId: string;
    status: string;
    scheduledDate: string;
    recordedByUid: string;
  }>
): void {
  const today = new Date().toISOString().slice(0, 10);
  for (const f of followUps) {
    const isOverdue =
      (f.status === 'pending' || f.status === 'acknowledged') && f.scheduledDate < today;
    if (!isOverdue) continue;
    const key = `${f.followUpId}:${today}`;
    if (overdueNotified.has(key)) continue;
    if (overdueNotified.size > 5000) overdueNotified.clear();
    overdueNotified.add(key);
    void notifyOverdueFollowUp({
      patientId: f.patientId,
      followUpId: f.followUpId,
      scheduledDate: f.scheduledDate,
      assignedWorkerUid: f.recordedByUid || actor.uid,
    });
  }
}

export async function GET(req: NextRequest) {
  const requestId = getOrCreateRequestId(req.headers);
  const startedAt = Date.now();
  let actor: AppUser | undefined;
  try {
    const limited = ipRateLimit(req, requestId);
    if (limited) return limited;

    assertProductionPersistence();
    actor = await authenticateRequest(req);

    const limitParam = Number(req.nextUrl.searchParams.get('limit') || '');
    const data = await getScopedWorkspaceData(actor, {
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
    });

    // CSV report export (doctor / phc_admin only), from scoped data.
    const report = req.nextUrl.searchParams.get('report');
    if (report) {
      assertRole(actor, ['doctor', 'phc_admin']);
      const today = new Date().toISOString().slice(0, 10);
      let csv: string;
      let filename: string;
      if (report === 'screenings') {
        csv = buildScreeningsReportCsv(data.screenings);
        filename = 'screenings-by-category-village.csv';
      } else if (report === 'referrals') {
        csv = buildReferralsReportCsv(data.referrals);
        filename = 'referral-completion.csv';
      } else if (report === 'overdue') {
        csv = buildOverdueReportCsv(data.followUps, today);
        filename = 'overdue-follow-ups.csv';
      } else {
        return json(requestId, { ok: false, error: `Unknown report: ${report}`, requestId }, 400);
      }
      const res = new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
      res.headers.set(REQUEST_ID_HEADER, requestId);
      logRequest({
        requestId,
        route: '/api/workspace',
        method: 'GET',
        status: 200,
        durationMs: elapsedMs(startedAt),
        actorRole: actor.role,
        actorUid: actor.uid,
      });
      return res;
    }

    fireOverdueNotifications(actor, data.followUps);

    // phc_admin additionally receives the user account list for the
    // admin user-management panel.
    const users = actor.role === 'phc_admin' ? await listUsersForAdmin(actor) : undefined;

    logRequest({
      requestId,
      route: '/api/workspace',
      method: 'GET',
      status: 200,
      durationMs: elapsedMs(startedAt),
      actorRole: actor.role,
      actorUid: actor.uid,
    });
    return json(requestId, {
      ok: true,
      requestId,
      actor: {
        uid: actor.uid,
        role: actor.role,
        fullName: actor.fullName,
        facilityName: actor.facilityName,
        assignedVillage: actor.assignedVillage,
      },
      persistenceMode: isSqlConfigured ? 'supabase_postgres' : 'in_memory_synthetic_dev_only',
      ...data,
      ...(users ? { users } : {}),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch workspace data';
    const status = statusForError(message);
    logRequest({
      requestId,
      route: '/api/workspace',
      method: 'GET',
      status,
      durationMs: elapsedMs(startedAt),
      actorRole: actor?.role,
      actorUid: actor?.uid,
    });
    return json(requestId, { ok: false, error: message, requestId }, status);
  }
}

export async function POST(req: NextRequest) {
  const requestId = getOrCreateRequestId(req.headers);
  const startedAt = Date.now();
  let actor: AppUser | undefined;
  try {
    const limited = ipRateLimit(req, requestId);
    if (limited) return limited;

    assertProductionPersistence();
    actor = await authenticateRequest(req);

    const userLimited = userRateLimit(actor, requestId);
    if (userLimited) return userLimited;

    const body = await req.json();
    const { action, payload, syncEventId } = body;

    if (action === 'save_profile') {
      const validatedRole = ['health_worker', 'doctor', 'phc_admin'].includes(
        String(payload.role)
      )
        ? (payload.role as UserRole)
        : null;
      if (
        !validatedRole ||
        typeof payload.uid !== 'string' ||
        !payload.uid.trim() ||
        typeof payload.fullName !== 'string' ||
        payload.fullName.trim().length < 2 ||
        typeof payload.phoneLastFour !== 'string' ||
        !/^\d{4}$/.test(payload.phoneLastFour)
      ) {
        return json(requestId, { ok: false, error: 'Invalid login profile payload', requestId }, 400);
      }
      // A user may only save their OWN profile, with the role stored on
      // their account — role changes are admin actions, never self-service.
      if (payload.uid !== actor.uid) {
        return json(
          requestId,
          { ok: false, error: 'Profile uid does not match authenticated session', requestId },
          403
        );
      }
      if (actor.role !== validatedRole) {
        return json(
          requestId,
          { ok: false, error: 'Profile role does not match the role on your account', requestId },
          403
        );
      }
      const savedProfile = await upsertProfileRecord({
        uid: payload.uid,
        role: validatedRole,
        fullName: payload.fullName,
        phoneLastFour: payload.phoneLastFour,
        facilityName: typeof payload.facilityName === 'string' ? payload.facilityName : '',
        createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : new Date().toISOString(),
        lastUsedAt:
          typeof payload.lastUsedAt === 'string' ? payload.lastUsedAt : new Date().toISOString(),
      });
      return json(requestId, { ok: true, requestId, profile: savedProfile });
    }

    if (action === 'list_users') {
      const users = await listUsersForAdmin(actor);
      return json(requestId, { ok: true, requestId, users });
    }

    if (action === 'set_user_active') {
      if (typeof payload?.uid !== 'string' || typeof payload?.isActive !== 'boolean') {
        return json(requestId, { ok: false, error: 'Invalid set_user_active payload', requestId }, 400);
      }
      const user = await setUserActive(actor, payload.uid, payload.isActive);
      return json(requestId, { ok: true, requestId, user });
    }

    if (action === 'update_user_assignment') {
      if (typeof payload?.uid !== 'string') {
        return json(requestId, { ok: false, error: 'Invalid update_user_assignment payload', requestId }, 400);
      }
      const user = await updateUserAssignment(actor, payload.uid, {
        role: payload.role,
        assignedVillage: payload.assignedVillage,
        facilityName: payload.facilityName,
      });
      return json(requestId, { ok: true, requestId, user });
    }

    if (action === 'register_patient') {
      const parsed = patientRegistrationSchema.safeParse(payload);
      if (!parsed.success) {
        return json(
          requestId,
          {
            ok: false,
            error: parsed.error.issues.map((i) => i.message).join('; '),
            requestId,
          },
          400
        );
      }

      const result = await createPatientRecord(actor, {
        ...parsed.data,
        consentTimestamp: payload.consentTimestamp || new Date().toISOString(),
      });

      if (syncEventId) {
        await logSyncEventInDb({
          syncEventId,
          entityType: 'patient',
          entityId: result.record.patientId,
          action: 'create',
          status: 'synced',
          deviceUid: actor.uid,
        });
      }

      return json(requestId, {
        ok: true,
        requestId,
        serverConfirmed: true,
        ...result,
      });
    }

    if (action === 'record_screening') {
      // Scope guard: the patient must be inside the actor's scope.
      const patient = await findPatientById(String(payload.patientId || ''));
      if (patient && !canAccessPatient(actor, patient)) {
        return json(
          requestId,
          { ok: false, error: 'AuthorizationError: Patient is outside your assigned scope.', requestId },
          403
        );
      }
      // Server-side re-validation of screening input & deterministic evaluation
      const evaluation = evaluateScreening({
        patientId: payload.patientId,
        systolicBp: payload.systolicBp,
        diastolicBp: payload.diastolicBp,
        heartRateBpm: payload.heartRateBpm,
        temperatureC: payload.temperatureC,
        spo2Percent: payload.spo2Percent,
        randomBloodGlucoseMgDl: payload.randomBloodGlucoseMgDl,
        hemoglobinGDl: payload.hemoglobinGDl,
        respiratoryRateBpm: payload.respiratoryRateBpm,
        isPregnant: payload.isPregnant,
        gestationalWeeks: payload.gestationalWeeks,
        symptoms: payload.symptoms || [],
        symptomDurationDays: payload.symptomDurationDays || 0,
        medicalHistoryNotes: payload.medicalHistoryNotes || '',
      });

      if (!evaluation.isValid) {
        return json(
          requestId,
          {
            ok: false,
            error: evaluation.validationErrors.map((e) => e.messageEn).join(' '),
            validationErrors: evaluation.validationErrors,
            requestId,
          },
          400
        );
      }

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + evaluation.suggestedFollowUpDays);
      const followUpDueDate = payload.followUpDueDate || dueDate.toISOString().slice(0, 10);

      const result = await createScreeningAndFollowUp(actor, {
        screeningId: payload.screeningId,
        patientId: payload.patientId,
        screeningDate: payload.screeningDate || new Date().toISOString().slice(0, 10),
        systolicBp: payload.systolicBp ?? null,
        diastolicBp: payload.diastolicBp ?? null,
        heartRateBpm: payload.heartRateBpm ?? null,
        temperatureC: payload.temperatureC ?? null,
        spo2Percent: payload.spo2Percent ?? null,
        randomBloodGlucoseMgDl: payload.randomBloodGlucoseMgDl ?? null,
        hemoglobinGDl: payload.hemoglobinGDl ?? null,
        respiratoryRateBpm: payload.respiratoryRateBpm ?? null,
        isPregnant: Boolean(payload.isPregnant),
        gestationalWeeks: payload.gestationalWeeks ?? null,
        symptoms: payload.symptoms || [],
        symptomDurationDays: Number(payload.symptomDurationDays || 0),
        medicalHistoryNotes: payload.medicalHistoryNotes || '',
        missingFields: evaluation.missingFields,
        resultCategory: evaluation.resultCategory,
        flaggedReasons: evaluation.flaggedReasons,
        recommendedNextSteps: evaluation.recommendedNextSteps,
        aiSupplementalNote: payload.aiSupplementalNote || '',
        engineVersion: evaluation.engineVersion,
        requiresFollowUp: evaluation.requiresFollowUp,
        followUpDueDate,
      });

      if (syncEventId) {
        await logSyncEventInDb({
          syncEventId,
          entityType: 'screening',
          entityId: result.screeningId,
          action: 'create',
          status: 'synced',
          deviceUid: actor.uid,
        });
      }

      return json(requestId, {
        ok: true,
        requestId,
        serverConfirmed: true,
        evaluation,
        ...result,
      });
    }

    if (action === 'create_referral') {
      if (!payload.referralId || !payload.patientId || !payload.screeningId || !payload.reasonForReferral) {
        return json(
          requestId,
          { ok: false, error: 'Missing required referral fields (referralId, patientId, screeningId, reason).', requestId },
          400
        );
      }
      const patient = await findPatientById(String(payload.patientId));
      if (patient && !canAccessPatient(actor, patient)) {
        return json(
          requestId,
          { ok: false, error: 'AuthorizationError: Patient is outside your assigned scope.', requestId },
          403
        );
      }

      const destinationFacility =
        payload.destinationFacility || formatFacilityLabel(getDefaultReferralFacility());
      const result = await createReferralRecord(actor, {
        referralId: payload.referralId,
        patientId: payload.patientId,
        screeningId: payload.screeningId,
        priority: payload.priority || 'further_assessment_needed',
        reasonForReferral: payload.reasonForReferral,
        destinationFacility,
        createdDate: payload.createdDate || new Date().toISOString().slice(0, 10),
      });

      if (syncEventId) {
        await logSyncEventInDb({
          syncEventId,
          entityType: 'referral',
          entityId: result.referralId,
          action: 'create',
          status: 'synced',
          deviceUid: actor.uid,
        });
      }

      // Urgent referrals notify the destination facility. The
      // notifications service never throws and, in log mode (default),
      // sends nothing — it only records that an alert would be sent.
      if (!result.duplicatePrevented && payload.priority === 'urgent_escalation') {
        await notifyUrgentReferral({
          patientId: payload.patientId,
          referralId: result.referralId,
          destinationFacility,
          priority: payload.priority,
        });
      }

      return json(requestId, {
        ok: true,
        requestId,
        serverConfirmed: true,
        ...result,
      });
    }

    if (action === 'update_referral') {
      const result = await updateReferralByDoctor(actor, {
        referralId: payload.referralId,
        status: payload.status,
        assignedProfessional: payload.assignedProfessional,
        doctorNotes: payload.doctorNotes,
        followUpPlan: payload.followUpPlan,
        unableReason: payload.unableReason,
        expectedVersion: Number(payload.expectedVersion || 1),
        forceResolveConflict: Boolean(payload.forceResolveConflict),
      });

      if (result.conflict) {
        if (syncEventId) {
          await logSyncEventInDb({
            syncEventId,
            entityType: 'referral',
            entityId: payload.referralId,
            action: 'update',
            status: 'conflict',
            deviceUid: actor.uid,
            conflictDetails: `Client expected v${payload.expectedVersion}, server is at v${result.serverRecord?.version}`,
          });
        }
        return json(
          requestId,
          {
            ok: false,
            conflict: true,
            error: 'Version conflict detected on referral record.',
            serverRecord: result.serverRecord,
            requestId,
          },
          409
        );
      }

      return json(requestId, {
        ok: true,
        requestId,
        serverConfirmed: true,
        newVersion: result.newVersion,
      });
    }

    if (action === 'update_followup') {
      const result = await updateFollowUpRecord(actor, {
        followUpId: payload.followUpId,
        status: payload.status,
        notes: payload.notes || '',
        completedDate: payload.completedDate,
        expectedVersion: Number(payload.expectedVersion || 1),
        forceResolveConflict: Boolean(payload.forceResolveConflict),
      });

      if (result.conflict) {
        return json(
          requestId,
          {
            ok: false,
            conflict: true,
            error: `Conflict detected: server follow-up is at version ${result.serverVersion}.`,
            serverVersion: result.serverVersion,
            requestId,
          },
          409
        );
      }

      if (syncEventId) {
        await logSyncEventInDb({
          syncEventId,
          entityType: 'follow_up',
          entityId: payload.followUpId,
          action: 'update',
          status: 'synced',
          deviceUid: actor.uid,
        });
      }

      return json(requestId, {
        ok: true,
        requestId,
        serverConfirmed: true,
        newVersion: result.newVersion,
      });
    }

    return json(requestId, { ok: false, error: `Unsupported action: ${action}`, requestId }, 400);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Workspace operation failed';
    const status = statusForError(message);
    logRequest({
      requestId,
      route: '/api/workspace',
      method: 'POST',
      status,
      durationMs: elapsedMs(startedAt),
      actorRole: actor?.role,
      actorUid: actor?.uid,
    });
    return json(requestId, { ok: false, error: message, requestId }, status);
  }
}
