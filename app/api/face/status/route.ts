import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { normalizePhone } from '@/lib/phone';

// GET /api/face/status?phone=...
// Tells the join/enroll UI whether a number is registered and, if so,
// whether it already has a face enrolled — so the UI knows whether a
// face scan is required. Returns booleans ONLY: the stored descriptor
// is biometric data and is never returned to any client.
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('phone') ?? '';
  const phone = normalizePhone(raw);
  if (!phone) {
    return NextResponse.json(
      { error: 'Enter a valid phone number, e.g. 01XXXXXXXXX.' },
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
    return NextResponse.json({ enrolled: false, registered: false });
  }

  const { data: profile } = await db
    .from('avrix_call_face_profiles')
    .select('phone')
    .eq('phone', phone)
    .maybeSingle();

  return NextResponse.json({ enrolled: !!profile, registered: true });
}
