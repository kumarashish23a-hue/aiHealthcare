# Data Protection — SwasthyaSetu AI

Oriented to India's **Digital Personal Data Protection Act, 2023 (DPDP Act)**:
collect the minimum personal data needed, only with consent, keep it only where
it is supposed to live, let only the right roles see it, and be able to delete
it completely. This document describes what the code actually stores (read on
2026-10-21) and the procedures to follow. It is an engineering/operations
document, **not legal advice** — have the deployment reviewed before real
patients are enrolled.

---

## 1. What data is stored

Production database (Supabase Postgres; schema in `src/db/schema.ts` and
`supabase/migrations/0001_swasthyasetu_schema_and_rls.sql`):

| Table | What it holds |
|---|---|
| `users` | Staff accounts: uid, email, full name, role (`health_worker` / `doctor` / `phc_admin`), facility name, preferred language (`en`/`hi`) |
| `health_worker_profiles` | Worker code, assigned village, block, district, primary PHC, **phone last 4 digits only**, active flag |
| `patients` | Patient ID (`PAT-…`), full name, age (years), sex, village, block, **phone last 4 digits only**, consent flag + consent timestamp, known conditions, who registered them, synthetic flag, version |
| `screening_records` | Vitals (BP, heart rate, temperature, SpO2, random blood glucose, haemoglobin, respiratory rate), pregnancy flag + gestational weeks, symptoms + duration, medical-history notes, missing-fields list, result category, flagged reasons, recommended next steps, AI supplemental note, engine version, follow-up due date |
| `referrals` | Patient + screening IDs, priority, reason, destination facility, status, assigned professional, doctor notes, follow-up plan, unable-to-complete reason |
| `follow_up_records` | Patient + screening (+ optional referral) IDs, status, scheduled/completed dates, notes, recorded-by uid/role |
| `sync_events` | Offline-sync bookkeeping: entity type/ID, action, status, device uid, conflict details |
| `audit_logs` | Who did what: actor uid/role, action, target type/ID, summary, timestamp |
| *(device, local only)* Offline store (Dexie/IndexedDB, `src/lib/offline-db.ts`) | The same patient/screening/referral/follow-up records plus queued sync mutations and drafts, on the health worker's device, so field work continues without connectivity. This is part of the data footprint — see §4. |

**Deliberate minimisation, already in the code**

- **Phone: last 4 digits ONLY.** `patientRegistrationSchema` in
  `src/lib/screening-engine.ts` requires `phoneLastFour` to match `^\d{4}$`, and
  the database column is `phone_last_four`. **A full phone number is never to be
  collected or stored** — not in the phone field, and not smuggled into notes
  fields either. Practical consequence: you cannot SMS/call a patient from the
  patient record alone (see `NOTIFICATIONS_MODE` note in `.env.example`).
- No Aadhaar number, no full address (village + block only), no payment data,
  no free-text biography is collected by the registration schema.
- The locally formatted "ABHA-style" ID is derived from the patient ID; it is
  not a real ABHA number and carries no external data — see
  `docs/ABDM_READINESS.md`.

## 2. Consent — required before registration

- Registration is **blocked without consent**: the schema requires
  `consentObtained === true` ("Informed patient consent is required before
  saving health records"), the `patients` table enforces
  `CHECK (consent_obtained = TRUE)`, and the consent timestamp is stored with
  the record. The RLS insert policy for patients likewise requires
  `consent_obtained = TRUE`.
- In plain terms for the field: explain, in the patient's language (the UI has
  English/Hindi labels), what is being recorded, that it will be seen by the PHC
  doctor for referral/follow-up, and that they can ask for it to be deleted —
  **then** tick consent and register. Consent for screening/referral is not
  consent for anything else (research, marketing, third-party sharing), and no
  such use is permitted by this document.
- If a patient refuses or withdraws consent: do not register them; if already
  registered, follow the deletion procedure in §5.

## 3. Where data lives

| Place | Data | Notes |
|---|---|---|
| Supabase Postgres (production) | All tables in §1 | The single system of record. Choose the project region deliberately for Indian health data; region cannot be casually changed later |
| Vercel (hosting) | The app code and server runtime; data passes through route handlers (`/api/workspace`, `/api/ai-explain`) | Secrets live in Vercel env vars (`.env.example`). No patient database is stored on Vercel |
| Health worker's device | Offline store (Dexie) + queued sync mutations | Real patient data at rest on a field device: device must have a screen lock, and lost devices are reported so the staff account can be disabled (§6) |
| Gemini (Google), via `/api/ai-explain` | The screening facts sent in the prompt: category, flagged-reason titles/values, missing fields — used to draft a wording suggestion | Server-side only, key in `GEMINI_API_KEY`. Never send direct identifiers to the model that it does not need; the deterministic result does not depend on this call |
| Backups | Supabase backups (+ any manual dump you take) | Backups are full copies: protect, and delete test restores — `docs/BACKUP_RESTORE.md` |
| **Demo / in-memory mode** | Synthetic data only | **Never real patients.** Not a storage location, ever |

Not in scope / not collected: there is no advertising tracker, no sale of data,
and no third-party analytics in the described design; do not add one without
updating this document.

## 4. Who can access what, by role

Roles are `health_worker`, `doctor`, `phc_admin` (`src/lib/types.ts`).

| Capability | health_worker (ASHA) | doctor | phc_admin |
|---|---|---|---|
| Register patients (with consent) and record screenings | ✅ | ✅ | ✅ |
| View patients/screenings in scope | ✅ | ✅ | ✅ |
| Create referrals from a screening | ✅ | ✅ | ✅ |
| Update referral clinical status, doctor notes, follow-up plan | ❌ | ✅ | ✅ |
| Administration (users/facilities, data deletion, key rotation) | ❌ | ❌ | ✅ (with developer, §5–§6) |

Rules that make this real, not aspirational:

- Access is enforced **on the server / in the database** (RLS + server checks),
  never only by hiding buttons in the UI. Current 0001 migration policies are
  incomplete (3 policies for 8 tables, keyed on `app.current_user_role`, which
  app code never sets) — completing them against the Supabase Auth user is
  required production work before real data (see `docs/STACK_DECISIONS.md`).
- **Service worker privacy rule (already in `public/sw.js`):** the service
  worker caches **only** the static app shell (`/`, icon, manifest). It
  **never caches `/api/*` routes, auth endpoints, or any patient/health-record
  response** in CacheStorage, and it skips non-GET requests entirely. Do not
  weaken this rule — a cached API response is patient data sitting in a browser
  cache.
- Demo tokens, the demo PIN and the role switcher in the prototype are **not**
  access control and must not exist in a production build.

## 5. Deletion procedure (patient asks, or consent is withdrawn)

Goal: **no copy left** in the live database, the device that registered them,
or an overlooked export. Work in this order; an admin (`phc_admin`) authorises,
a developer executes, and both check.

1. **Record the request.** Note the patient's identity as given, their
   `PAT-…` patient ID (find it in **Table Editor → patients** or the app), who
   requested deletion, and the date. Create/keep an `audit_logs` entry for the
   deletion itself (actor, action, target patient ID, date) — the audit entry
   contains IDs and the fact of deletion, not the patient's clinical data.
2. **Stop further use.** Tell the assigned health worker and PHC doctor not to
   use that patient's records from this point.
3. **Delete linked records first, then the patient** (the schema uses
   `ON DELETE RESTRICT` on the patient links, so children must go first).
   In the Supabase **SQL Editor**, in one sitting, for that one `patient_id`:
   ```sql
   DELETE FROM public.follow_up_records WHERE patient_id = '<PAT-ID>';
   DELETE FROM public.referrals         WHERE patient_id = '<PAT-ID>';
   DELETE FROM public.screening_records WHERE patient_id = '<PAT-ID>';
   DELETE FROM public.patients          WHERE patient_id = '<PAT-ID>';
   ```
   (Substitute the real patient ID. Double-check the ID against the request in
   step 1 before running — this cannot be casually undone except by restoring a
   backup, which would also resurrect other changes.)
4. **Check for stragglers.** Search `sync_events` and `audit_logs` for the
   patient ID; remove or minimise entries that contain clinical detail beyond
   what the audit trail legitimately needs. Check any printed/exported referral
   slips for that patient held at the PHC and destroy them.
5. **Clear the device copy.** On the registering worker's device, sync first
   (so the deletion propagates cleanly), then confirm the patient no longer
   appears in the app's offline data; if the app cannot purge a single record,
   clear the app's site data on that device and re-sync. Deleting only the
   server row while a device still holds — and can re-sync — the record is not
   deletion.
6. **Backups note.** Copies inside already-taken backups age out with backup
   retention; they are not edited. Record this in the request log so the
   answer to "is it all gone?" is honest: gone from live systems now, gone
   from backups when retention expires (`docs/BACKUP_RESTORE.md`). If a backup
   is ever restored, re-run this deletion for any patients deleted after that
   backup's date.
7. **Confirm and close.** Verify with a fresh search by patient ID and by name
   in the app and Table Editor, then mark the request closed with the date and
   the names of the admin and developer who performed it.

For a **staff account** deletion, the same pattern applies: remove/disable the
`users` row and `health_worker_profiles` row, delete/disable the Supabase Auth
user, and keep the audit entry.

## 6. Retention note

- Screening, referral and follow-up records are kept **while the patient is in
  care and for the period the deploying PHC's record-retention policy /
  applicable health-record rules require** — set that period explicitly, in
  writing, for your deployment before go-live; this repo does not set a number
  for you.
- When the retention period for a record ends, delete it using §5 (bulk variant,
  admin-authorised, logged).
- Synthetic/demo data is labelled (`is_synthetic` / `is_simulated` flags) and
  must be purged from any database before it holds real patients — synthetic
  rows are never evidence about a real person.
- Backups are retained per the Supabase plan/settings you verified in
  `docs/BACKUP_RESTORE.md`; test-restore copies are deleted immediately after
  the test.

## 7. Key-rotation checklist

Rotate a key immediately if it was ever committed, screenshotted, shared in
chat, or held by someone who has left — and routinely at least when staff with
access change.

- [ ] **Supabase service-role key** — rotate in Supabase dashboard
      (**Project Settings → API**), update `SUPABASE_SERVICE_ROLE_KEY` in
      Vercel, redeploy, confirm the app still works, confirm the old key fails.
- [ ] **Supabase anon key / project keys** — same flow for
      `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` if the dashboard
      flow rotates them; remember the anon key is public-by-design and protected
      by RLS, not by secrecy.
- [ ] **Database password / SQL credentials** — change in Supabase
      (**Project Settings → Database**), update `SQL_PASSWORD` (and
      `SQL_ADMIN_PASSWORD` / pooler credentials if separate) in Vercel,
      redeploy, re-test.
- [ ] **`GEMINI_API_KEY`** — create a new key in Google AI Studio / Google
      Cloud, set it in Vercel, redeploy, delete the old key.
- [ ] **SMS / notification credentials** (`SMS_API_KEY`, webhook secret if any)
      — rotate at the provider, update Vercel, send a test notification in
      `log`/test mode before re-enabling live sends.
- [ ] **Firebase keys — obsolete, revoke them (user action).** A Firebase web
      config (`firebase-applet-config.json`, including its `apiKey`) is
      **committed in this repo's git history**, and `src/lib/firebase-admin.ts`
      used that key for token lookup. Once Firebase is removed
      (`docs/STACK_DECISIONS.md`), that config is dead weight — but removal from
      the current code does **not** erase git history, so the owner must, in the
      **Firebase Console / Google Cloud Console**: delete or restrict the old
      API key, and delete/disable the Firebase project (or at least its Auth/
      Firestore usage) if nothing else uses it. Only the project owner can do
      this; no commit can do it for them.
- [ ] After any rotation: grep the repo and your deployment notes for the old
      value, confirm `.env.local` was never committed, and log the rotation
      (date, key, who) in `audit_logs`/ops notes — without writing the key
      itself anywhere.
