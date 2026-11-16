import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin-auth';
import { getServiceClient } from '@/lib/supabase-server';

// GET /api/admin/blocked-attempts — newest first, admin only.
// Call titles are resolved in a second lookup (the table references
// avrix_calls twice, so no single embedded join is used).
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const db = getServiceClient();
  const { data, error } = await db
    .from('avrix_call_blocked_attempts')
    .select('*')
    .order('attempted_at', { ascending: false })
    .limit(100);
  if (error) {
    return NextResponse.json(
      { error: 'Could not load blocked attempts.' },
      { status: 500 },
    );
  }
  const attempts = data ?? [];
  const callIds = [
    ...new Set(
      attempts
        .flatMap((a) => [a.call_id, a.active_call_id])
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ];
  const titles: Record<string, string> = {};
  if (callIds.length > 0) {
    const { data: calls } = await db
      .from('avrix_calls')
      .select('id, title')
      .in('id', callIds);
    for (const c of calls ?? []) {
      titles[c.id as string] = c.title as string;
    }
  }
  return NextResponse.json({
    attempts: attempts.map((a) => ({
      ...a,
      target_call_title: a.call_id ? (titles[a.call_id] ?? null) : null,
      active_call_title: a.active_call_id
        ? (titles[a.active_call_id] ?? null)
        : null,
    })),
  });
}
