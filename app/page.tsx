'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase-client';
import { AVRIXLAB_LOGO_URL } from '@/lib/brand';
import type { AvrixCall } from '@/lib/types';

function formatTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function timeUntil(iso: string | null): string {
  if (!iso) return '';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'starting soon';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rest = mins % 60;
    return rest ? `in ${hours}h ${rest}m` : `in ${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `in ${days}d ${hours % 24}h`;
}

export default function Home() {
  const router = useRouter();
  const [calls, setCalls] = useState<AvrixCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [roomName, setRoomName] = useState('');
  const [roomError, setRoomError] = useState('');

  const loadCalls = useCallback(async () => {
    const { data, error } = await supabase
      .from('avrix_calls')
      .select('*')
      .in('status', ['live', 'scheduled'])
      .order('status', { ascending: true })
      .order('scheduled_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) {
      setError('Could not load calls. Check the connection and reload.');
    } else {
      setCalls((data ?? []) as AvrixCall[]);
      setError('');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Deferred: state updates do not belong in the synchronous effect body.
    queueMicrotask(() => {
      if (!cancelled) void loadCalls();
    });
    // Live updates: Realtime on the calls table, 30s poll as a fallback.
    const channel = supabase
      .channel('avrix-calls-home')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'avrix_calls' },
        () => {
          if (!cancelled) void loadCalls();
        },
      )
      .subscribe();
    const timer = setInterval(() => {
      if (!cancelled) void loadCalls();
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [loadCalls]);

  function joinByName(e: React.FormEvent) {
    e.preventDefault();
    const q = roomName.trim().toLowerCase();
    if (!q) {
      setRoomError('Type a room name first.');
      return;
    }
    const match =
      calls.find((c) => c.title.toLowerCase() === q) ??
      calls.find((c) => c.room_name.toLowerCase() === q);
    if (!match) {
      setRoomError(`No call named “${roomName.trim()}” — pick one from the list below.`);
      return;
    }
    if (match.status !== 'live') {
      setRoomError(`“${match.title}” hasn't started yet.`);
      return;
    }
    router.push(`/call/${match.id}`);
  }

  const liveCount = calls.filter((c) => c.status === 'live').length;
  const scheduledCount = calls.filter((c) => c.status === 'scheduled').length;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={AVRIXLAB_LOGO_URL} alt="Avrix Labs" className="h-9 w-auto" />
          <Link href="/admin" className="btn-ghost btn-sm">
            Admin
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero + join */}
        <section className="section fade-up">
          <p className="eyebrow">Avrixlab · Group calls</p>
          <h1 className="mt-4 max-w-3xl font-display text-5xl font-semibold leading-[1.05] tracking-[-0.01em] text-cream sm:text-6xl">
            Group calls,{' '}
            <em className="gold-text font-display italic">plain and simple.</em>
          </h1>
          <p className="lede mt-5 max-w-2xl text-lg">
            Join a room by name — no account, no password, no rules. Video
            runs on Jitsi, and the group chat stays open the whole time.
          </p>

          <form
            onSubmit={joinByName}
            className="card lift mt-10 max-w-2xl p-5 sm:p-6"
          >
            <label
              htmlFor="room-name"
              className="text-sm font-semibold text-cream"
            >
              Join a room by name
            </label>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <input
                id="room-name"
                value={roomName}
                onChange={(e) => {
                  setRoomName(e.target.value);
                  setRoomError('');
                }}
                maxLength={200}
                placeholder="Room name, e.g. Weekly market update"
                className="field mt-0 min-w-0 flex-1"
              />
              <button type="submit" className="btn-primary shrink-0">
                Join meeting
              </button>
            </div>
            {roomError ? (
              <p className="mt-3 text-sm text-red-400">{roomError}</p>
            ) : (
              <p className="mt-3 text-sm text-muted">
                Pick a room from the list below, or type its exact name.
              </p>
            )}
          </form>
        </section>

        {/* Calls */}
        <section className="section section-tight fade-up">
          <p className="eyebrow">Rooms</p>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <h2 className="h2">Live &amp; upcoming calls</h2>
            <p className="text-sm text-muted">
              {liveCount > 0
                ? `${liveCount} live now`
                : 'Nothing live right now'}
              {scheduledCount > 0 ? ` · ${scheduledCount} scheduled` : ''}
            </p>
          </div>

          {/* Stats */}
          <div className="mt-6 grid grid-cols-3 gap-3 sm:gap-4">
            {[
              { label: 'Live now', value: liveCount, accent: 'text-emerald' },
              { label: 'Scheduled', value: scheduledCount, accent: 'text-goldlight' },
              { label: 'Rooms listed', value: calls.length, accent: 'text-cream' },
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

          {loading && (
            <div className="mt-6 space-y-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="card h-24 animate-pulse"
                  aria-label="Loading calls"
                />
              ))}
            </div>
          )}
          {error && <p className="mt-6 text-red-400">{error}</p>}
          {!loading && !error && calls.length === 0 && (
            <div className="card mt-6 px-6 py-10 text-center">
              <p className="font-display text-xl font-semibold text-cream">
                No calls yet
              </p>
              <p className="mt-2 text-sm text-muted">
                Check back soon — the admin schedules calls here, and live
                rooms appear as soon as they start.
              </p>
            </div>
          )}

          <ul className="mt-6 space-y-3">
            {calls.map((call) => {
              const live = call.status === 'live';
              return (
                <li key={call.id} className="card lift p-5 sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-xl font-semibold leading-tight text-cream">
                          {call.title}
                        </span>
                        {live ? (
                          <span className="pill pill-green">
                            <span className="pulse-dot mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald" />
                            LIVE
                          </span>
                        ) : (
                          <span className="pill pill-gold">SCHEDULED</span>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-muted">
                        {live ? (
                          'Live now — click Join to enter the room.'
                        ) : (
                          <>
                            Starts {formatTime(call.scheduled_at)}
                            <span className="text-goldlight">
                              {' '}
                              · {timeUntil(call.scheduled_at)}
                            </span>
                          </>
                        )}
                      </p>
                      <p className="mt-1 font-mono text-xs text-muted">
                        {call.room_name}
                      </p>
                    </div>
                    <button
                      onClick={() => router.push(`/call/${call.id}`)}
                      disabled={!live}
                      className="btn-primary btn-sm shrink-0"
                    >
                      {live ? 'Join call' : 'Not started yet'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted sm:px-6">
          <span>
            <span className="font-semibold text-goldlight">AvrixCall</span> —
            plain Jitsi group calls for Avrixlab investors.
          </span>
          <span>No account, no rules. Video runs on the free Jitsi server.</span>
        </div>
      </footer>
    </div>
  );
}
