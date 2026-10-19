import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/src/lib/auth-server';
import { isSqlConfigured } from '@/src/db/index';
import {
  createPatientRecord,
  createReferralRecord,
  createScreeningAndFollowUp,
  getAllWorkspaceData,
  logSyncEventInDb,
  updateFollowUpRecord,
  updateReferralByDoctor,
  upsertProfileRecord,
} from '@/src/db/repository';
import type { UserRole } from '@/src/lib/types';
import { evaluateScreening, patientRegistrationSchema } from '@/src/lib/screening-engine';

export async function GET(req: NextRequest) {
  try {
    await authenticateRequest(req);
    const data = await getAllWorkspaceData();
    return NextResponse.json({
      ok: true,
      persistenceMode: isSqlConfigured ? 'cloudsql_postgres' : 'in_memory_synthetic',
      ...data,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch workspace data';
    const status = message.startsWith('Unauthorized') ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await authenticateRequest(req);
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
        return NextResponse.json(
          { ok: false, error: 'Invalid login profile payload' },
          { status: 400 }
        );
      }
      if (actor.role !== validatedRole) {
        return NextResponse.json(
          { ok: false, error: 'Profile role does not match authenticated session role' },
          { status: 403 }
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
      return NextResponse.json({ ok: true, profile: savedProfile });
    }

    if (action === 'register_patient') {
      const parsed = patientRegistrationSchema.safeParse(payload);
      if (!parsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error: parsed.error.issues.map((i) => i.message).join('; '),
          },
          { status: 400 }
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

      return NextResponse.json({
        ok: true,
        serverConfirmed: true,
        ...result,
      });
    }

    if (action === 'record_screening') {
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
        return NextResponse.json(
          {
            ok: false,
            error: evaluation.validationErrors.map((e) => e.messageEn).join(' '),
            validationErrors: evaluation.validationErrors,
          },
          { status: 400 }
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

      return NextResponse.json({
        ok: true,
        serverConfirmed: true,
        evaluation,
        ...result,
      });
    }

    if (action === 'create_referral') {
      if (!payload.referralId || !payload.patientId || !payload.screeningId || !payload.reasonForReferral) {
        return NextResponse.json(
          { ok: false, error: 'Missing required referral fields (referralId, patientId, screeningId, reason).' },
          { status: 400 }
        );
      }

      const result = await createReferralRecord(actor, {
        referralId: payload.referralId,
        patientId: payload.patientId,
        screeningId: payload.screeningId,
        priority: payload.priority || 'further_assessment_needed',
        reasonForReferral: payload.reasonForReferral,
        destinationFacility: payload.destinationFacility || 'Simulated PHC Rampur, Sitapur — Uttar Pradesh (Demo)',
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

      return NextResponse.json({
        ok: true,
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
        return NextResponse.json(
          {
            ok: false,
            conflict: true,
            error: 'Version conflict detected on referral record.',
            serverRecord: result.serverRecord,
          },
          { status: 409 }
        );
      }

      return NextResponse.json({
        ok: true,
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
        return NextResponse.json(
          {
            ok: false,
            conflict: true,
            error: `Conflict detected: server follow-up is at version ${result.serverVersion}.`,
            serverVersion: result.serverVersion,
          },
          { status: 409 }
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

      return NextResponse.json({
        ok: true,
        serverConfirmed: true,
        newVersion: result.newVersion,
      });
    }

    return NextResponse.json({ ok: false, error: `Unsupported action: ${action}` }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Workspace operation failed';
    const status = message.startsWith('Unauthorized')
      ? 401
      : message.startsWith('AuthorizationError')
        ? 403
        : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
