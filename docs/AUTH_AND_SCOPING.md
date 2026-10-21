# Auth & Data Scoping — How It Works

_Implemented in the production build (Phases 1–3). This is the one coherent mechanism; there is no second auth path._

## Sign-in

- Browser: Supabase Auth via `@supabase/supabase-js` (`src/lib/supabase-client.ts`), email + password, in `components/LoginPanel.tsx`. Sign-up is offered; if the Supabase project requires email confirmation, the user must confirm (or an admin confirms them) before the first sign-in.
- The access token (short-lived Supabase JWT) is mirrored to `sessionStorage` (`src/lib/auth-token.ts`) so the app's fetch call sites can build headers synchronously. It is never stored in localStorage and never sent anywhere except this app's own API routes.
- If `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are not set, the login panel shows a "sign-in is not configured" notice and disables sign-in. There is no fallback login.

## Server verification

- `src/lib/auth-server.ts` → `src/lib/supabase-auth.ts`: the Bearer token is verified by calling Supabase Auth's `GET /auth/v1/user` with the anon key (Supabase validates signature + expiry server-side). If `SUPABASE_URL` is unset but `SUPABASE_JWKS_URL` is set, the JWT is verified locally against the JWKS with `jose` instead.
- The prototype demo tokens (`demo-session-asha`, `demo-session-doctor`) are explicitly rejected with a clear error.

## Roles

- Role, facility, assigned village and active flag come from the `public.users` row for the verified uid (`users.role`, `users.facility_name`, `users.assigned_village`, `users.is_active` — the last two added by migration 0002).
- No header can set a role. The old `x-active-role` header is ignored entirely; the demo role switcher and demo PIN have been removed from the UI.
- First verified sign-in creates the users row with role `health_worker` (lowest privilege). Elevating a role is an admin action (below), never self-service. Profile completion (`save_profile`) requires `payload.uid ===` the authenticated uid and `payload.role ===` the role already on the account.
- Deactivated accounts (`is_active = false`) are rejected at authentication with a clear message.

## Route gates

- `/doctor` pages: the layout loads the workspace with the caller's token; the server scopes the data, and the layout shows an Access Restricted panel when the account role is `health_worker`. Referral updates are additionally enforced server-side by `updateReferralByDoctor` (doctor/phc_admin only).
- `/admin`: the page shows an Access Restricted panel unless the workspace response's `actor.role` is `phc_admin`. Independently, every admin API action (`list_users`, `set_user_active`, `update_user_assignment`, CSV reports) is enforced server-side — the UI gate is not the security boundary.

## Data scoping (API path)

Enforced in the repository before data leaves the server (`src/lib/scoping.ts`, used by `getScopedWorkspaceData`), on top of the full dataset read:

- **phc_admin:** everything.
- **doctor:** referrals whose destination facility's core name matches the doctor's facility (e.g. "PHC Rampur"), plus the patients/screenings/follow-ups linked to those referrals, plus records he created/recorded.
- **health_worker:** patients she registered or in her assigned village, plus linked screenings/referrals/follow-ups and her own records.
- **Audit logs:** admin sees all; doctor sees entries for his scoped records + his own; worker sees only her own.
- **Profiles:** admin sees all; others only their own.
- Mutations: `record_screening` and `create_referral` check the patient is inside the actor's scope (`canAccessPatient`); `update_referral` is doctor/admin-only in the repository.
- Pagination guard: `GET /api/workspace?limit=` with default 200, max 500 per collection; the response's `pagination` block reports scoped totals and whether lists were truncated. Metrics are computed on the full scoped set, not the truncated page.

## RLS (direct Supabase access path)

Migration `0002_production_auth_scoping.sql` completes RLS for all tables (users, health_worker_profiles, patients, screening_records, referrals, follow_up_records, sync_events, audit_logs, facilities). Policies key off `auth.uid()` (the caller's Supabase JWT) and mirror the app-layer scoping; audit_logs/sync_events have no UPDATE/DELETE policies (append-only).

The application server itself connects via Drizzle/pg with a privileged role that bypasses RLS — that is why app-layer enforcement above is the primary mechanism on the API path, and RLS is the protection for any direct PostgREST/supabase-js access. Both mechanisms use the same source of truth: the `users` table.

## Session lock PIN

The lock PIN is set by the user on first sign-in (4–6 digits, set + confirm). Only a salted SHA-256 hash is stored in localStorage (`src/lib/pin.ts`). There is no default PIN. The PIN locks the screen on a shared device; it is not an authentication factor.

## User live steps this depends on

1. Create the Supabase project; run migrations 0001 then 0002 in the SQL Editor.
2. Set the env vars (`.env.example`) locally and in Vercel.
3. Create the first `phc_admin`: sign up once via the app (creates a health_worker row), then in the SQL Editor run `UPDATE public.users SET role='phc_admin' WHERE uid='<the auth user id>';` — after that, roles are managed from `/admin`.
4. Decide the project's email-confirmation setting (Supabase dashboard → Authentication). For a closed pilot, creating users directly in the Supabase dashboard and assigning roles in `/admin` is the simplest flow.
