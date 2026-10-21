# Stack Decisions — SwasthyaSetu AI

The production decisions for SwasthyaSetu AI, and why. Each decision states the
**current state of the code as read on 2026-10-21** separately from the
**decision**, so nobody mistakes a target for something already built.

---

## 1. One database: Supabase Postgres, via Drizzle + `pg`

**Decision.** There is a single production database: **PostgreSQL hosted on
Supabase**. Server code reaches it through Drizzle ORM over the `pg` driver,
configured only by the `SQL_*` environment variables.

**Where that already lives in the code**

- `src/db/index.ts` — creates the `pg` `Pool` from `SQL_HOST`, `SQL_USER`,
  `SQL_PASSWORD`, `SQL_DB_NAME`; `isSqlConfigured` is true only when both
  `SQL_HOST` and `SQL_DB_NAME` are set.
- `src/db/schema.ts` — Drizzle schema for `users`, `health_worker_profiles`,
  `patients`, `screening_records`, `referrals`, `follow_up_records`,
  `sync_events`, `audit_logs`.
- `supabase/migrations/0001_swasthyasetu_schema_and_rls.sql` — the same tables in
  SQL for Supabase, with Row-Level Security (RLS) enabled on every table.
- `src/db/drizzle.config.ts` — Drizzle tooling config; reads `SQL_HOST`,
  `SQL_DB_NAME`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD`.

**Why.** One database means one schema, one backup story
(`docs/BACKUP_RESTORE.md`), one place where RLS decides who sees which patient.
Splitting records across two databases (for example app data in one, auth/users
in another vendor's store) is how small health projects end up unable to answer
"delete everything about this patient" — see `docs/DATA_PROTECTION.md`.

**Known gaps to close in production code (not yet done).** Migration 0001 ships
only 3 RLS policies for 8 tables, and those policies read
`app.current_user_role`, which application code never sets. Production code must
complete the policy set and bind policies to the authenticated Supabase user
before real patients are stored. `/api/workspace` must also be scoped by
facility/village server-side instead of returning the whole workspace.

## 2. One auth system: Supabase Auth — Firebase is removed

**Decision.** Production sign-in is **Supabase Auth only**. Firebase is removed
from the app: no Firebase sign-in, no Firebase Admin verification, no
`firebase-applet-config.json` in the running app.

**Why**

- **One identity, one database.** The user row that RLS and role checks depend on
  (`users` table, roles `health_worker` / `doctor` / `phc_admin`) lives in the
  same Postgres as the patient data. Supabase Auth identities can be tied to
  that row directly; a second auth vendor means syncing identities across two
  systems forever.
- **The current Firebase path is not real server verification.** As read today,
  `src/lib/firebase-admin.ts` "verifies" a token by calling the public
  Identity Toolkit `accounts:lookup` endpoint with the public API key from the
  committed config file — that is a lookup with a publishable key, not Admin SDK
  verification with service credentials.
- **Demo auth must not survive into production.** `src/lib/auth-server.ts`
  currently also accepts the literal demo tokens `demo-session-asha` /
  `demo-session-doctor`, and the UI ships a role switcher / demo PIN flow. One
  auth system with real credentials replaces all of that.
- **Smaller key surface.** Removing Firebase removes a whole committed config
  file and its keys from the trust story. Those keys still need revoking by the
  project owner after removal — see the key-rotation checklist in
  `docs/DATA_PROTECTION.md`.

**Current state (not production).** Firebase is still wired in the prototype
(`src/lib/firebase.ts`, `src/lib/firebase-admin.ts`, `firebase` in
`package.json`), Firebase Auth is never actually used for sign-in in the UI, and
demo tokens are what the running prototype accepts. Removing Firebase and wiring
Supabase Auth is **production code work still to do** — this document records
the decision, it does not perform it.

## 3. Hosting: Vercel

**Decision.** The Next.js app is deployed on **Vercel**, with all secrets set as
Vercel environment variables (names in `.env.example`).

**Why.** The app is Next.js 15 (App Router, route handlers in `app/api/`), which
Vercel deploys with no extra server to patch or babysit — appropriate for a
small team. The database, auth and backups stay on Supabase, so hosting can move
later without moving patient data.

**Current state.** No Vercel project/deployment or CI is set up in this repo.
Creating them is a user live step — see README → "USER LIVE STEPS".

## 4. Screening: deterministic engine locked; Gemini supplemental only

**Decision.** Triage/workflow categories are decided **only** by the
deterministic rule engine, `PROTOTYPE-RULES-v1.0`, in
`src/lib/screening-engine.ts` (`evaluateScreening`). Gemini may only produce a
short, plain-language explanation to help the health worker talk to the patient
and family. It may never set, change, upgrade or downgrade a category, and it
may never state a diagnosis.

**How the code already enforces this**

- `app/api/ai-explain/route.ts` runs `evaluateScreening` first, passes the
  category to the model as "LOCKED, DO NOT CHANGE", and then passes the model's
  text through `enforceSafetyGuardrailOnAiOutput` before returning it.
- `enforceSafetyGuardrailOnAiOutput` always returns the deterministic category
  as `finalCategory`, reports any attempted override (`overrideBlocked`), strips
  phrases such as "diagnosed with" / "definitive diagnosis" / "confirmed
  diagnosis", and prefixes the note as a non-diagnostic communication aid.
- If `GEMINI_API_KEY` is missing, the route returns a deterministic fallback
  note — screening and referral work fully with no AI model in the path.

**Consequences that are not optional**

- Any change to a threshold or rule is a change to `screening-engine.ts` plus a
  new entry for clinician review in `docs/CLINICAL_SIGNOFF_PACK.md` — never a
  prompt change.
- The engine version string stays `PROTOTYPE-RULES-v1.0` until a clinician has
  signed the rules off and a deliberate, documented version change is made. Do
  not rename it to sound validated.
- The Gemini model name must come from `GEMINI_MODEL` in production code.
  Current code hardcodes the model string in `app/api/ai-explain/route.ts`;
  that is a known code TODO, recorded in `.env.example`.

## 5. In-memory mode is development-only

**Decision.** The in-memory / synthetic-data store is a **development and test
convenience only**. It must never hold real patient data.

**Current state.** In `src/db/repository.ts`, when SQL is not configured the app
uses an in-memory store seeded with synthetic fixtures, with a disk-backed
snapshot for the prototype; the admin UI itself notes that "server data is
in-memory for this prototype build and resets when the dev server restarts."
Facilities in the fixtures are simulated (e.g. PHC Rampur / Sitapur).

**Production rule.** A production deployment must fail loudly — not fall back
silently — if `SQL_HOST` / `SQL_DB_NAME` are missing, and the demo tokens, demo
PIN and role switcher must be disabled. Until that code change lands, the safe
operational rule is simple: **no real patient is ever entered into a build that
is running in in-memory/demo mode.**

## Decision summary

| Question | Decision |
|---|---|
| Which database? | Supabase Postgres only, via Drizzle + `pg`, `SQL_*` env vars |
| Which auth? | Supabase Auth only; Firebase removed |
| Where is it hosted? | Vercel; secrets in Vercel env vars |
| Who decides triage? | Deterministic `PROTOTYPE-RULES-v1.0` engine only |
| What may Gemini do? | Draft supplemental explanation wording only; category locked; no diagnosis |
| In-memory store? | Dev/test only; never real patients |
