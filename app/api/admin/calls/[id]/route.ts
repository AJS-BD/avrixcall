import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin-auth';
import { getServiceClient } from '@/lib/supabase-server';

export async function PATCH(
  req: Request,
  ctx: RouteContext<'/api/admin/calls/[id]'>,
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  const db = getServiceClient();
  let patch: Record<string, unknown> | null = null;

  if (action === 'start') {
    patch = { status: 'live' };
  } else if (action === 'end') {
    patch = {
      status: 'ended',
      ended_at: new Date().toISOString(),
      current_speaker_id: null,
      current_speaker_name: null,
    };
  } else if (action === 'set-speaker') {
    const speakerId =
      typeof body?.speaker_id === 'string' ? body.speaker_id : null;
    const speakerName =
      typeof body?.speaker_name === 'string' ? body.speaker_name : null;
    patch = {
      current_speaker_id: speakerId,
      current_speaker_name: speakerName,
    };
  } else {
    return NextResponse.json(
      { error: 'Unknown action.' },
      { status: 400 },
    );
  }

  const { data, error } = await db
    .from('avrix_calls')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: 'Could not update the call.' },
      { status: 500 },
    );
  }
  return NextResponse.json({ call: data });
}
