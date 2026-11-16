import { createClient } from '@supabase/supabase-js';

// Browser (anon) client. The anon key is public by design — RLS on
// avrix_calls / avrix_call_messages limits what it can do (read both
// tables, insert chat messages only).
// Placeholder values keep `next build` working when env vars are absent;
// real values are required at runtime (see .env.example).
const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';

export const supabase = createClient(url, anonKey);
