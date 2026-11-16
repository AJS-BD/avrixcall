import { NextResponse } from 'next/server';
import { normalizePhone } from '@/lib/phone';
import { getServiceClient } from '@/lib/supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';

// Best-effort: a failed audit insert must never change the join answer.
async function recordBlockedAttempt(
  db: SupabaseClient,
  attempt: {
    callId: string;
    phone: string;
    attemptedName: string;
    reason: 'not_registered' | 'already_in_meeting';
    activeCallId: string | null;
  },
) {
  try {
    await db.from('avrix_call_blocked_attempts').insert({
      call_id: attempt.callId,
      phone: attempt.phone,
      attempted_name: attempt.attemptedName,
      reason: attempt.reason,
      active_call_id: attempt.activeCallId,
    });
  } catch {
    // Ignore — the join response is what matters.
  }
}

// GET /api/calls/[id]/join?participant_id=...
// Verifies a stored seat is still active (used on page reload so a
// joiner whose seat was freed does not silently re-enter without one).
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
// The phone number IS the credential: it must be on the allowlist.
// One phone number = ONE active seat SYSTEM-WIDE. A number can join
// meetings over time, but it holds only one active seat at any moment.
// A blocked attempt never touches the session already inside.
export async function POST(
  req: Request,
  ctx: RouteContext<'/api/calls/[id]/join'>,
) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const phone = normalizePhone(
    typeof body?.phone === 'string' ? body.phone : '',
  );
  const existingPid =
    typeof body?.participant_id === 'string' ? body.participant_id : null;

  if (!name || name.length > 60) {
    return NextResponse.json(
      { error: 'Enter your name.' },
      { status: 400 },
    );
  }
  if (!phone) {
    return NextResponse.json(
      { error: 'Enter a valid Bangladeshi phone number.' },
      { status: 400 },
    );
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

  // Idempotent rejoin: same browser, same seat, still active.
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

  // The number must already be known to us (the allowlist).
  const { data: allowed } = await db
    .from('avrix_call_allowlist')
    .select('phone')
    .eq('phone', phone)
    .maybeSingle();
  if (!allowed) {
    await recordBlockedAttempt(db, {
      callId: id,
      phone,
      attemptedName: name,
      reason: 'not_registered',
      activeCallId: null,
    });
    return NextResponse.json(
      {
        error:
          'This number is not registered for AvrixCall — ask the admin to add it.',
      },
      { status: 403 },
    );
  }

  // One active seat per phone SYSTEM-WIDE (any call, not just this one).
  const { data: active } = await db
    .from('avrix_call_participants')
    .select('id, call_id')
    .eq('phone', phone)
    .is('left_at', null)
    .maybeSingle();
  if (active) {
    await recordBlockedAttempt(db, {
      callId: id,
      phone,
      attemptedName: name,
      reason: 'already_in_meeting',
      activeCallId: (active as { call_id: string }).call_id,
    });
    return NextResponse.json(
      { error: 'This number is already in a meeting.' },
      { status: 409 },
    );
  }

  const participantId = crypto.randomUUID();
  const { data, error } = await db
    .from('avrix_call_participants')
    .insert({ call_id: id, phone, name, participant_id: participantId })
    .select('participant_id, name')
    .single();
  if (error || !data) {
    // Race-safe backstop: the partial unique index (phone)
    // WHERE left_at IS NULL rejects a second active seat.
    if (error?.code === '23505') {
      return NextResponse.json(
        { error: 'This number is already in a meeting.' },
        { status: 409 },
      );
    }
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
