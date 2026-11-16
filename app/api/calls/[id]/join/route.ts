import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';

// GET /api/calls/[id]/join?participant_id=...
// Verifies a stored participant row is still active (used on page reload
// so a closed row does not silently re-enter).
export async function GET(
  req: Request,
  ctx: RouteContext<'/api/calls/[id]/join'>,
) {
  const { id } = await ctx.params;
  const participantId = new URL(req.url).searchParams.get('participant_id');
  if (!participantId) {
    return NextResponse.json({ active: false });
  }
  const db = getServiceClient();
  const { data } = await db
    .from('avrix_call_participants')
    .select('participant_id, name')
    .eq('call_id', id)
    .eq('participant_id', participantId)
    .is('left_at', null)
    .maybeSingle();
  if (!data) return NextResponse.json({ active: false });
  return NextResponse.json({
    active: true,
    participant_id: data.participant_id,
    name: data.name,
  });
}

// POST /api/calls/[id]/join { name, participant_id? }
// Plain Jitsi now: joining needs only a display name. No allowlist, no
// phone check, no seat limit — anyone with the room link can join.
// A lightweight participant row is still created so chat messages carry
// an identity and Leave can close the row.
//
// NOTE: avrix_call_participants.phone is NOT NULL (legacy column from
// the rules era) and a partial unique index enforces one active row per
// phone value. With no phone anymore, the row stores its own
// participant_id in that column — every row is unique by construction,
// so joins never collide. The column is not read anywhere.
export async function POST(
  req: Request,
  ctx: RouteContext<'/api/calls/[id]/join'>,
) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const existingPid =
    typeof body?.participant_id === 'string' ? body.participant_id : null;

  if (!name || name.length > 60) {
    return NextResponse.json({ error: 'Enter your name.' }, { status: 400 });
  }

  const db = getServiceClient();

  const { data: call } = await db
    .from('avrix_calls')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (!call) {
    return NextResponse.json({ error: 'Call not found.' }, { status: 404 });
  }
  if (call.status !== 'live') {
    return NextResponse.json(
      { error: 'This call has not started yet.' },
      { status: 409 },
    );
  }

  // Idempotent rejoin: same browser, same row, still active.
  if (existingPid) {
    const { data: existing } = await db
      .from('avrix_call_participants')
      .select('participant_id, name')
      .eq('call_id', id)
      .eq('participant_id', existingPid)
      .is('left_at', null)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({
        participant_id: existing.participant_id,
        name: existing.name,
      });
    }
  }

  const participantId = crypto.randomUUID();
  const { data, error } = await db
    .from('avrix_call_participants')
    .insert({
      call_id: id,
      phone: participantId,
      name,
      participant_id: participantId,
    })
    .select('participant_id, name')
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: 'Could not join the call.' },
      { status: 500 },
    );
  }
  return NextResponse.json({
    participant_id: data.participant_id,
    name: data.name,
  });
}
