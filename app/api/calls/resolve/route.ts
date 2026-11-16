import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';

// GET /api/calls/resolve?name=<room title or room name>
// Lets the home page join-by-name box find a call WITHOUT listing
// calls publicly: an exact title or room-name match returns just that
// call's id + status. Anything else is a 404 — no enumeration.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('name')?.trim() ?? '';
  if (!q) {
    return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  }
  const db = getServiceClient();
  // Exact title match (case-insensitive), then exact room-name match.
  const { data: byTitle } = await db
    .from('avrix_calls')
    .select('id, title, status')
    .ilike('title', q)
    .in('status', ['live', 'scheduled'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (byTitle) {
    return NextResponse.json({
      id: byTitle.id,
      title: byTitle.title,
      status: byTitle.status,
    });
  }
  const { data: byRoom } = await db
    .from('avrix_calls')
    .select('id, title, status')
    .eq('room_name', q.toLowerCase())
    .in('status', ['live', 'scheduled'])
    .maybeSingle();
  if (byRoom) {
    return NextResponse.json({
      id: byRoom.id,
      title: byRoom.title,
      status: byRoom.status,
    });
  }
  return NextResponse.json({ error: 'No such call.' }, { status: 404 });
}
