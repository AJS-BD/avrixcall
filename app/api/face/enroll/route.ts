import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { normalizePhone } from '@/lib/phone';
import { isValidDescriptor } from '@/lib/face';
import { isAdmin } from '@/lib/admin-auth';

// POST /api/face/enroll { phone, descriptor, consent }
// Enrolls (or re-enrolls) a member's face. The descriptor is 128 numbers
// computed in the member's own browser — no photo is ever sent or
// stored. Only numbers already on the allowlist can enroll, and only
// with explicit consent (consent === true).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const phone =
    typeof body?.phone === 'string' ? normalizePhone(body.phone) : null;
  if (!phone) {
    return NextResponse.json(
      { error: 'Enter a valid phone number, e.g. 01XXXXXXXXX.' },
      { status: 400 },
    );
  }
  if (body?.consent !== true) {
    return NextResponse.json(
      { error: 'Face enrollment needs your consent — tick the consent box first.' },
      { status: 400 },
    );
  }
  if (!isValidDescriptor(body?.descriptor)) {
    return NextResponse.json(
      { error: 'That face scan did not come through properly — try the scan again.' },
      { status: 400 },
    );
  }

  const db = getServiceClient();

  const { data: member } = await db
    .from('avrix_call_allowlist')
    .select('phone')
    .eq('phone', phone)
    .maybeSingle();
  if (!member) {
    return NextResponse.json(
      { error: 'This number is not registered for AvrixCall — ask the admin to add it first.' },
      { status: 403 },
    );
  }

  const now = new Date().toISOString();
  const { error } = await db.from('avrix_call_face_profiles').upsert(
    {
      phone,
      descriptor: body.descriptor as number[],
      model: 'face-api-128d',
      consent_at: now,
      updated_at: now,
    },
    { onConflict: 'phone' },
  );
  if (error) {
    return NextResponse.json(
      { error: 'Could not save your face enrollment. Try again.' },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, enrolled: true });
}

// DELETE /api/face/enroll { phone }
// Admin-only: removes a member's enrolled face (they go back to
// phone-only joining until they enroll again).
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
    .from('avrix_call_face_profiles')
    .delete()
    .eq('phone', phone);
  if (error) {
    return NextResponse.json(
      { error: 'Could not remove the face enrollment.' },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
