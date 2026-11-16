-- AvrixCall — call durations.
-- Adds started_at so the room can show a live elapsed timer and the admin
-- list can show each call's duration. Apply in the Supabase SQL editor of
-- the shared Avrixlab project (ref vdutlzgqucpzfpwkotfg). Safe to re-run:
-- IF NOT EXISTS. No other schema change.
ALTER TABLE public.avrix_calls ADD COLUMN IF NOT EXISTS started_at timestamptz;
