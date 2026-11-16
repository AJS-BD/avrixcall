import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin-auth';
import { normalizePhone } from '@/lib/phone';
import { getServiceClient } from '@/lib/supabase-server';

// GET /api/admin/allowlist — full allowlist, admin only.
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const db = getServiceClient();
  const { data, error } = await db
    .from('avrix_call_allowlist')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: 'Could not load the allowlist.' },
      { status: 500 },
    );
  }
  return NextResponse.json({ allowlist: data ?? [] });
}

// POST /api/admin/allowlist { phone, name } — add (or rename) a number.
// The phone is normalized to canonical form before it is stored.
export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const phone = normalizePhone(
    typeof body?.phone === 'string' ? body.phone : '',
  );
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!phone) {
    return NextResponse.json(
      { error: 'Enter a valid Bangladeshi phone number.' },
      { status: 400 },
    );
  }
  const db = getServiceClient();
  const { data, error } = await db
    .from('avrix_call_allowlist')
    .upsert({ phone, name: name || null }, { onConflict: 'phone' })
    .select()
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: 'Could not save the number.' },
      { status: 500 },
    );
  }
  return NextResponse.json({ entry: data }, { status: 201 });
}

// DELETE /api/admin/allowlist { phone } — remove a number from the list.
// Note: this does NOT free an active seat in a live call; use the
// participant Remove button for that. A removed number simply cannot
// join future calls.
export async function DELETE(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const phone = normalizePhone(
    typeof body?.phone === 'string' ? body.phone : '',
  );
  if (!phone) {
    return NextResponse.json(
      { error: 'Enter a valid Bangladeshi phone number.' },
      { status: 400 },
    );
  }
  const db = getServiceClient();
  const { error } = await db
    .from('avrix_call_allowlist')
    .delete()
    .eq('phone', phone);
  if (error) {
    return NextResponse.json(
      { error: 'Could not remove the number.' },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
