# Backup & Restore — SwasthyaSetu AI (Supabase Postgres)

> **USER-SIDE LIVE STEPS.** Everything in this document happens in the
> **Supabase dashboard, by the project owner**, on the live project. None of it
> is done by a code commit, none of it has been done yet, and no assistant can
> do it for you. Menu names below are Supabase dashboard labels as generally
> shown; if your dashboard wording differs slightly, follow the dashboard —
> the *checks* in each step are what matter.
>
> Scope: the production database is Supabase Postgres (see
> `docs/STACK_DECISIONS.md`). There is no second database to back up once
> Firebase is removed.

---

## 1. Check what backup coverage your plan actually gives you

1. Open [supabase.com](https://supabase.com) → sign in → open the
   **SwasthyaSetu project**.
2. Go to **Database → Backups** (in some layouts: **Database → Backups →
   Scheduled backups**).
3. Read what the page shows for *your* project:
   - Are **scheduled (automatic) backups** listed? How many, and how far back
     does the list go (retention)?
   - Is **Point-in-Time Recovery (PITR)** shown as enabled or disabled?
4. Write down what you saw, with the date, in your own ops notes. **Do not
   assume** a backup exists because a plan name sounds like it includes one —
   the list on this page is the only proof.

## 2. Enable backups / PITR (if step 1 shows they are off)

1. **Database → Backups → PITR** (or the plan/add-on prompt on that page):
   if PITR is offered as a paid add-on, enable it there. PITR is what lets you
   restore to a *moment* (for example "just before that bad delete") instead of
   only to the last nightly backup.
2. If scheduled backups are off and the page offers an **Enable backups** /
   plan-upgrade action, use it. If your current plan has no scheduled backups
   at all, you must either upgrade the plan in **Settings → Billing** or run
   the manual backup routine in §3 on a fixed schedule — one of the two,
   deliberately, never neither.
3. Go back to **Database → Backups** and confirm the status now shows backups
   enabled (and PITR enabled, if you turned it on).

> Before real patients are stored: scheduled backups **on**, retention noted,
> and — strongly recommended — PITR **on**. Losing screening/referral history
> is a clinical-continuity problem, not just an IT problem.

## 3. Manual backup check (do this monthly, and before any migration)

A backup you have never looked at is a hope, not a backup.

1. **Database → Backups**: confirm the most recent scheduled backup has a
   recent timestamp and a completed/success status. If the newest one is old
   or failed, stop and fix that before doing anything else.
2. Take an extra manual safety copy before running a new migration
   (`supabase/migrations/…`) or a bulk change:
   - If the Backups page offers **Download backup** / create a manual backup,
     use it and save the file to encrypted storage **outside** Supabase.
   - Otherwise use `pg_dump` from a machine you control, with the database
     connection details from **Project Settings → Database** (fill in your own
     host/user/database — never paste a real password into a doc or chat):

     ```bash
     pg_dump "host=<db-host> user=<db-user> dbname=<db-name>" \
       --format=custom --file="swasthyasetu-$(date +%F).dump"
     ```

     You will be prompted for the password, or supply it via your password
     manager's mechanism — not hard-coded in the command history.
3. Record: date, backup type (scheduled / manual), file location, and who took
   it.

## 4. Restore steps (real incident)

**Warning:** a restore replaces or rolls back live data. Patients screened
after the backup point can be lost on a full restore. If the problem is one
deleted/wrong record, prefer fixing that record (or a PITR restore to a *new*
project, §5, then copying the needed rows back) over rolling the whole live
database back.

1. **Stop and note the time.** Write down when the problem happened and when it
   was noticed — PITR needs a target timestamp.
2. Supabase dashboard → the SwasthyaSetu project → **Database → Backups**.
3. Choose the restore source:
   - **Scheduled backup:** pick the newest backup from *before* the problem.
   - **PITR (if enabled):** choose "restore to a point in time" and enter a
     timestamp just before the problem.
4. Follow the dashboard's restore confirmation exactly, reading any warning
   about data after the restore point being discarded, and confirm.
5. Wait for the dashboard to show the restore as complete — do not point users
   back at the app mid-restore.
6. **Verify before reopening use** (§6 checks), then tell the PHC users the
   system is back and which time window of entries may need re-entering.

## 5. Test-restore procedure (do this before go-live, then quarterly)

Never discover during an incident that your backups don't restore.

1. Create a **separate throwaway Supabase project** (free tier is fine) — never
   test-restore over the live project.
2. Download / obtain a recent backup of the live project (§3, step 2).
3. Restore it into the throwaway project:
   - If the backup came from the dashboard, follow the dashboard's restore flow
     targeting the throwaway project, if offered; otherwise restore the dump
     file with:

     ```bash
     pg_restore --dbname "host=<test-db-host> user=<test-db-user> dbname=<test-db-name>" \
       --clean --if-exists "swasthyasetu-YYYY-MM-DD.dump"
     ```
4. Run the §6 verification checks against the throwaway project.
5. Record the test: date, backup used, restore result, check results.
6. **Delete the throwaway project afterwards** — a restored copy is still real
   patient data while it exists (see `docs/DATA_PROTECTION.md`).

## 6. Verification checks after any restore

- [ ] All 8 tables exist: `users`, `health_worker_profiles`, `patients`,
      `screening_records`, `referrals`, `follow_up_records`, `sync_events`,
      `audit_logs`.
- [ ] Row counts are plausible for the backup date (Table Editor, or
      `SELECT count(*)` per table in the SQL Editor).
- [ ] Row-Level Security is still **enabled** on every table
      (Database → Tables — RLS badge on).
- [ ] A known test patient/screening from before the backup point can be found.
- [ ] The app, pointed at the restored database in a non-production setting,
      loads patients, screenings and referrals without errors.
- [ ] No real patient data was left behind in a throwaway project (§5, step 6).
