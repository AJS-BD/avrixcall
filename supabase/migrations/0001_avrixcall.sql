-- AvrixCall — group calls for Avrixlab investors.
-- Run once in the Supabase SQL editor of the SHARED Avrixlab project
-- (ref vdutlzgqucpzfpwkotfg). Creates ONLY new tables; touches no
-- existing table. Safe to re-run: tables, index and policies are guarded.

create table if not exists public.avrix_calls (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  room_name text not null unique,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'live', 'ended')),
  scheduled_at timestamptz null,
  current_speaker_id text null,
  current_speaker_name text null,
  created_at timestamptz not null default now(),
  ended_at timestamptz null
);

create table if not exists public.avrix_call_messages (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.avrix_calls (id) on delete cascade,
  sender_name text not null,
  sender_role text not null default 'guest'
    check (sender_role in ('admin', 'guest')),
  -- Client-supplied id of the verified join (null for admin messages).
  -- v1 does not verify chat authorship server-side (see README).
  participant_id text null,
  body text not null check (char_length(body) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists avrix_call_messages_call_id_created_idx
  on public.avrix_call_messages (call_id, created_at);

-- Allowlist: phone numbers allowed to join AvrixCall. The main Avrixlab
-- database has NO phone column anywhere, so AvrixCall keeps its own list.
create table if not exists public.avrix_call_allowlist (
  phone text primary key,
  name text null,
  created_at timestamptz not null default now()
);

-- One row per join. left_at null = currently in a meeting. The partial
-- unique index enforces ONE active seat per phone SYSTEM-WIDE (a number
-- can join meetings over time, but holds only one active seat at any
-- moment), so a double-join race cannot create two seats.
create table if not exists public.avrix_call_participants (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.avrix_calls (id) on delete cascade,
  phone text not null,
  name text not null,
  participant_id text not null unique,
  joined_at timestamptz not null default now(),
  left_at timestamptz null
);

create unique index if not exists avrix_call_participants_active_one
  on public.avrix_call_participants (phone)
  where left_at is null;

create index if not exists avrix_call_participants_call_id_idx
  on public.avrix_call_participants (call_id, joined_at);

-- Blocked join attempts, for the admin's live alert. One row per rejected
-- join: 'not_registered' (number not on the allowlist) or
-- 'already_in_meeting' (number already holds an active seat in another
-- call — active_call_id says which one). Never reveals who owns a number.
create table if not exists public.avrix_call_blocked_attempts (
  id uuid primary key default gen_random_uuid(),
  call_id uuid null references public.avrix_calls (id) on delete set null,
  phone text not null,
  attempted_name text null,
  reason text not null
    check (reason in ('not_registered', 'already_in_meeting')),
  active_call_id uuid null,
  attempted_at timestamptz not null default now()
);

create index if not exists avrix_call_blocked_attempts_time_idx
  on public.avrix_call_blocked_attempts (attempted_at desc);

alter table public.avrix_calls enable row level security;
alter table public.avrix_call_messages enable row level security;
alter table public.avrix_call_allowlist enable row level security;
alter table public.avrix_call_participants enable row level security;
alter table public.avrix_call_blocked_attempts enable row level security;
-- Deliberately NO policies on the allowlist, participants and
-- blocked-attempts tables: phone numbers are sensitive. All reads/writes
-- go through server routes with the service-role key.

-- Public read: anyone can see the call list and the chat history.
drop policy if exists "Public can view calls" on public.avrix_calls;
create policy "Public can view calls"
  on public.avrix_calls for select
  to anon, authenticated
  using (true);

drop policy if exists "Public can view call messages" on public.avrix_call_messages;
create policy "Public can view call messages"
  on public.avrix_call_messages for select
  to anon, authenticated
  using (true);

-- Anyone can post a chat message with a display name (no account needed).
-- Admin writes to avrix_calls go through server routes with the
-- service-role key, which bypasses RLS, so there is deliberately NO
-- anon insert/update/delete policy on avrix_calls.
drop policy if exists "Anyone can post a call message" on public.avrix_call_messages;
create policy "Anyone can post a call message"
  on public.avrix_call_messages for insert
  to anon, authenticated
  with check (char_length(body) <= 1000);

-- Realtime: postgres_changes subscriptions (chat + speaker banner) only
-- fire for tables in the supabase_realtime publication.
do $$
begin
  alter publication supabase_realtime add table public.avrix_calls;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.avrix_call_messages;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.avrix_call_blocked_attempts;
exception when duplicate_object then null;
end $$;
