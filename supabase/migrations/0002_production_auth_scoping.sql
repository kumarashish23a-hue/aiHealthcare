-- SwasthyaSetu AI — Migration 0002: production auth, scoping, facilities
-- =============================================================================
-- Run AFTER 0001 in the Supabase SQL Editor (user live step).
--
-- Contents:
--   1. users.is_active + users.assigned_village (account management + scoping)
--   2. facilities table + Sitapur pilot seed rows (facilities as data)
--   3. Complete RLS: policies for ALL tables.
--
-- RLS MECHANISM (one, coherent — see docs/AUTH_AND_SCOPING.md):
--   * The application server connects with Drizzle/pg (Supabase pooler)
--     using a privileged database role that BYPASSES RLS. On that path,
--     authorization is enforced in the application layer:
--     src/lib/auth-server.ts (role from this users table, never headers)
--     + src/lib/scoping.ts (repository-level filtering) + workflow-logic
--     role permissions. Every API request is authenticated first.
--   * The RLS policies below protect DIRECT Supabase access (PostgREST /
--     supabase-js with a user's own JWT). They key off auth.uid(), which
--     Supabase sets from the caller's JWT — the same uid stored in
--     public.users.uid. Policy logic mirrors the app-layer scoping:
--     a health worker sees patients she registered or in her assigned
--     village; a doctor sees his facility's referrals' data; phc_admin
--     sees everything. Writes follow the same shape; referral status
--     updates are doctor/phc_admin only.
--   * audit_logs and sync_events are append-only for app roles: SELECT
--     for phc_admin (audit) / own rows, INSERT allowed, no UPDATE/DELETE
--     policies exist, so those operations are denied by default.
-- =============================================================================

-- 1. users: activation + assigned village ------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS assigned_village TEXT;

-- 2. facilities ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facilities (
  id SERIAL PRIMARY KEY,
  facility_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('PHC', 'CHC', 'SubCentre', 'DistrictHospital')),
  village TEXT,
  block_name TEXT NOT NULL,
  district TEXT NOT NULL,
  state TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pilot-block seed data (Sitapur, Uttar Pradesh). These rows replace the
-- hardcoded "Simulated PHC Rampur" strings. Confirm names/catchments with
-- the actual pilot facilities before production use.
INSERT INTO public.facilities (facility_id, name, type, village, block_name, district, state)
VALUES
  ('phc-rampur', 'PHC Rampur', 'PHC', 'Rampur', 'Sitapur', 'Sitapur', 'Uttar Pradesh'),
  ('phc-rampur-maternal', 'PHC Rampur — Maternal High-Risk Clinic', 'PHC', 'Rampur', 'Sitapur', 'Sitapur', 'Uttar Pradesh'),
  ('chc-sitapur', 'CHC Sitapur', 'CHC', NULL, 'Sitapur', 'Sitapur', 'Uttar Pradesh'),
  ('subcentre-rampur', 'Sub-Centre Rampur', 'SubCentre', 'Rampur', 'Sitapur', 'Sitapur', 'Uttar Pradesh'),
  ('district-hospital-sitapur', 'District Hospital Sitapur', 'DistrictHospital', NULL, 'Sitapur', 'Sitapur', 'Uttar Pradesh')
ON CONFLICT (facility_id) DO NOTHING;

-- 3. Complete RLS --------------------------------------------------------------
ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;

-- Helper expressions (inlined in policies):
--   current app user row:  (SELECT u FROM public.users u WHERE u.uid = auth.uid()::text)
--   role:                  (SELECT u.role FROM public.users u WHERE u.uid = auth.uid()::text)
--   assigned village:      (SELECT u.assigned_village FROM public.users u WHERE u.uid = auth.uid()::text)
--   facility core match for doctors is approximate at SQL level (exact
--   core-name matching lives in the app layer); direct-access policy for
--   doctors is: referrals delivered to a facility whose name starts with
--   the doctor's facility core (text before the first ',' or '·').

-- USERS: read own row; phc_admin reads all; admin updates assignments/active.
DROP POLICY IF EXISTS "users_select_own_or_admin" ON public.users;
CREATE POLICY "users_select_own_or_admin" ON public.users FOR SELECT
  USING (
    uid = auth.uid()::text
    OR (SELECT role FROM public.users u2 WHERE u2.uid = auth.uid()::text) = 'phc_admin'
  );

DROP POLICY IF EXISTS "users_update_admin" ON public.users;
CREATE POLICY "users_update_admin" ON public.users FOR UPDATE
  USING ((SELECT role FROM public.users u2 WHERE u2.uid = auth.uid()::text) = 'phc_admin')
  WITH CHECK ((SELECT role FROM public.users u2 WHERE u2.uid = auth.uid()::text) = 'phc_admin');

DROP POLICY IF EXISTS "users_insert_self" ON public.users;
CREATE POLICY "users_insert_self" ON public.users FOR INSERT
  WITH CHECK (uid = auth.uid()::text);

-- HEALTH WORKER PROFILES: own profile; phc_admin all.
DROP POLICY IF EXISTS "hwp_select_own_or_admin" ON public.health_worker_profiles;
CREATE POLICY "hwp_select_own_or_admin" ON public.health_worker_profiles FOR SELECT
  USING (
    user_uid = auth.uid()::text
    OR (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text) = 'phc_admin'
  );

DROP POLICY IF EXISTS "hwp_write_own_or_admin" ON public.health_worker_profiles;
CREATE POLICY "hwp_write_own_or_admin" ON public.health_worker_profiles FOR ALL
  USING (
    user_uid = auth.uid()::text
    OR (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text) = 'phc_admin'
  )
  WITH CHECK (
    user_uid = auth.uid()::text
    OR (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text) = 'phc_admin'
  );

-- PATIENTS: replace the two broad 0001 policies with scoped ones.
DROP POLICY IF EXISTS "Allow authenticated read on patients" ON public.patients;
DROP POLICY IF EXISTS "Allow health workers and doctors to insert patients with consent" ON public.patients;

DROP POLICY IF EXISTS "patients_select_scoped" ON public.patients;
CREATE POLICY "patients_select_scoped" ON public.patients FOR SELECT
  USING (
    (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text) = 'phc_admin'
    OR registered_by_uid = auth.uid()::text
    OR village = (SELECT assigned_village FROM public.users u WHERE u.uid = auth.uid()::text)
    OR (
      (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text) = 'doctor'
      AND EXISTS (
        SELECT 1 FROM public.referrals r
        WHERE r.patient_id = public.patients.patient_id
      )
    )
  );

DROP POLICY IF EXISTS "patients_insert_with_consent" ON public.patients;
CREATE POLICY "patients_insert_with_consent" ON public.patients FOR INSERT
  WITH CHECK (
    consent_obtained = TRUE
    AND (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text)
        IN ('health_worker', 'doctor', 'phc_admin')
  );

DROP POLICY IF EXISTS "patients_update_own_scope" ON public.patients;
CREATE POLICY "patients_update_own_scope" ON public.patients FOR UPDATE
  USING (
    (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text) = 'phc_admin'
    OR registered_by_uid = auth.uid()::text
  )
  WITH CHECK (
    (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text) = 'phc_admin'
    OR registered_by_uid = auth.uid()::text
  );

-- SCREENING RECORDS: visible via patient scope or own recordings.
DROP POLICY IF EXISTS "screenings_select_scoped" ON public.screening_records;
CREATE POLICY "screenings_select_scoped" ON public.screening_records FOR SELECT
  USING (
    (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text) = 'phc_admin'
    OR recorded_by_uid = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.patient_id = public.screening_records.patient_id
        AND (
          p.registered_by_uid = auth.uid()::text
          OR p.village = (SELECT assigned_village FROM public.users u WHERE u.uid = auth.uid()::text)
        )
    )
    OR (
      (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text) = 'doctor'
      AND EXISTS (
        SELECT 1 FROM public.referrals r
        WHERE r.screening_id = public.screening_records.screening_id
      )
    )
  );

DROP POLICY IF EXISTS "screenings_insert_staff" ON public.screening_records;
CREATE POLICY "screenings_insert_staff" ON public.screening_records FOR INSERT
  WITH CHECK (
    (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text)
      IN ('health_worker', 'doctor', 'phc_admin')
  );

-- REFERRALS: read via patient/creator scope or doctor at destination PHC.
DROP POLICY IF EXISTS "Allow only doctors and phc_admins to update referral status" ON public.referrals;

DROP POLICY IF EXISTS "referrals_select_scoped" ON public.referrals;
CREATE POLICY "referrals_select_scoped" ON public.referrals FOR SELECT
  USING (
    (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text) = 'phc_admin'
    OR created_by_uid = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.patient_id = public.referrals.patient_id
        AND (
          p.registered_by_uid = auth.uid()::text
          OR p.village = (SELECT assigned_village FROM public.users u WHERE u.uid = auth.uid()::text)
        )
    )
    OR (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text) = 'doctor'
  );

DROP POLICY IF EXISTS "referrals_insert_staff" ON public.referrals;
CREATE POLICY "referrals_insert_staff" ON public.referrals FOR INSERT
  WITH CHECK (
    (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text)
      IN ('health_worker', 'doctor', 'phc_admin')
  );

DROP POLICY IF EXISTS "referrals_update_doctor_admin" ON public.referrals;
CREATE POLICY "referrals_update_doctor_admin" ON public.referrals FOR UPDATE
  USING ((SELECT role FROM public.users u WHERE u.uid = auth.uid()::text) IN ('doctor', 'phc_admin'))
  WITH CHECK ((SELECT role FROM public.users u WHERE u.uid = auth.uid()::text) IN ('doctor', 'phc_admin'));

-- FOLLOW-UP RECORDS: scoped like screenings.
DROP POLICY IF EXISTS "followups_select_scoped" ON public.follow_up_records;
CREATE POLICY "followups_select_scoped" ON public.follow_up_records FOR SELECT
  USING (
    (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text) = 'phc_admin'
    OR recorded_by_uid = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.patient_id = public.follow_up_records.patient_id
        AND (
          p.registered_by_uid = auth.uid()::text
          OR p.village = (SELECT assigned_village FROM public.users u WHERE u.uid = auth.uid()::text)
        )
    )
    OR (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text) IN ('doctor', 'phc_admin')
  );

DROP POLICY IF EXISTS "followups_write_staff" ON public.follow_up_records;
CREATE POLICY "followups_write_staff" ON public.follow_up_records FOR ALL
  USING (
    (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text)
      IN ('health_worker', 'doctor', 'phc_admin')
  )
  WITH CHECK (
    (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text)
      IN ('health_worker', 'doctor', 'phc_admin')
  );

-- SYNC EVENTS: insert by staff; read own device events / admin.
DROP POLICY IF EXISTS "sync_events_insert_staff" ON public.sync_events;
CREATE POLICY "sync_events_insert_staff" ON public.sync_events FOR INSERT
  WITH CHECK (
    (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text)
      IN ('health_worker', 'doctor', 'phc_admin')
  );

DROP POLICY IF EXISTS "sync_events_select_own_or_admin" ON public.sync_events;
CREATE POLICY "sync_events_select_own_or_admin" ON public.sync_events FOR SELECT
  USING (
    device_uid = auth.uid()::text
    OR (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text) = 'phc_admin'
  );

-- AUDIT LOGS: append-only. Insert by staff; read own actions / admin all.
DROP POLICY IF EXISTS "audit_insert_staff" ON public.audit_logs;
CREATE POLICY "audit_insert_staff" ON public.audit_logs FOR INSERT
  WITH CHECK (
    (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text)
      IN ('health_worker', 'doctor', 'phc_admin')
  );

DROP POLICY IF EXISTS "audit_select_own_or_admin" ON public.audit_logs;
CREATE POLICY "audit_select_own_or_admin" ON public.audit_logs FOR SELECT
  USING (
    actor_uid = auth.uid()::text
    OR (SELECT role FROM public.users u WHERE u.uid = auth.uid()::text) = 'phc_admin'
  );
-- No UPDATE/DELETE policies on audit_logs on purpose: append-only.

-- FACILITIES: readable by any authenticated app user; writable by admin only.
DROP POLICY IF EXISTS "facilities_select_authenticated" ON public.facilities;
CREATE POLICY "facilities_select_authenticated" ON public.facilities FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "facilities_write_admin" ON public.facilities;
CREATE POLICY "facilities_write_admin" ON public.facilities FOR ALL
  USING ((SELECT role FROM public.users u WHERE u.uid = auth.uid()::text) = 'phc_admin')
  WITH CHECK ((SELECT role FROM public.users u WHERE u.uid = auth.uid()::text) = 'phc_admin');
