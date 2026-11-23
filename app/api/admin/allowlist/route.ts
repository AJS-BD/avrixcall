import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin-auth';
import { getServiceClient } from '@/lib/supabase-server';
import { normalizePhone } from '@/lib/phone';

// Member management (the allowlist). Only members on this list can join
// a call: the join route checks the full number, then mints a LiveKit
// token. Admin-only — every handler checks the admin cookie first.
// No OTP/SMS in this round: numbers are typed, not verified.

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const db = getServiceClient();
  const { data, error } = await db
    .from('avrix_call_allowlist')
    .select('phone, name, created_at')
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: 'Could not load members.' },
      { status: 500 },
    );
  }
  // Merge face enrollment status (booleans only — descriptors are
  // biometric data and never leave the server). If the face table is
  // not there yet (migration 0003 not run), everyone reads as not
  // enrolled rather than failing the whole member list.
  const { data: faceRows } = await db
    .from('avrix_call_face_profiles')
    .select('phone');
  const enrolledPhones = new Set(
    (faceRows ?? []).map((r) => r.phone as string),
  );
  const members = (data ?? []).map((m) => ({
    ...m,
    face_enrolled: enrolledPhones.has(m.phone),
  }));
  return NextResponse.json({ members });
}

export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const phone =
    typeof body?.phone === 'string' ? normalizePhone(body.phone) : null;
  const name =
    typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : null;
  if (!phone) {
    return NextResponse.json(
      { error: 'Enter a valid phone number, e.g. 01XXXXXXXXX.' },
      { status: 400 },
    );
  }
  const db = getServiceClient();
  const { data, error } = await db
    .from('avrix_call_allowlist')
    .upsert({ phone, name: name || null }, { onConflict: 'phone' })
    .select('phone, name, created_at')
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: 'Could not add the member.' },
      { status: 500 },
    );
  }
  return NextResponse.json({ member: data }, { status: 201 });
}

export async function DELETE(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const phone =
    typeof body?.phone === 'string' ? normalizePhone(body.phone) : null;
  if (!phone) {
    return NextResponse.json(
      { error: 'Enter a valid phone number.' },
      { status: 400 },
    );
  }
  const db = getServiceClient();
  const { error } = await db
    .from('avrix_call_allowlist')
    .delete()
    .eq('phone', phone);
  if (error) {
    return NextResponse.json(
      { error: 'Could not remove the member.' },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
