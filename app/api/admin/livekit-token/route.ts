import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin-auth';
import { getServiceClient } from '@/lib/supabase-server';
import { getLiveKitUrl, mintLiveKitToken } from '@/lib/livekit-token';

// POST /api/admin/livekit-token { call_id }
// Admin-only: mints a LiveKit token for the admin (identity 'admin',
// no phone needed) so the dashboard "Open room" link can join a live
// call. The admin cookie is the auth — no token without it.
export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const callId = typeof body?.call_id === 'string' ? body.call_id : '';
  if (!callId) {
    return NextResponse.json(
      { error: 'call_id is required.' },
      { status: 400 },
    );
  }
  const db = getServiceClient();
  const { data: call } = await db
    .from('avrix_calls')
    .select('id, status, room_name')
    .eq('id', callId)
    .maybeSingle();
  if (!call) {
    return NextResponse.json({ error: 'Call not found.' }, { status: 404 });
  }
  if (call.status !== 'live') {
    return NextResponse.json(
      { error: 'This call is not live.', status: call.status },
      { status: 409 },
    );
  }
  const livekitUrl = getLiveKitUrl();
  if (!livekitUrl) {
    return NextResponse.json(
      { error: 'Video is not configured yet.' },
      { status: 503 },
    );
  }
  const token = await mintLiveKitToken({
    roomName: call.room_name,
    identity: 'admin',
    name: 'Admin',
  });
  if (!token) {
    return NextResponse.json(
      { error: 'Video is not configured yet.' },
      { status: 503 },
    );
  }
  return NextResponse.json({
    token,
    url: livekitUrl,
    roomName: call.room_name,
  });
}
