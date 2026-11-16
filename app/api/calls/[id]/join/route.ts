import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { normalizePhone } from '@/lib/phone';
import { getLiveKitUrl, mintLiveKitToken } from '@/lib/livekit-token';

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

// POST /api/calls/[id]/join { name, phone, participant_id? }
// Member-only joining, LiveKit token-based:
//   1. The call must be live (scheduled/ended mints nothing).
//   2. The FULL phone number must be on the allowlist
//      (avrix_call_allowlist). Anything else is rejected with 403 and
//      logged in avrix_call_blocked_attempts for the admin.
//   3. A registered member gets a short-lived LiveKit access token
//      (6h, identity = their phone number). Without a token the
//      LiveKit server refuses the connection — a forwarded invite link
//      alone gets nobody in.
// A lightweight participant row is still created so chat messages carry
// an identity and Leave can close the row.
//
// NOTE: avrix_call_participants.phone is NOT NULL (legacy column from
// the rules era) and a partial unique index enforces one active row per
// phone value. The row stores its own participant_id in that column —
// every row is unique by construction, so joins never collide. The
// column is not read anywhere; the real phone is never stored on the
// participant row (it lives on the allowlist only).
export async function POST(
  req: Request,
  ctx: RouteContext<'/api/calls/[id]/join'>,
) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const phone =
    typeof body?.phone === 'string' ? normalizePhone(body.phone) : null;
  const existingPid =
    typeof body?.participant_id === 'string' ? body.participant_id : null;

  if (!name || name.length > 60) {
    return NextResponse.json({ error: 'Enter your name.' }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json(
      { error: 'Enter a valid phone number, e.g. 01XXXXXXXXX.' },
      { status: 400 },
    );
  }

  const db = getServiceClient();

  const { data: call } = await db
    .from('avrix_calls')
    .select('id, status, room_name')
    .eq('id', id)
    .maybeSingle();
  if (!call) {
    return NextResponse.json({ error: 'Call not found.' }, { status: 404 });
  }
  if (call.status !== 'live') {
    return NextResponse.json(
      {
        error:
          call.status === 'ended'
            ? 'This call has ended.'
            : 'This call has not started yet.',
        status: call.status,
      },
      { status: 409 },
    );
  }

  // Member check: the number must be registered.
  const { data: member } = await db
    .from('avrix_call_allowlist')
    .select('phone')
    .eq('phone', phone)
    .maybeSingle();
  if (!member) {
    // Log the rejected attempt for the admin (best effort).
    await db.from('avrix_call_blocked_attempts').insert({
      call_id: id,
      phone,
      attempted_name: name,
      reason: 'not_registered',
    });
    return NextResponse.json(
      { error: 'This number is not registered for AvrixCall — ask the admin to add it.' },
      { status: 403 },
    );
  }

  const livekitUrl = getLiveKitUrl();
  if (!livekitUrl) {
    return NextResponse.json(
      { error: 'Video is not configured yet. Ask the admin.' },
      { status: 503 },
    );
  }

  // Idempotent rejoin: same browser, same row, still active — fresh token.
  if (existingPid) {
    const { data: existing } = await db
      .from('avrix_call_participants')
      .select('participant_id, name')
      .eq('call_id', id)
      .eq('participant_id', existingPid)
      .is('left_at', null)
      .maybeSingle();
    if (existing) {
      const token = await mintLiveKitToken({
        roomName: call.room_name,
        identity: phone,
        name: existing.name,
      });
      if (!token) {
        return NextResponse.json(
          { error: 'Video is not configured yet. Ask the admin.' },
          { status: 503 },
        );
      }
      return NextResponse.json({
        participant_id: existing.participant_id,
        name: existing.name,
        token,
        url: livekitUrl,
        roomName: call.room_name,
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

  const token = await mintLiveKitToken({
    roomName: call.room_name,
    identity: phone,
    name: data.name,
  });
  if (!token) {
    return NextResponse.json(
      { error: 'Video is not configured yet. Ask the admin.' },
      { status: 503 },
    );
  }
  return NextResponse.json({
    participant_id: data.participant_id,
    name: data.name,
    token,
    url: livekitUrl,
    roomName: call.room_name,
  });
}
