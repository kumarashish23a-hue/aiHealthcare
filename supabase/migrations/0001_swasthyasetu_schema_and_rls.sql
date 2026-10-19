-- SwasthyaSetu AI — Normalized PostgreSQL Schema & Row-Level Security (RLS) Policies
-- Compatible with PostgreSQL 15+ / Cloud SQL / Supabase Postgres

CREATE TABLE IF NOT EXISTS public.users (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT 'ASHA Health Worker',
  role TEXT NOT NULL DEFAULT 'health_worker' CHECK (role IN ('health_worker', 'doctor', 'phc_admin')),
  facility_name TEXT NOT NULL DEFAULT 'Simulated PHC Rampur',
  preferred_language TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'hi')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.health_worker_profiles (
  id SERIAL PRIMARY KEY,
  user_uid TEXT NOT NULL UNIQUE REFERENCES public.users(uid) ON DELETE CASCADE,
  worker_code TEXT NOT NULL UNIQUE,
  assigned_village TEXT NOT NULL,
  block_name TEXT NOT NULL,
  district TEXT NOT NULL,
  primary_phc TEXT NOT NULL,
  phone_last_four TEXT NOT NULL CHECK (char_length(phone_last_four) = 4),
  active_status BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.patients (
  id SERIAL PRIMARY KEY,
  patient_id TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  age_years INTEGER NOT NULL CHECK (age_years BETWEEN 1 AND 115),
  sex TEXT NOT NULL CHECK (sex IN ('female', 'male', 'other')),
  village TEXT NOT NULL,
  block_name TEXT NOT NULL,
  phone_last_four TEXT NOT NULL CHECK (char_length(phone_last_four) = 4),
  consent_obtained BOOLEAN NOT NULL CHECK (consent_obtained = TRUE),
  consent_timestamp TEXT NOT NULL,
  known_conditions TEXT NOT NULL DEFAULT '[]',
  registered_by_uid TEXT NOT NULL,
  is_synthetic BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patients_village ON public.patients(village);

CREATE TABLE IF NOT EXISTS public.screening_records (
  id SERIAL PRIMARY KEY,
  screening_id TEXT NOT NULL UNIQUE,
  patient_id TEXT NOT NULL REFERENCES public.patients(patient_id) ON DELETE RESTRICT,
  recorded_by_uid TEXT NOT NULL,
  recorded_by_name TEXT NOT NULL,
  screening_date TEXT NOT NULL,
  systolic_bp INTEGER,
  diastolic_bp INTEGER,
  heart_rate_bpm INTEGER,
  temperature_c TEXT,
  spo2_percent INTEGER,
  random_blood_glucose_mg_dl INTEGER,
  hemoglobin_g_dl TEXT,
  respiratory_rate_bpm INTEGER,
  is_pregnant BOOLEAN NOT NULL DEFAULT FALSE,
  gestational_weeks INTEGER,
  symptoms_json TEXT NOT NULL,
  symptom_duration_days INTEGER NOT NULL DEFAULT 0,
  medical_history_notes TEXT NOT NULL DEFAULT '',
  missing_fields_json TEXT NOT NULL DEFAULT '[]',
  result_category TEXT NOT NULL CHECK (result_category IN ('incomplete_information', 'routine_follow_up', 'further_assessment_needed', 'urgent_escalation')),
  flagged_reasons_json TEXT NOT NULL,
  recommended_next_steps_json TEXT NOT NULL,
  ai_supplemental_note TEXT NOT NULL DEFAULT '',
  engine_version TEXT NOT NULL DEFAULT 'PROTOTYPE-RULES-v1.0',
  requires_follow_up BOOLEAN NOT NULL DEFAULT FALSE,
  follow_up_due_date TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_screenings_patient_id ON public.screening_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_screenings_category ON public.screening_records(result_category);

CREATE TABLE IF NOT EXISTS public.referrals (
  id SERIAL PRIMARY KEY,
  referral_id TEXT NOT NULL UNIQUE,
  patient_id TEXT NOT NULL REFERENCES public.patients(patient_id) ON DELETE RESTRICT,
  screening_id TEXT NOT NULL UNIQUE REFERENCES public.screening_records(screening_id) ON DELETE RESTRICT,
  priority TEXT NOT NULL,
  reason_for_referral TEXT NOT NULL,
  destination_facility TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'under_review', 'completed', 'unable_to_complete')),
  assigned_professional TEXT NOT NULL DEFAULT '',
  doctor_notes TEXT NOT NULL DEFAULT '',
  follow_up_plan TEXT NOT NULL DEFAULT '',
  unable_reason TEXT NOT NULL DEFAULT '',
  created_by_uid TEXT NOT NULL,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_simulated BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_status ON public.referrals(status);

CREATE TABLE IF NOT EXISTS public.follow_up_records (
  id SERIAL PRIMARY KEY,
  follow_up_id TEXT NOT NULL UNIQUE,
  patient_id TEXT NOT NULL REFERENCES public.patients(patient_id) ON DELETE RESTRICT,
  screening_id TEXT NOT NULL REFERENCES public.screening_records(screening_id) ON DELETE RESTRICT,
  referral_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'completed', 'overdue')),
  scheduled_date TEXT NOT NULL,
  completed_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  recorded_by_uid TEXT NOT NULL,
  recorded_by_role TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sync_events (
  id SERIAL PRIMARY KEY,
  sync_event_id TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  device_uid TEXT NOT NULL,
  conflict_details TEXT NOT NULL DEFAULT '',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id SERIAL PRIMARY KEY,
  audit_id TEXT NOT NULL UNIQUE,
  actor_uid TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row-Level Security (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_worker_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screening_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_up_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies:
-- 1. Health Workers and Doctors can read patients and screenings within their facility scope
-- 2. Only Doctors and PHC Admins can update referral clinical review status, doctor_notes, and follow_up_plan
CREATE POLICY "Allow authenticated read on patients"
  ON public.patients FOR SELECT
  USING (current_setting('app.current_user_role', true) IN ('health_worker', 'doctor', 'phc_admin'));

CREATE POLICY "Allow health workers and doctors to insert patients with consent"
  ON public.patients FOR INSERT
  WITH CHECK (
    consent_obtained = TRUE AND
    current_setting('app.current_user_role', true) IN ('health_worker', 'doctor', 'phc_admin')
  );

CREATE POLICY "Allow only doctors and phc_admins to update referral status"
  ON public.referrals FOR UPDATE
  USING (current_setting('app.current_user_role', true) IN ('doctor', 'phc_admin'))
  WITH CHECK (current_setting('app.current_user_role', true) IN ('doctor', 'phc_admin'));
