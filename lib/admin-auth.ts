import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

// Test-grade admin auth: one shared password from env, proven by an
// HMAC-signed httpOnly cookie. Good enough for this small-scale test;
// replace with real accounts before any production use.
export const ADMIN_COOKIE = 'avrixcall_admin';

const TOKEN_MESSAGE = 'avrixcall-admin';

export function signAdminToken(secret: string): string {
  return createHmac('sha256', secret).update(TOKEN_MESSAGE).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Constant-time password check (compares hashes, not raw strings). */
export function passwordsMatch(input: string, secret: string): boolean {
  const a = createHmac('sha256', 'avrixcall-login').update(input).digest('hex');
  const b = createHmac('sha256', 'avrixcall-login').update(secret).digest('hex');
  return safeEqual(a, b);
}

export async function isAdmin(): Promise<boolean> {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return false;
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  return safeEqual(token, signAdminToken(secret));
}
