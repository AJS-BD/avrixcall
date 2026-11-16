import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin-auth';
import { getServiceClient } from '@/lib/supabase-server';

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const db = getServiceClient();
  const { data, error } = await db
    .from('avrix_calls')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json({ error: 'Could not load calls.' }, { status: 500 });
  }
  return NextResponse.json({ calls: data ?? [] });
}

export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 200) {
    return NextResponse.json(
      { error: 'A title of 1–200 characters is required.' },
      { status: 400 },
    );
  }
  const startNow = body?.start_now === true;
  const scheduledAt =
    typeof body?.scheduled_at === 'string' ? body.scheduled_at : null;
  if (!startNow && scheduledAt && Number.isNaN(Date.parse(scheduledAt))) {
    return NextResponse.json(
      { error: 'Scheduled time is not a valid date.' },
      { status: 400 },
    );
  }
  const roomName = `avrixcall-${randomBytes(4).toString('hex')}`;
  const db = getServiceClient();
  const { data, error } = await db
    .from('avrix_calls')
    .insert({
      title,
      room_name: roomName,
      status: startNow ? 'live' : 'scheduled',
      scheduled_at: startNow ? null : scheduledAt,
    })
    .select()
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: 'Could not create the call.' },
      { status: 500 },
    );
  }
  return NextResponse.json({ call: data }, { status: 201 });
}
