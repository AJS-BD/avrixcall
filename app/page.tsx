'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AVRIXLAB_LOGO_URL } from '@/lib/brand';

export default function Home() {
  const router = useRouter();
  const [liveCount, setLiveCount] = useState(0);
  const [scheduledCount, setScheduledCount] = useState(0);
  const [roomName, setRoomName] = useState('');
  const [roomError, setRoomError] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);

  // Plain counts only — no call titles, room names or links are ever
  // shown on this page. Only the admin sees the calls list.
  const loadStats = useCallback(async () => {
    const res = await fetch('/api/calls/stats').catch(() => null);
    if (!res || !res.ok) return;
    const data = await res.json().catch(() => ({}));
    if (typeof data?.live === 'number') setLiveCount(data.live);
    if (typeof data?.scheduled === 'number') setScheduledCount(data.scheduled);
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadStats();
    });
    const timer = setInterval(() => {
      if (!cancelled) void loadStats();
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [loadStats]);

  async function joinByName(e: React.FormEvent) {
    e.preventDefault();
    const q = roomName.trim();
    if (!q) {
      setRoomError('Type a room name first.');
      return;
    }
    // A pasted invite link works too — take the call id from its URL.
    const linkMatch = q.match(/\/call\/([0-9a-f-]{36})/i);
    if (linkMatch) {
      router.push(`/call/${linkMatch[1]}`);
      return;
    }
    setJoinBusy(true);
    setRoomError('');
    const res = await fetch(
      `/api/calls/resolve?name=${encodeURIComponent(q)}`,
    ).catch(() => null);
    setJoinBusy(false);
    if (!res) {
      setRoomError('Could not look up that room. Check the connection.');
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.id) {
      setRoomError(`No call named “${q}” — use the invite link the admin sent you.`);
      return;
    }
    if (data.status !== 'live') {
      setRoomError(`“${data.title}” hasn't started yet.`);
      return;
    }
    router.push(`/call/${data.id}`);
  }

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
            Members only. Join with the invite link the admin sent you, or
            a room by name — then your name and registered phone number.
            Video runs on LiveKit, and the group chat stays open the whole
            time.
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
                maxLength={500}
                placeholder="Room name, or paste your invite link"
                className="field mt-0 min-w-0 flex-1"
              />
              <button
                type="submit"
                disabled={joinBusy}
                className="btn-primary shrink-0"
              >
                {joinBusy ? 'Looking up…' : 'Join meeting'}
              </button>
            </div>
            {roomError ? (
              <p className="mt-3 text-sm text-red-400">{roomError}</p>
            ) : (
              <p className="mt-3 text-sm text-muted">
                Only members can join — your phone number has to be
                registered by the admin.
              </p>
            )}
          </form>

          <p className="mt-5 max-w-2xl text-sm text-muted">
            Registered members can also{' '}
            <Link
              href="/enroll"
              className="font-semibold text-goldlight underline underline-offset-4"
            >
              enroll your face
            </Link>{' '}
            — after that, joining with your number also needs a quick face
            scan, so a typed number alone is not enough.
          </p>
        </section>

        {/* Stats — counts only, no calls listed */}
        <section className="section section-tight fade-up">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {[
              { label: 'Live now', value: liveCount, accent: 'text-emerald' },
              { label: 'Scheduled', value: scheduledCount, accent: 'text-goldlight' },
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
          <p className="mt-6 text-sm text-muted">
            Calls are private — the admin sends each member their own
            invite link. If you don&apos;t have one, ask the admin.
          </p>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted sm:px-6">
          <span>
            <span className="font-semibold text-goldlight">AvrixCall</span> —
            members-only group calls for Avrixlab investors.
          </span>
          <span>Only registered members can join.</span>
        </div>
      </footer>
    </div>
  );
}
