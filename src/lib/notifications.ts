/**
 * notifications.ts — Outbound notifications for SwasthyaSetu AI.
 *
 * Environment:
 *   NOTIFICATIONS_MODE        'log' | 'webhook' | 'sms'
 *                             Defaults to 'log' when unset or unrecognised.
 *   NOTIFICATION_WEBHOOK_URL  Required for mode 'webhook'. JSON is POSTed here.
 *   NOTIFICATION_WEBHOOK_TOKEN Optional bearer token for mode 'webhook'.
 *   SMS_API_URL               Required for mode 'sms' (Twilio-compatible endpoint).
 *   SMS_API_KEY               Optional bearer credential for mode 'sms'.
 *   SMS_FROM                  Sender identifier / number for mode 'sms'.
 *
 * IMPORTANT — 'log' mode sends NOTHING:
 *   Log mode is the safe default when notifications are unconfigured. It only
 *   writes a structured `console.info` entry and returns
 *   `{ delivered: false, mode: 'log' }`. It NEVER claims a message was sent,
 *   so callers and UI must not present a log-mode result as delivered.
 *
 * Privacy:
 *   Helpers in this module build messages from IDs and facility names only.
 *   They never include a patient's full name or phone number. A last-four
 *   phone fragment (`toPhoneLastFour`) may be carried as routing metadata,
 *   never a full number.
 *
 * Failure handling:
 *   Every provider's `send` catches its own errors and returns
 *   `{ delivered: false, ... }` instead of throwing, so a notification
 *   failure can never break the caller's clinical workflow.
 */

export type NotificationKind = 'urgent_referral' | 'overdue_follow_up' | 'generic';

export type NotificationMode = 'log' | 'webhook' | 'sms';

export interface NotificationMessage {
  /** Destination identifier: a facility name, worker uid, or address/number supplied by the caller. */
  to?: string;
  /** Last four digits only — never a full phone number. */
  toPhoneLastFour?: string;
  subject?: string;
  body: string;
  kind: NotificationKind | (string & {});
}

export interface NotificationResult {
  delivered: boolean;
  mode: string;
  providerId?: string;
}

export interface NotificationProvider {
  readonly mode: NotificationMode | string;
  send(message: NotificationMessage): Promise<NotificationResult>;
}

export interface UrgentReferralNotificationInput {
  patientId: string;
  referralId: string;
  destinationFacility: string;
  priority: string;
}

export interface OverdueFollowUpNotificationInput {
  patientId: string;
  followUpId: string;
  scheduledDate: string;
  assignedWorkerUid?: string;
}

function resolveMode(env: NodeJS.ProcessEnv = process.env): NotificationMode {
  const raw = (env.NOTIFICATIONS_MODE || '').trim().toLowerCase();
  if (raw === 'webhook' || raw === 'sms') return raw;
  return 'log';
}

class LogNotificationProvider implements NotificationProvider {
  readonly mode = 'log' as const;

  async send(message: NotificationMessage): Promise<NotificationResult> {
    try {
      console.info(
        '[notifications:log]',
        JSON.stringify({
          mode: 'log',
          kind: message.kind,
          to: message.to ?? null,
          toPhoneLastFour: message.toPhoneLastFour ?? null,
          subject: message.subject ?? null,
          body: message.body,
          delivered: false,
        })
      );
    } catch {
      // Logging itself must never break the caller.
    }
    return { delivered: false, mode: 'log' };
  }
}

class WebhookNotificationProvider implements NotificationProvider {
  readonly mode = 'webhook' as const;

  constructor(
    private readonly url: string | undefined,
    private readonly token: string | undefined
  ) {}

  async send(message: NotificationMessage): Promise<NotificationResult> {
    if (!this.url) {
      return { delivered: false, mode: 'webhook' };
    }
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.token) {
        headers.Authorization = `Bearer ${this.token}`;
      }
      const response = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          to: message.to ?? null,
          toPhoneLastFour: message.toPhoneLastFour ?? null,
          subject: message.subject ?? null,
          body: message.body,
          kind: message.kind,
        }),
      });
      if (!response.ok) {
        return { delivered: false, mode: 'webhook' };
      }
      let providerId: string | undefined;
      try {
        const data: unknown = await response.json();
        if (data && typeof data === 'object') {
          const record = data as Record<string, unknown>;
          const candidate = record.providerId ?? record.id ?? record.messageId;
          if (typeof candidate === 'string' && candidate) providerId = candidate;
        }
      } catch {
        // A 2xx with no/invalid JSON body still counts as delivered.
      }
      return providerId
        ? { delivered: true, mode: 'webhook', providerId }
        : { delivered: true, mode: 'webhook' };
    } catch {
      return { delivered: false, mode: 'webhook' };
    }
  }
}

class SmsNotificationProvider implements NotificationProvider {
  readonly mode = 'sms' as const;

  constructor(
    private readonly url: string | undefined,
    private readonly apiKey: string | undefined,
    private readonly from: string | undefined
  ) {}

  async send(message: NotificationMessage): Promise<NotificationResult> {
    if (!this.url) {
      return { delivered: false, mode: 'sms' };
    }
    try {
      const form = new URLSearchParams();
      if (this.from) form.set('From', this.from);
      if (message.to) form.set('To', message.to);
      if (message.toPhoneLastFour) form.set('ToPhoneLastFour', message.toPhoneLastFour);
      form.set('Body', message.body);
      if (message.subject) form.set('Subject', message.subject);
      form.set('Kind', String(message.kind));

      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
      };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }
      const response = await fetch(this.url, {
        method: 'POST',
        headers,
        body: form.toString(),
      });
      if (!response.ok) {
        return { delivered: false, mode: 'sms' };
      }
      let providerId: string | undefined;
      try {
        const data: unknown = await response.json();
        if (data && typeof data === 'object') {
          const record = data as Record<string, unknown>;
          const candidate = record.providerId ?? record.id ?? record.sid ?? record.messageId;
          if (typeof candidate === 'string' && candidate) providerId = candidate;
        }
      } catch {
        // A 2xx with no/invalid JSON body still counts as delivered.
      }
      return providerId
        ? { delivered: true, mode: 'sms', providerId }
        : { delivered: true, mode: 'sms' };
    } catch {
      return { delivered: false, mode: 'sms' };
    }
  }
}

/**
 * Returns a provider for the mode configured via `NOTIFICATIONS_MODE`.
 * Reads the environment on every call so configuration (and tests) can
 * change mode without a module reload.
 */
export function getNotificationProvider(): NotificationProvider {
  const mode = resolveMode();
  switch (mode) {
    case 'webhook':
      return new WebhookNotificationProvider(
        process.env.NOTIFICATION_WEBHOOK_URL,
        process.env.NOTIFICATION_WEBHOOK_TOKEN
      );
    case 'sms':
      return new SmsNotificationProvider(
        process.env.SMS_API_URL,
        process.env.SMS_API_KEY,
        process.env.SMS_FROM
      );
    case 'log':
    default:
      return new LogNotificationProvider();
  }
}

/**
 * Builds the urgent-referral message. Contains only IDs, priority and the
 * destination facility — no patient name and no phone number.
 */
export function buildUrgentReferralMessage(
  input: UrgentReferralNotificationInput
): NotificationMessage {
  return {
    to: input.destinationFacility,
    kind: 'urgent_referral',
    subject: 'Urgent referral',
    body:
      `Urgent referral ${input.referralId} for patient ${input.patientId} ` +
      `to ${input.destinationFacility}. Priority: ${input.priority}. ` +
      `Please acknowledge on receipt.`,
  };
}

/**
 * Builds the overdue follow-up message. Contains only IDs and the scheduled
 * date — no patient name and no phone number.
 */
export function buildOverdueFollowUpMessage(
  input: OverdueFollowUpNotificationInput
): NotificationMessage {
  return {
    to: input.assignedWorkerUid ?? 'health_worker',
    kind: 'overdue_follow_up',
    subject: 'Overdue follow-up',
    body:
      `Follow-up ${input.followUpId} for patient ${input.patientId} ` +
      `was scheduled on ${input.scheduledDate} and is overdue. ` +
      `Please arrange a visit or reschedule.`,
  };
}

export async function notifyUrgentReferral(
  input: UrgentReferralNotificationInput,
  provider: NotificationProvider = getNotificationProvider()
): Promise<NotificationResult> {
  try {
    return await provider.send(buildUrgentReferralMessage(input));
  } catch {
    return { delivered: false, mode: provider.mode ?? 'unknown' };
  }
}

export async function notifyOverdueFollowUp(
  input: OverdueFollowUpNotificationInput,
  provider: NotificationProvider = getNotificationProvider()
): Promise<NotificationResult> {
  try {
    return await provider.send(buildOverdueFollowUpMessage(input));
  } catch {
    return { delivered: false, mode: provider.mode ?? 'unknown' };
  }
}
