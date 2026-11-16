import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Server-only service-role client. Bypasses RLS — used ONLY in API routes
// after the admin-cookie check. Never import this file from client code.
// Placeholder values keep `next build` working when env vars are absent;
// real values are required at runtime (see .env.example).
export function getServiceClient(): SupabaseClient {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'placeholder-service-key';
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
