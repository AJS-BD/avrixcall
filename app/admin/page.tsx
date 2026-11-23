'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AVRIXLAB_LOGO_URL } from '@/lib/brand';
import type { AvrixCall } from '@/lib/types';
import {
  callStartMs,
  elapsedMs,
  formatCompact,
  formatHMS,
} from '@/lib/duration';
import { supabase } from '@/lib/supabase-client';

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type AuthState = 'checking' | 'login' | 'authed';

interface Notice {
  text: string;
  /** Call the notice is about — shown only while that call is still live. */
  callId: string | null;
}

interface Member {
  phone: string;
  name: string | null;
  created_at: string;
  face_enrolled?: boolean;
}

function formatPhone(phone: string): string {
  // 8801XXXXXXXXX -> +880 1XXX-XXXXXX for display.
  if (/^8801[3-9]\d{8}$/.test(phone)) {
    return `+880 ${phone.slice(3, 7)}-${phone.slice(7)}`;
  }
  return phone;
}

export default function AdminPage() {
  const [auth, setAuth] = useState<AuthState>('checking');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [calls, setCalls] = useState<AvrixCall[]>([]);
  const [listError, setListError] = useState('');
  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Members (allowlist) — only these numbers can join a call.
  const [members, setMembers] = useState<Member[]>([]);
  const [membersError, setMembersError] = useState('');
  const [memberPhone, setMemberPhone] = useState('');
  const [memberName, setMemberName] = useState('');
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberMessage, setMemberMessage] = useState('');
  // Which call's invite link was just copied ("Copied" feedback).
  const [copiedCallId, setCopiedCallId] = useState<string | null>(null);
  // Ticking clock for live-call durations (1s client interval, only
  // while a call is live — no extra fetches). Initialised to 0 and set
  // in an effect — reading Date.now() in a state initializer breaks
  // static prerendering in Next 16.
  const hasLiveCall = useMemo(
    () => calls.some((c) => c.status === 'live'),
    [calls],
  );
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    queueMicrotask(() => setNowMs(Date.now()));
    if (!hasLiveCall) return;
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [hasLiveCall]);

  const fetchCalls = useCallback(async () => {
    const res = await fetch('/api/admin/calls');
    if (res.status === 401) {
      setAuth('login');
      return false;
    }
    if (!res.ok) {
      setListError('Could not load calls.');
      return false;
    }
    const data = await res.json();
    setCalls((data.calls ?? []) as AvrixCall[]);
    setAuth('authed');
    return true;
  }, []);

  const fetchMembers = useCallback(async () => {
    const res = await fetch('/api/admin/allowlist');
    if (!res.ok) {
      setMembersError('Could not load members.');
      return;
    }
    const data = await res.json();
    setMembers((data.members ?? []) as Member[]);
    setMembersError('');
  }, []);

  // Copy a call's invite link (admin only — the public page lists no
  // calls, so this is the only place the link is visible).
  async function copyInviteLink(callId: string) {
    const url = `${window.location.origin}/call/${callId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard blocked — fall back to a prompt with the link selected.
      window.prompt('Copy the invite link:', url);
      return;
    }
    setCopiedCallId(callId);
    window.setTimeout(() => {
      setCopiedCallId((current) => (current === callId ? null : current));
    }, 2500);
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    const phone = memberPhone.trim();
    if (!phone) {
      setMemberMessage('Enter a phone number first.');
      return;
    }
    setMemberBusy(true);
    setMemberMessage('');
    const res = await fetch('/api/admin/allowlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, name: memberName.trim() || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setMemberBusy(false);
    if (!res.ok) {
      setMemberMessage(
        (data?.error as string) || 'Could not add the member.',
      );
      return;
    }
    setMembers((prev) => {
      const added = data.member as Member;
      const rest = prev.filter((m) => m.phone !== added.phone);
      return [added, ...rest];
    });
    setMemberPhone('');
    setMemberName('');
    setMemberMessage('Member added — they can join with their number.');
  }

  async function removeFace(phone: string) {
    const res = await fetch('/api/face/enroll', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    if (!res.ok) {
      setMemberMessage('Could not remove the face enrollment.');
      return;
    }
    setMembers((prev) =>
      prev.map((m) => (m.phone === phone ? { ...m, face_enrolled: false } : m)),
    );
    setMemberMessage('Face enrollment removed — that member joins by phone only until they enroll again.');
  }

  async function removeMember(phone: string) {
    const res = await fetch('/api/admin/allowlist', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    if (!res.ok) {
      setMemberMessage('Could not remove the member.');
      return;
    }
    setMembers((prev) => prev.filter((m) => m.phone !== phone));
  }

  useEffect(() => {
    // State updates live in the promise continuations, not in the
    // synchronous effect body (react-hooks/set-state-in-effect).
    let cancelled = false;
    fetch('/api/admin/calls')
      .then((res) => {
        if (cancelled) return null;
        if (res.status === 401) {
          setAuth('login');
          return null;
        }
        if (!res.ok) {
          setListError('Could not load calls.');
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled || !data) return;
        setCalls((data.calls ?? []) as AvrixCall[]);
        setAuth('authed');
        void fetchMembers();
      })
      .catch(() => {
        if (!cancelled) setListError('Could not load calls.');
      });
    return () => {
      cancelled = true;
    };
  }, [fetchMembers]);

  // Live updates once signed in: Realtime on the calls table, 30s poll
  // as a fallback.
  useEffect(() => {
    if (auth !== 'authed') return;
    let cancelled = false;
    const channel = supabase
      .channel('avrix-calls-admin')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'avrix_calls' },
        () => {
          if (!cancelled) void fetchCalls();
        },
      )
      .subscribe();
    const timer = setInterval(() => {
      if (!cancelled) void fetchCalls();
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [auth, fetchCalls]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoginError('');
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setLoginError('Wrong password.');
      return;
    }
    setPassword('');
    await fetchCalls();
    await fetchMembers();
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    setAuth('login');
    setCalls([]);
    setMembers([]);
    setNotice(null);
  }

  async function refresh() {
    setRefreshing(true);
    await fetchCalls();
    setRefreshing(false);
  }

  async function createCall(startNow: boolean) {
    const trimmed = title.trim();
    if (!trimmed) {
      setNotice({ text: 'Give the call a title first.', callId: null });
      return;
    }
    if (!startNow && !scheduledAt) {
      setNotice({
        text: 'Pick a date and time, or use “Start now”.',
        callId: null,
      });
      return;
    }
    setCreating(true);
    setNotice(null);
    const res = await fetch('/api/admin/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: trimmed,
        scheduled_at: startNow
          ? undefined
          : new Date(scheduledAt).toISOString(),
        start_now: startNow,
      }),
    });
    setCreating(false);
    if (!res.ok) {
      setNotice({ text: 'Could not create the call.', callId: null });
      return;
    }
    const data = await res.json();
    const created = data.call as AvrixCall;
    setCalls((prev) => [created, ...prev]);
    setTitle('');
    setScheduledAt('');
    setNotice(
      startNow
        ? {
            text: 'Call is live — join it from “Open room” before anyone else does, so you hold moderator.',
            callId: created.id,
          }
        : { text: 'Call scheduled.', callId: null },
    );
  }

  async function patchCall(
    id: string,
    body: Record<string, unknown>,
  ): Promise<AvrixCall | null> {
    const res = await fetch(`/api/admin/calls/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const updated = data.call as AvrixCall;
    setCalls((prev) => prev.map((c) => (c.id === id ? updated : c)));
    return updated;
  }

  // A "call is live" notice is only relevant while that call is live.
  const showNotice =
    notice !== null &&
    (notice.callId === null ||
      calls.some((c) => c.id === notice.callId && c.status === 'live'));

  const stats = {
    total: calls.length,
    live: calls.filter((c) => c.status === 'live').length,
    scheduled: calls.filter((c) => c.status === 'scheduled').length,
    ended: calls.filter((c) => c.status === 'ended').length,
  };

  // ---- render ----

  if (auth === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center px-5 text-muted">
        Loading…
      </div>
    );
  }

  if (auth === 'login') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-16">
        <div className="card fade-up w-full max-w-md p-6 sm:p-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={AVRIXLAB_LOGO_URL} alt="Avrix Labs" className="h-11 w-auto" />
          <h1 className="mt-6 font-display text-3xl font-semibold text-cream">
            Avrix<span className="gold-text">Call</span> Admin
          </h1>
          <p className="mt-2 text-sm text-muted">
            Enter the admin password to manage calls.
          </p>
          <form onSubmit={login} className="mt-6">
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setLoginError('');
              }}
              placeholder="Admin password"
              autoFocus
              className="field"
            />
            {loginError && (
              <p className="mt-2 text-sm text-red-400">{loginError}</p>
            )}
            <button type="submit" className="btn-primary btn-block mt-4">
              Sign in
            </button>
          </form>
          <Link
            href="/"
            className="mt-5 inline-block text-sm font-medium text-goldlight hover:text-gold"
          >
            ← Back to calls
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={AVRIXLAB_LOGO_URL} alt="Avrix Labs" className="h-9 w-auto" />
            <span className="font-display text-xl font-semibold text-cream">
              Avrix<span className="gold-text">Call</span>
            </span>
            <span className="pill pill-muted">ADMIN</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" className="btn-ghost btn-sm">
              View site
            </Link>
            <button onClick={logout} className="btn-ghost btn-sm">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <div className="fade-up">
          <p className="eyebrow">Console</p>
          <h1 className="mt-3 font-display text-3xl font-semibold text-cream sm:text-4xl">
            Manage your calls
          </h1>
          <p className="lede">
            Schedule a call, start one now, and manage who can join.
            Only the members below can enter a call — and only you can
            see or copy the invite links.
          </p>
        </div>

        {/* Overview stats */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {[
            { label: 'Total calls', value: stats.total, accent: 'text-cream' },
            { label: 'Live now', value: stats.live, accent: 'text-emerald' },
            { label: 'Scheduled', value: stats.scheduled, accent: 'text-goldlight' },
            { label: 'Ended', value: stats.ended, accent: 'text-muted' },
          ].map((s) => (
            <div key={s.label} className="card px-4 py-4 sm:px-5">
              <p
                className={`font-display text-3xl font-semibold leading-none sm:text-4xl ${s.accent}`}
              >
                {s.value}
              </p>
              <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                {s.label}
              </p>
            </div>
          ))}
        </div>

        {showNotice && notice && (
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-goldlight">
            <span aria-hidden className="mt-0.5 text-base leading-none">●</span>
            <span>{notice.text}</span>
          </div>
        )}

        {/* Create a call */}
        <section className="card mt-6 p-5 sm:p-6">
          <p className="eyebrow">New call</p>
          <h2 className="mt-3 font-display text-2xl font-semibold text-cream">
            Create a call
          </h2>
          <div className="mt-5 flex flex-col gap-3 lg:flex-row">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="Call title, e.g. Weekly market update"
              className="field mt-0 min-w-0 flex-1"
            />
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              aria-label="Scheduled date and time"
              className="field mt-0 lg:w-64"
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => void createCall(false)}
              disabled={creating}
              className="btn-outline"
            >
              Schedule call
            </button>
            <button
              onClick={() => void createCall(true)}
              disabled={creating}
              className="btn-primary"
            >
              {creating ? 'Starting…' : 'Start now'}
            </button>
          </div>
        </section>

        {/* Calls list */}
        <section className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow">Rooms</p>
              <h2 className="h2 mt-3">All calls</h2>
            </div>
            <button
              onClick={() => void refresh()}
              disabled={refreshing}
              className="btn-ghost btn-sm"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {listError && <p className="mt-4 text-sm text-red-400">{listError}</p>}
          {calls.length === 0 && !listError && (
            <div className="card mt-6 px-6 py-10 text-center">
              <p className="font-display text-xl font-semibold text-cream">
                No calls yet
              </p>
              <p className="mt-2 text-sm text-muted">
                Create your first call above — schedule it ahead, or start one
                right now.
              </p>
            </div>
          )}

          <ul className="mt-6 space-y-3">
            {calls.map((call) => {
              const ended = call.status === 'ended';
              // Live: ticking HH:MM:SS. Ended: final duration, compact.
              // Scheduled: no duration — the scheduled time is shown.
              const duration =
                call.status === 'live'
                  ? formatHMS(elapsedMs(callStartMs(call), nowMs))
                  : call.status === 'ended' && call.ended_at
                    ? formatCompact(
                        elapsedMs(
                          callStartMs(call),
                          new Date(call.ended_at).getTime(),
                        ),
                      )
                    : null;
              return (
                <li
                  key={call.id}
                  className={`card p-5 sm:p-6 ${ended ? 'opacity-70' : 'lift'}`}
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-xl font-semibold leading-tight text-cream">
                          {call.title}
                        </span>
                        <span
                          className={`pill ${
                            call.status === 'live'
                              ? 'pill-green'
                              : call.status === 'scheduled'
                                ? 'pill-gold'
                                : 'pill-muted'
                          }`}
                        >
                          {call.status === 'live' && (
                            <span className="pulse-dot mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald" />
                          )}
                          {call.status.toUpperCase()}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-muted">
                        {call.status === 'scheduled'
                          ? `Starts ${formatTime(call.scheduled_at)}`
                          : call.status === 'live'
                            ? (
                              <>
                                Live now ·{' '}
                                <span className="font-semibold tabular-nums text-goldlight">
                                  {duration}
                                </span>
                              </>
                            )
                            : `Ended ${formatTime(call.ended_at)}${duration ? ` · lasted ${duration}` : ''}`}
                      </p>
                      <p className="mt-1 font-mono text-xs text-muted">
                        {call.room_name}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {call.status !== 'ended' && (
                        <button
                          onClick={() => void copyInviteLink(call.id)}
                          className="btn-ghost btn-sm"
                        >
                          {copiedCallId === call.id
                            ? 'Copied ✓'
                            : 'Copy invite link'}
                        </button>
                      )}
                      {call.status === 'scheduled' && (
                        <button
                          onClick={() =>
                            void patchCall(call.id, { action: 'start' })
                          }
                          className="btn-primary btn-sm"
                        >
                          Start
                        </button>
                      )}
                      {call.status === 'live' && (
                        <>
                          <a
                            href={`/call/${call.id}?name=Admin&role=admin`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-outline btn-sm"
                          >
                            Open room
                          </a>
                          <button
                            onClick={() =>
                              void patchCall(call.id, { action: 'end' })
                            }
                            className="btn-danger"
                          >
                            End
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Members — only these numbers can join */}
        <section className="mt-10">
          <div>
            <p className="eyebrow">Members</p>
            <h2 className="h2 mt-3">
              Who can join{' '}
              <span className="text-muted">({members.length})</span>
            </h2>
            <p className="mt-2 text-sm text-muted">
              Only these phone numbers can enter a call. A member opens
              the invite link you send them, types their name and number,
              and the server makes them a short-lived video key. Anyone
              else is turned away.
            </p>
          </div>

          <form
            onSubmit={addMember}
            className="card mt-6 flex flex-col gap-3 p-5 sm:p-6 lg:flex-row"
          >
            <input
              value={memberPhone}
              onChange={(e) => {
                setMemberPhone(e.target.value);
                setMemberMessage('');
              }}
              inputMode="tel"
              autoComplete="tel"
              maxLength={20}
              placeholder="Phone number, e.g. 01XXXXXXXXX"
              className="field mt-0 min-w-0 flex-1"
            />
            <input
              value={memberName}
              onChange={(e) => {
                setMemberName(e.target.value);
                setMemberMessage('');
              }}
              maxLength={60}
              placeholder="Name (optional)"
              className="field mt-0 min-w-0 flex-1"
            />
            <button
              type="submit"
              disabled={memberBusy}
              className="btn-primary shrink-0"
            >
              {memberBusy ? 'Adding…' : 'Add member'}
            </button>
          </form>
          {memberMessage && (
            <p className="mt-3 text-sm text-goldlight">{memberMessage}</p>
          )}
          {membersError && (
            <p className="mt-3 text-sm text-red-400">{membersError}</p>
          )}

          {members.length === 0 && !membersError && (
            <div className="card mt-6 px-6 py-10 text-center">
              <p className="font-display text-xl font-semibold text-cream">
                No members yet
              </p>
              <p className="mt-2 text-sm text-muted">
                Add the first phone number above — until then, nobody can
                join a call.
              </p>
            </div>
          )}

          <ul className="mt-6 space-y-3">
            {members.map((m) => (
              <li
                key={m.phone}
                className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
              >
                <div className="min-w-0">
                  <p className="font-display text-lg font-semibold text-cream">
                    {m.name || 'Member'}
                  </p>
                  <p className="mt-1 font-mono text-sm text-muted">
                    {formatPhone(m.phone)}
                  </p>
                  <p className="mt-2">
                    {m.face_enrolled ? (
                      <span className="pill pill-green">Face enrolled</span>
                    ) : (
                      <span className="pill pill-muted">No face yet</span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {m.face_enrolled && (
                    <button
                      onClick={() => void removeFace(m.phone)}
                      className="btn-ghost btn-sm shrink-0"
                    >
                      Remove face
                    </button>
                  )}
                  <button
                    onClick={() => void removeMember(m.phone)}
                    className="btn-danger btn-sm shrink-0"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <footer className="mt-12 border-t border-line pt-5 text-xs leading-relaxed text-muted">
          Admin login is a single shared password — test-grade, not
          production auth. Calls are members-only: a joiner&apos;s number
          must be on the member list, and the server mints each member a
          short-lived LiveKit video key (6 hours). A forwarded invite link
          alone gets nobody in — and without a key the video server
          refuses the connection. The public home page lists no calls;
          only you can see or copy invite links here. Numbers are typed,
          not SMS-verified — for full proof, add an OTP step later.
        </footer>
      </main>
    </div>
  );
}
