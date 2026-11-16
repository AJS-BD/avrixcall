'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase-client';
import { normalizePhone } from '@/lib/phone';
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
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [joinError, setJoinError] = useState('');

  useEffect(() => {
    // sessionStorage is client-only; read it after mount.
    queueMicrotask(() => {
      setName(sessionStorage.getItem('avrixcall_name') ?? '');
      setPhone(sessionStorage.getItem('avrixcall_phone') ?? '');
    });
  }, []);

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

  function join(callId: string) {
    const trimmed = name.trim();
    const canonical = normalizePhone(phone);
    if (!trimmed) {
      setJoinError('Enter your display name first.');
      return;
    }
    if (!canonical) {
      setJoinError('Enter a valid Bangladeshi phone number.');
      return;
    }
    sessionStorage.setItem('avrixcall_name', trimmed);
    sessionStorage.setItem('avrixcall_phone', canonical);
    sessionStorage.setItem('avrixcall_role', 'guest');
    router.push(`/call/${callId}`);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-5 py-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded bg-gold font-serif text-lg font-bold text-black">
            A
          </span>
          <span className="font-serif text-2xl font-bold tracking-wide text-white">
            Avrix<span className="text-gold">Call</span>
          </span>
        </div>
        <Link
          href="/admin"
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-gold hover:text-gold"
        >
          Admin
        </Link>
      </header>

      <main className="mt-10 flex-1">
        <h1 className="font-serif text-3xl font-bold leading-snug text-white sm:text-4xl">
          Group calls, run by the admin.
        </h1>
        <p className="mt-3 max-w-xl text-neutral-400">
          One speaker at a time, chosen by the admin. Everyone else listens
          — and everyone can text in the group chat the whole time.
        </p>

        <div className="mt-8 rounded-lg border border-neutral-800 bg-panel p-4">
          <label
            htmlFor="display-name"
            className="text-sm font-medium text-neutral-300"
          >
            Your name and registered phone number
          </label>
          <input
            id="display-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setJoinError('');
            }}
            maxLength={60}
            placeholder="e.g. Xafor"
            className="mt-2 w-full rounded border border-neutral-700 bg-black px-3 py-2 text-white outline-none placeholder:text-neutral-600 focus:border-gold"
          />
          <input
            id="phone-number"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setJoinError('');
            }}
            inputMode="tel"
            autoComplete="tel"
            placeholder="Phone, e.g. 01XXXXXXXXX"
            className="mt-2 w-full rounded border border-neutral-700 bg-black px-3 py-2 text-white outline-none placeholder:text-neutral-600 focus:border-gold"
          />
          <p className="mt-2 text-xs text-neutral-500">
            No password, no account — your registered number is your entry
            pass. One number holds one seat at a time.
          </p>
          {joinError && (
            <p className="mt-2 text-sm text-red-400">{joinError}</p>
          )}
        </div>

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
                      ? call.current_speaker_name
                        ? `Now speaking: ${call.current_speaker_name}`
                        : 'Live now — waiting for the admin to give someone the mic.'
                      : `Starts ${formatTime(call.scheduled_at)}`}
                  </p>
                </div>
                <button
                  onClick={() => join(call.id)}
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
        Small-scale test — free Jitsi server, up to 100 people per call. A
        group-call tool for Avrixlab investors.
      </footer>
    </div>
  );
}
