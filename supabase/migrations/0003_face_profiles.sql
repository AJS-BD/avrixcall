-- AvrixCall — browser-only face verification (MVP).
-- Run in the Supabase SQL editor of the SHARED Avrixlab project AFTER
-- 0001/0002. Creates ONLY one new table and widens one check constraint;
-- touches no existing data. Safe to re-run.
--
-- Face profiles: one row per member phone number. `descriptor` is a
-- 128-number face descriptor (jsonb array) computed IN THE MEMBER'S
-- BROWSER by @vladmandic/face-api — no photo is ever uploaded or stored.
-- Like the allowlist, this table has RLS enabled with NO policies: all
-- reads/writes go through server routes with the service-role key, and
-- the descriptor is never returned to any client.

create table if not exists public.avrix_call_face_profiles (
  phone text primary key,
  descriptor jsonb not null,
  model text not null default 'face-api-128d',
  consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.avrix_call_face_profiles enable row level security;
-- Deliberately NO policies on avrix_call_face_profiles: descriptors are
-- biometric data. Server routes (service-role key) only.

-- Widen the blocked-attempt reasons for face verification outcomes:
-- 'face_mismatch' (scan did not match the enrolled face) and
-- 'face_required' (a face was required but none was supplied).
alter table public.avrix_call_blocked_attempts
  drop constraint if exists avrix_call_blocked_attempts_reason_check;

alter table public.avrix_call_blocked_attempts
  add constraint avrix_call_blocked_attempts_reason_check
  check (reason in ('not_registered', 'already_in_meeting', 'face_mismatch', 'face_required'));
