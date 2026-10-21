#!/usr/bin/env node
/**
 * seed-demo — EXPLICIT demo seeding (Phase 2). Never run in production.
 *
 * Inserts the demo fixture users (DEMO_USERS from src/lib/synthetic-fixtures.ts,
 * mirrored below) + the demo ASHA worker profile into Postgres via `pg`,
 * using the same SQL_* env vars as the app. The app itself NEVER seeds
 * automatically; the repository's ensureSyntheticDemoSeeded() also stays
 * inert unless SEED_DEMO_DATA=true is set for a local/demo install.
 *
 * Usage (local/demo only):
 *   SQL_HOST=... SQL_DB_NAME=... SQL_USER=... SQL_PASSWORD=... node scripts/seed-demo.mjs
 *
 * Prerequisite: migrations 0001 + 0002 applied.
 * NOTE: these demo accounts are database rows only — they have no
 * Supabase Auth login and CANNOT sign in. For sign-in testing, create a
 * user in the Supabase Auth dashboard and assign roles in /admin.
 */
import pg from 'pg';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data with NODE_ENV=production.');
  process.exit(1);
}
const { Client } = pg;
const client = new Client({
  host: process.env.SQL_HOST,
  port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : 5432,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DB_NAME,
});
if (!process.env.SQL_HOST || !process.env.SQL_DB_NAME) {
  console.error('SQL_HOST and SQL_DB_NAME are required (see .env.example).');
  process.exit(1);
}

const DEMO = [
  {
    uid: 'demo-asha-01',
    email: 'sunita.asha.demo@swasthyasetu.example.org',
    fullName: 'Sunita Devi (ASHA-UP-204)',
    role: 'health_worker',
    facilityName: 'Sub-Centre Rampur · Sitapur, Uttar Pradesh',
    assignedVillage: 'Rampur',
    profile: {
      workerCode: 'ASHA-UP-204',
      assignedVillage: 'Rampur',
      blockName: 'Sitapur Rural',
      district: 'Sitapur',
      primaryPhc: 'PHC Rampur',
      phoneLastFour: '4821',
    },
  },
  {
    uid: 'demo-doctor-01',
    email: 'dr.verma.phc.demo@swasthyasetu.example.org',
    fullName: 'Dr. Rajesh Verma (MO-PHC)',
    role: 'doctor',
    facilityName: 'PHC Rampur, Sitapur, Uttar Pradesh',
    assignedVillage: null,
    profile: null,
  },
];

await client.connect();
try {
  for (const u of DEMO) {
    await client.query(
      `INSERT INTO public.users (uid, email, full_name, role, facility_name, preferred_language, is_active, assigned_village)
       VALUES ($1,$2,$3,$4,$5,'en',TRUE,$6) ON CONFLICT (uid) DO NOTHING`,
      [u.uid, u.email, u.fullName, u.role, u.facilityName, u.assignedVillage]
    );
    if (u.profile) {
      const wp = u.profile;
      await client.query(
        `INSERT INTO public.health_worker_profiles (user_uid, worker_code, assigned_village, block_name, district, primary_phc, phone_last_four)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (user_uid) DO NOTHING`,
        [u.uid, wp.workerCode, wp.assignedVillage, wp.blockName, wp.district, wp.primaryPhc, wp.phoneLastFour]
      );
    }
    console.log(`seeded (or already present): ${u.uid} (${u.role})`);
  }
  console.log('Demo seed complete. These rows are fixtures for local/demo use only.');
} finally {
  await client.end();
}
