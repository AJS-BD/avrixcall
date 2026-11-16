'use client';

import { useEffect, useState } from 'react';
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

export default function Home() {
  const router = useRouter();
  const [calls, setCalls] = useState<AvrixCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [roomName, setRoomName] = useState('');
  const [roomError, setRoomError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error } = await supabase
        .from('avrix_calls')
        .select('*')
        .in('status', ['live', 'scheduled'])
        .order('status', { ascending: true })
        .order('scheduled_at', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        setError('Could not load calls. Check the connection and reload.');
      } else {
        setCalls((data ?? []) as AvrixCall[]);
        setError('');
      }
      setLoading(false);
    }
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

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

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-5 py-8">
      <header className="flex items-center justify-between">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={AVRIXLAB_LOGO_URL}
          alt="Avrix Labs"
          className="h-10 w-auto"
        />
        <Link
          href="/admin"
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-gold hover:text-gold"
        >
          Admin
        </Link>
      </header>

      <main className="mt-10 flex-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={AVRIXLAB_LOGO_URL}
          alt="Avrix Labs"
          className="h-14 w-auto sm:h-16"
        />
        <h1 className="mt-6 font-serif text-3xl font-bold leading-snug text-white sm:text-4xl">
          Group calls, plain and simple.
        </h1>
        <p className="mt-3 max-w-xl text-neutral-400">
          Join a room by name — no account, no password, no rules. Video
          runs on Jitsi; everyone can text in the group chat the whole time.
        </p>

        <form
          onSubmit={joinByName}
          className="mt-8 rounded-lg border border-neutral-800 bg-panel p-4"
        >
          <label
            htmlFor="room-name"
            className="text-sm font-medium text-neutral-300"
          >
            Join a room by name
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="room-name"
              value={roomName}
              onChange={(e) => {
                setRoomName(e.target.value);
                setRoomError('');
              }}
              maxLength={200}
              placeholder="Room name, e.g. Weekly market update"
              className="min-w-0 flex-1 rounded border border-neutral-700 bg-black px-3 py-2 text-white outline-none placeholder:text-neutral-600 focus:border-gold"
            />
            <button
              type="submit"
              className="shrink-0 rounded bg-gold px-4 py-2 text-sm font-semibold text-black hover:brightness-110"
            >
              Join meeting
            </button>
          </div>
          {roomError && (
            <p className="mt-2 text-sm text-red-400">{roomError}</p>
          )}
        </form>

        <h2 className="mt-10 font-serif text-xl font-bold text-white">
          Calls
        </h2>

        {loading && <p className="mt-4 text-neutral-400">Loading calls…</p>}
        {error && <p className="mt-4 text-red-400">{error}</p>}
        {!loading && !error && calls.length === 0 && (
          <p className="mt-4 rounded-lg border border-neutral-800 bg-panel p-4 text-neutral-400">
            No calls yet — check back soon.
          </p>
        )}

        <ul className="mt-4 space-y-3">
          {calls.map((call) => {
            const live = call.status === 'live';
            return (
              <li
                key={call.id}
                className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-panel p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-serif text-lg font-bold text-white">
                      {call.title}
                    </span>
                    {live ? (
                      <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                        LIVE
                      </span>
                    ) : (
                      <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs font-semibold text-gold">
                        SCHEDULED
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-neutral-400">
                    {live
                      ? 'Live now — click Join to enter the room.'
                      : `Starts ${formatTime(call.scheduled_at)}`}
                  </p>
                </div>
                <button
                  onClick={() => router.push(`/call/${call.id}`)}
                  disabled={!live}
                  className="shrink-0 rounded bg-gold px-4 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {live ? 'Join call' : 'Not started yet'}
                </button>
              </li>
            );
          })}
        </ul>
      </main>

      <footer className="mt-12 border-t border-neutral-800 pt-4 text-xs text-neutral-500">
        Plain Jitsi group calls for Avrixlab investors — no account, no
        rules. Video runs on the free Jitsi server.
      </footer>
    </div>
  );
}
