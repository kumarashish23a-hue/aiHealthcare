# SwasthyaSetu AI

AI-assisted rural healthcare **screening, referral and follow-up** for frontline
health workers and Primary Health Centres (PHCs).

An ASHA / health worker registers a patient (with documented consent), records
vitals and symptoms — including offline — and a **deterministic rule engine**
(not an AI model) sorts the screening into one of four workflow categories:
`routine_follow_up`, `further_assessment_needed`, `urgent_escalation`, or
`incomplete_information`. Referrals go to the PHC doctor view, and follow-ups are
scheduled from the result. Optional Gemini text only helps phrase a plain-language
explanation for the patient; it can never change the category (see
`docs/STACK_DECISIONS.md`).

> **Status: prototype, not production.** As committed today (audit 2026-10-21):
> build passes, lint is clean, tests pass 15/15 — but sign-in is demo tokens,
> persistence defaults to in-memory synthetic data unless SQL is configured,
> and no live service (Supabase project, Vercel deployment, Gemini key, SMS
> provider) is set up. Nothing in this README claims otherwise. The production
> target and the steps only the project owner can do live are below and in
> `docs/`.

## Stack (production decision)

| Layer | Decision |
|---|---|
| App | Next.js 15 + React 19 + TypeScript + Tailwind CSS v4 |
| Database | **One** database: Postgres hosted on **Supabase**, accessed from the server via Drizzle ORM + `pg`, configured with the `SQL_*` env vars (`src/db/index.ts`). Schema/RLS in `supabase/migrations/` |
| Auth | **One** auth system for production: **Supabase Auth**. Firebase is being removed — rationale in `docs/STACK_DECISIONS.md` |
| Hosting | Vercel |
| Screening | Deterministic engine `PROTOTYPE-RULES-v1.0` in `src/lib/screening-engine.ts` — locked. Gemini is supplemental wording only |
| Offline | PWA + service worker (app shell only — it never caches `/api/*` or patient data) + local offline store/sync for the field workflow |
| Languages | English / Hindi (`en` / `hi`) |

Full reasoning: [`docs/STACK_DECISIONS.md`](docs/STACK_DECISIONS.md).

## Run it locally

Prerequisites: Node.js and npm.

```bash
npm ci
cp .env.example .env.local    # then edit .env.local — see notes below
npm run dev                   # http://localhost:3000
```

Routes: `/` health-worker app · `/doctor` doctor/PHC view · `/admin` admin view ·
`POST /api/ai-explain` (server-side Gemini explanation) · `/api/workspace`.

Notes on `.env.local`:

- **With no `SQL_*` values set, the app runs in dev-only in-memory mode** with
  synthetic data; data resets and is **not** a real database. That is fine for
  trying the prototype and is never acceptable for real patients.
- To use Postgres, set `SQL_HOST` and `SQL_DB_NAME` (plus `SQL_USER` /
  `SQL_PASSWORD`) in `.env.local` — those exact names are read by
  `src/db/index.ts`. `src/db/drizzle.config.ts` separately reads
  `SQL_ADMIN_USER` / `SQL_ADMIN_PASSWORD`.
- `GEMINI_API_KEY` is optional locally: without it, `/api/ai-explain` returns a
  deterministic fallback note and screening still works.
- Variable-by-variable reference, with which ones are secret and which are
  browser-safe: [`.env.example`](.env.example).

## Tests and build

```bash
npm test          # vitest run — src/tests/swasthyasetu.test.ts
npm run lint      # eslint
npm run build     # next build
```

## Documentation

- [`docs/STACK_DECISIONS.md`](docs/STACK_DECISIONS.md) — database, auth, hosting,
  screening-engine and in-memory-mode decisions.
- [`docs/BACKUP_RESTORE.md`](docs/BACKUP_RESTORE.md) — Supabase backups, restore,
  and test-restore procedure (user-side live steps).
- [`docs/DATA_PROTECTION.md`](docs/DATA_PROTECTION.md) — what data is stored,
  consent, access by role, deletion procedure, key rotation (DPDP-oriented).
- [`docs/CLINICAL_SIGNOFF_PACK.md`](docs/CLINICAL_SIGNOFF_PACK.md) — every
  `PROTOTYPE-RULES-v1.0` triage rule/threshold in tables for clinician sign-off.
  **The engine is not clinically validated yet.**
- [`docs/ABDM_READINESS.md`](docs/ABDM_READINESS.md) — why the current "ABHA ID"
  and referral slip are prototype-only, and what real ABDM integration requires.

---

## USER LIVE STEPS — only the project owner can do these

Nothing below has been done yet. An AI assistant / a code commit cannot create
your Supabase project, your Vercel project, or your provider accounts, and no
step here should be reported as done until you have done it in the dashboard
yourself.

1. **Create the Supabase project.** At [supabase.com](https://supabase.com),
   create a new project (pick a region appropriate for Indian patient data —
   see `docs/DATA_PROTECTION.md`), set a strong database password and keep it in
   a password manager, not in a file in this repo.
2. **Run the migrations.** In the Supabase dashboard → **SQL Editor**, run the
   files in `supabase/migrations/` **in numeric order** — `0001_...sql` first,
   then `0002_...sql` when/if that file is present in your copy of the repo —
   one file at a time, checking each run finishes without an error. (This repo,
   as read on 2026-10-21, contains `0001_swasthyasetu_schema_and_rls.sql`; always
   run whatever numbered files are actually in that folder, in order.)
3. **Create the first `phc_admin` user — two halves, both required.**
   a. Supabase dashboard → **Authentication → Users → Add user**: create the
      admin's login (email + a password the admin sets themselves).
   b. Add the matching row in the app's **`users` table** for that same user
      (Supabase dashboard → **Table Editor → users**, or SQL Editor): same
      identity/uid and email as the Auth user, `role` = `phc_admin`, and the
      admin's real facility name. An Auth login with no `users` row — or a
      `users` row with no Auth login — cannot sign in usefully.
4. **Set the Vercel environment variables.** Import this repo into Vercel, then
   in **Project → Settings → Environment Variables** set every production value
   from [`.env.example`](.env.example) (`SQL_*`, `SUPABASE_*`,
   `NEXT_PUBLIC_SUPABASE_*`, `GEMINI_API_KEY`/`GEMINI_MODEL`,
   `NOTIFICATIONS_MODE`, …). Secrets are typed into Vercel, never committed to
   git. Redeploy after changing them.
5. **Set the Gemini key.** Create/choose the key in Google AI Studio / Google
   Cloud, then set it as `GEMINI_API_KEY` in Vercel (step 4). The app works
   without it (deterministic fallback), so this is not a launch blocker.
6. **Enable backups.** Follow [`docs/BACKUP_RESTORE.md`](docs/BACKUP_RESTORE.md)
   in the Supabase dashboard and confirm a backup actually exists — do not
   assume the plan default covers you.
7. **Choose an SMS/notification provider (if notifications are wanted).** Sign
   up with the provider yourself, then set `NOTIFICATIONS_MODE` and, for SMS,
   `SMS_API_URL` / `SMS_API_KEY` / `SMS_FROM` in Vercel. Until then leave
   `NOTIFICATIONS_MODE=log`.
8. **Before any real patient use:** get the clinical sign-off in
   `docs/CLINICAL_SIGNOFF_PACK.md` completed, and work through
   `docs/DATA_PROTECTION.md` (consent wording, access by role, key rotation —
   including revoking the old Firebase keys).
