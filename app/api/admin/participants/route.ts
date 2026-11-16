import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin-auth';
import { getServiceClient } from '@/lib/supabase-server';

// GET /api/admin/participants?call_id=...
// Active participants for a call (admin only — phones are sensitive
// and never go to room clients; they see names via Realtime presence).
export async function GET(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const callId = new URL(req.url).searchParams.get('call_id');
  if (!callId) {
    return NextResponse.json(
      { error: 'call_id is required.' },
      { status: 400 },
    );
  }
  const db = getServiceClient();
  const { data, error } = await db
    .from('avrix_call_participants')
    .select('*')
    .eq('call_id', callId)
    .is('left_at', null)
    .order('joined_at', { ascending: true });
  if (error) {
    return NextResponse.json(
      { error: 'Could not load participants.' },
      { status: 500 },
    );
  }
  return NextResponse.json({ participants: data ?? [] });
}
