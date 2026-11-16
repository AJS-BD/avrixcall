import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';

// GET /api/calls/stats
// Plain counts for the home page stats strip — live and scheduled
// totals only. No call ids, titles or links ever leave this endpoint,
// so the public page can show counts without listing anything.
export async function GET() {
  const db = getServiceClient();
  const { data, error } = await db
    .from('avrix_calls')
    .select('status')
    .in('status', ['live', 'scheduled']);
  if (error) {
    return NextResponse.json(
      { error: 'Could not load stats.' },
      { status: 500 },
    );
  }
  const live = (data ?? []).filter((c) => c.status === 'live').length;
  const scheduled = (data ?? []).filter(
    (c) => c.status === 'scheduled',
  ).length;
  return NextResponse.json({ live, scheduled });
}
