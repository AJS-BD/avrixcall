import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';

// POST /api/calls/[id]/leave { participant_id }
// Frees the seat (sets left_at). Idempotent: leaving twice is fine.
// Called by the room on clean leave / page close (beacon, best effort),
// by the admin dashboard for stuck rows, and by the admin Remove button.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const participantId =
    typeof body?.participant_id === 'string' ? body.participant_id : '';
  if (!participantId) {
    return NextResponse.json(
      { error: 'participant_id is required.' },
      { status: 400 },
    );
  }
  const db = getServiceClient();
  await db
    .from('avrix_call_participants')
    .update({ left_at: new Date().toISOString() })
    .eq('participant_id', participantId)
    .is('left_at', null);
  return NextResponse.json({ ok: true });
}
