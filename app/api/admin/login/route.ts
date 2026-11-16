import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  ADMIN_COOKIE,
  passwordsMatch,
  signAdminToken,
} from '@/lib/admin-auth';

export async function POST(req: Request) {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) {
    return NextResponse.json(
      { error: 'Admin password is not configured.' },
      { status: 500 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!passwordsMatch(password, secret)) {
    return NextResponse.json({ error: 'Wrong password.' }, { status: 401 });
  }
  const store = await cookies();
  store.set(ADMIN_COOKIE, signAdminToken(secret), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === 'production',
  });
  return NextResponse.json({ ok: true });
}
