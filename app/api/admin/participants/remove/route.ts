import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin-auth';
import { getServiceClient } from '@/lib/supabase-server';

// POST /api/admin/participants/remove { call_id, participant_id }
// Sets left_at: frees the number to rejoin, and is the admin's "kick"
// (the dashboard also broadcasts a 'kicked' signal so the room client
// leaves at once). A kicked number CAN rejoin unless it is also removed
// from the allowlist.
export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const callId = typeof body?.call_id === 'string' ? body.call_id : '';
  const participantId =
    typeof body?.participant_id === 'string' ? body.participant_id : '';
  if (!callId || !participantId) {
    return NextResponse.json(
      { error: 'call_id and participant_id are required.' },
      { status: 400 },
    );
  }
  const db = getServiceClient();
  await db
    .from('avrix_call_participants')
    .update({ left_at: new Date().toISOString() })
    .eq('call_id', callId)
    .eq('participant_id', participantId)
    .is('left_at', null);
  return NextResponse.json({ ok: true });
}
