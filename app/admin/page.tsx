'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AVRIXLAB_LOGO_URL } from '@/lib/brand';
import type { AvrixCall } from '@/lib/types';

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

export default function AdminPage() {
  const [auth, setAuth] = useState<AuthState>('checking');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [calls, setCalls] = useState<AvrixCall[]>([]);
  const [listError, setListError] = useState('');
  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');

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
      })
      .catch(() => {
        if (!cancelled) setListError('Could not load calls.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    setAuth('login');
    setCalls([]);
  }

  async function createCall(startNow: boolean) {
    const trimmed = title.trim();
    if (!trimmed) {
      setNotice('Give the call a title first.');
      return;
    }
    if (!startNow && !scheduledAt) {
      setNotice('Pick a date and time, or use “Start now”.');
      return;
    }
    setCreating(true);
    setNotice('');
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
      setNotice('Could not create the call.');
      return;
    }
    const data = await res.json();
    setCalls((prev) => [data.call as AvrixCall, ...prev]);
    setTitle('');
    setScheduledAt('');
    setNotice(
      startNow
        ? 'Call is live — join it from “Open room” before anyone else does, so you hold moderator.'
        : 'Call scheduled.',
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

  // ---- render ----

  if (auth === 'checking') {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 text-center text-neutral-400">
        Loading…
      </div>
    );
  }

  if (auth === 'login') {
    return (
      <div className="mx-auto max-w-md px-5 py-16">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={AVRIXLAB_LOGO_URL}
          alt="Avrix Labs"
          className="h-10 w-auto"
        />
        <h1 className="mt-6 font-serif text-2xl font-bold text-white">
          Avrix<span className="text-gold">Call</span> Admin
        </h1>
        <p className="mt-2 text-neutral-400">
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
            className="w-full rounded border border-neutral-700 bg-black px-3 py-2 text-white outline-none placeholder:text-neutral-600 focus:border-gold"
          />
          {loginError && (
            <p className="mt-2 text-sm text-red-400">{loginError}</p>
          )}
          <button
            type="submit"
            className="mt-3 w-full rounded bg-gold px-4 py-2 font-semibold text-black hover:brightness-110"
          >
            Sign in
          </button>
        </form>
        <Link href="/" className="mt-4 inline-block text-sm text-gold underline">
          Back to calls
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={AVRIXLAB_LOGO_URL}
            alt="Avrix Labs"
            className="h-9 w-auto"
          />
          <h1 className="font-serif text-2xl font-bold text-white">
            Avrix<span className="text-gold">Call</span>{' '}
            <span className="text-lg text-neutral-400">Admin</span>
          </h1>
        </div>
        <button
          onClick={logout}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-gold hover:text-gold"
        >
          Sign out
        </button>
      </header>

      {notice && (
        <p className="mt-4 rounded border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold">
          {notice}
        </p>
      )}

      <section className="mt-6 rounded-lg border border-neutral-800 bg-panel p-4">
        <h2 className="font-serif text-lg font-bold text-white">
          Create a call
        </h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Call title, e.g. Weekly market update"
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-black px-3 py-2 text-white outline-none placeholder:text-neutral-600 focus:border-gold"
          />
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="rounded border border-neutral-700 bg-black px-3 py-2 text-white outline-none focus:border-gold"
          />
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => void createCall(false)}
            disabled={creating}
            className="rounded border border-gold px-4 py-2 text-sm font-semibold text-gold hover:bg-gold/10 disabled:opacity-40"
          >
            Schedule call
          </button>
          <button
            onClick={() => void createCall(true)}
            disabled={creating}
            className="rounded bg-gold px-4 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40"
          >
            Start now
          </button>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-xl font-bold text-white">Calls</h2>
        {listError && <p className="mt-2 text-sm text-red-400">{listError}</p>}
        {calls.length === 0 && (
          <p className="mt-3 text-neutral-400">No calls yet.</p>
        )}
        <ul className="mt-3 space-y-3">
          {calls.map((call) => (
            <li
              key={call.id}
              className="rounded-lg border border-neutral-800 bg-panel p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-serif text-lg font-bold text-white">
                    {call.title}
                  </span>
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      call.status === 'live'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : call.status === 'scheduled'
                          ? 'bg-gold/15 text-gold'
                          : 'bg-neutral-700/40 text-neutral-400'
                    }`}
                  >
                    {call.status.toUpperCase()}
                  </span>
                  <p className="mt-1 text-sm text-neutral-400">
                    {call.status === 'scheduled'
                      ? `Starts ${formatTime(call.scheduled_at)}`
                      : call.status === 'live'
                        ? 'Live now'
                        : `Ended ${formatTime(call.ended_at)}`}
                    {' · '}
                    <span className="font-mono text-xs">
                      {call.room_name}
                    </span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {call.status === 'scheduled' && (
                    <button
                      onClick={() =>
                        void patchCall(call.id, { action: 'start' })
                      }
                      className="rounded bg-gold px-3 py-1.5 text-sm font-semibold text-black hover:brightness-110"
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
                        className="rounded border border-gold px-3 py-1.5 text-sm font-semibold text-gold hover:bg-gold/10"
                      >
                        Open room
                      </a>
                      <button
                        onClick={() =>
                          void patchCall(call.id, { action: 'end' })
                        }
                        className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500"
                      >
                        End
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-10 border-t border-neutral-800 pt-4 text-xs text-neutral-500">
        Admin login is a single shared password — test-grade, not production
        auth. Join the room yourself before anyone else does, so you hold
        the Jitsi moderator seat. Note: the free Jitsi server asks the
        first person to sign in with Google or GitHub before a meeting can
        start — sign in at meet.jit.si in the same browser first if the
        room shows a sign-in screen. Anyone with a room link can join;
        there is no allowlist or seat check anymore.
      </footer>
    </div>
  );
}
