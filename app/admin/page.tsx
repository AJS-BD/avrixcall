'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase-client';
import { displayPhone, normalizePhone } from '@/lib/phone';
import type {
  AllowlistEntry,
  AvrixCall,
  BlockedAttempt,
  CallMessage,
  CallParticipant,
} from '@/lib/types';

function asRecord(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

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

function formatJoined(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function blockedText(b: BlockedAttempt): string {
  const who = `${displayPhone(b.phone)}${b.attempted_name ? ` (${b.attempted_name})` : ''}`;
  const when = new Date(b.attempted_at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  if (b.reason === 'already_in_meeting') {
    return `${who} tried to join${b.target_call_title ? ` “${b.target_call_title}”` : ''} but is already in a meeting${b.active_call_title ? ` (“${b.active_call_title}”)` : ''} — ${when}. The person inside was not touched.`;
  }
  return `${who} tried to join${b.target_call_title ? ` “${b.target_call_title}”` : ''} but the number is not registered — ${when}.`;
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

  const [allowlist, setAllowlist] = useState<AllowlistEntry[]>([]);
  const [allowPhone, setAllowPhone] = useState('');
  const [allowName, setAllowName] = useState('');
  const [allowBusy, setAllowBusy] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dbParticipants, setDbParticipants] = useState<CallParticipant[]>([]);
  const [presencePids, setPresencePids] = useState<Set<string>>(new Set());
  const [manageMessages, setManageMessages] = useState<CallMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [busy, setBusy] = useState('');

  const [blocked, setBlocked] = useState<BlockedAttempt[]>([]);
  const [blockedAlert, setBlockedAlert] = useState<BlockedAttempt | null>(
    null,
  );

  const manageChannel = useRef<RealtimeChannel | null>(null);
  const adminPid = useRef('');
  const chatBox = useRef<HTMLDivElement | null>(null);
  const callsRef = useRef<AvrixCall[]>([]);
  const dbParticipantsRef = useRef<CallParticipant[]>([]);
  const presencePidsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    callsRef.current = calls;
  }, [calls]);
  useEffect(() => {
    dbParticipantsRef.current = dbParticipants;
  }, [dbParticipants]);
  useEffect(() => {
    presencePidsRef.current = presencePids;
  }, [presencePids]);

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

  const fetchAllowlist = useCallback(async () => {
    const res = await fetch('/api/admin/allowlist');
    if (!res.ok) return;
    const data = await res.json();
    setAllowlist((data.allowlist ?? []) as AllowlistEntry[]);
  }, []);

  const fetchParticipants = useCallback(async (callId: string) => {
    const res = await fetch(
      `/api/admin/participants?call_id=${encodeURIComponent(callId)}`,
    );
    if (!res.ok) return;
    const data = await res.json();
    setDbParticipants((data.participants ?? []) as CallParticipant[]);
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

  useEffect(() => {
    if (auth !== 'authed') return;
    let cancelled = false;
    fetch('/api/admin/allowlist')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setAllowlist((data.allowlist ?? []) as AllowlistEntry[]);
        }
      })
      .catch(() => {});
    fetch('/api/admin/blocked-attempts')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setBlocked((data.attempts ?? []) as BlockedAttempt[]);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [auth]);

  useEffect(() => {
    const el = chatBox.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [manageMessages]);

  // Live blocked attempts: a banner the moment one arrives, plus the list.
  useEffect(() => {
    if (auth !== 'authed') return;
    const channel = supabase
      .channel('avrixcall-blocked-attempts')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'avrix_call_blocked_attempts',
        },
        (payload) => {
          const row = asRecord((payload as { new?: unknown }).new);
          const attempt = row as unknown as BlockedAttempt;
          if (!attempt.id) return;
          const enriched: BlockedAttempt = {
            ...attempt,
            target_call_title: attempt.call_id
              ? (callsRef.current.find((c) => c.id === attempt.call_id)
                  ?.title ?? null)
              : null,
            active_call_title: attempt.active_call_id
              ? (callsRef.current.find((c) => c.id === attempt.active_call_id)
                  ?.title ?? null)
              : null,
          };
          setBlocked((prev) =>
            prev.some((b) => b.id === enriched.id)
              ? prev
              : [enriched, ...prev].slice(0, 100),
          );
          setBlockedAlert(enriched);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [auth]);

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
    setSelectedId(null);
    setAllowlist([]);
    setBlocked([]);
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
        ? 'Call is live — join it from “Open room” before investors do, so you hold moderator.'
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

  async function addAllowlist(e: React.FormEvent) {
    e.preventDefault();
    const phone = normalizePhone(allowPhone);
    if (!phone) {
      setNotice('Enter a valid Bangladeshi phone number.');
      return;
    }
    setAllowBusy(true);
    const res = await fetch('/api/admin/allowlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, name: allowName.trim() }),
    });
    setAllowBusy(false);
    if (!res.ok) {
      setNotice('Could not save the number.');
      return;
    }
    setAllowPhone('');
    setAllowName('');
    await fetchAllowlist();
    setNotice(`${displayPhone(phone)} added to the allowlist.`);
  }

  async function removeAllowlist(phone: string) {
    await fetch('/api/admin/allowlist', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    await fetchAllowlist();
    setNotice(
      `${displayPhone(phone)} removed from the allowlist. It cannot join future calls.`,
    );
  }

  // ---- live management for the selected call ----
  useEffect(() => {
    if (!selectedId || auth !== 'authed') return;
    if (!adminPid.current) {
      let pid = sessionStorage.getItem('avrixcall_admin_pid');
      if (!pid) {
        pid = crypto.randomUUID();
        sessionStorage.setItem('avrixcall_admin_pid', pid);
      }
      adminPid.current = pid;
    }
    const pid = adminPid.current;

    fetch(
      `/api/admin/participants?call_id=${encodeURIComponent(selectedId)}`,
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setDbParticipants((data.participants ?? []) as CallParticipant[]);
        }
      })
      .catch(() => {});
    const pollTimer = setInterval(
      () => void fetchParticipants(selectedId),
      10000,
    );

    supabase
      .from('avrix_call_messages')
      .select('*')
      .eq('call_id', selectedId)
      .order('created_at', { ascending: true })
      .limit(200)
      .then(({ data }) => {
        if (data) setManageMessages(data as CallMessage[]);
      });

    const channel: RealtimeChannel = supabase.channel(`call:${selectedId}`, {
      config: { presence: { key: pid }, broadcast: { self: false } },
    });
    manageChannel.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const pids = new Set(
          (Object.values(state).flat() as unknown[])
            .map((p) => String(asRecord(p).participant_id ?? ''))
            .filter(Boolean),
        );
        setPresencePids(pids);
      })
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'avrix_call_messages',
          filter: `call_id=eq.${selectedId}`,
        },
        (payload) => {
          const row = asRecord((payload as { new?: unknown }).new);
          const msg = row as unknown as CallMessage;
          if (msg.id) {
            setManageMessages((prev) =>
              prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
            );
          }
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void channel.track({ participant_id: pid, name: 'Admin' });
        }
      });

    // Stuck-row cleanup: if a joiner just closes the browser, their
    // participant row stays active and their number stays blocked
    // system-wide. Every 15s, free any seat whose presence has been gone
    // for a while. The 90s grace covers slow joins and presence lag —
    // nobody is freed while they are still connecting.
    const cleanupTimer = setInterval(() => {
      const now = Date.now();
      const absent = dbParticipantsRef.current.filter((p) => {
        const age = now - new Date(p.joined_at).getTime();
        return age > 90_000 && !presencePidsRef.current.has(p.participant_id);
      });
      if (absent.length === 0) return;
      void (async () => {
        for (const p of absent) {
          await fetch(`/api/calls/${selectedId}/leave`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ participant_id: p.participant_id }),
          });
        }
        await fetchParticipants(selectedId);
        setNotice(
          `Freed ${absent.length} stuck seat${absent.length > 1 ? 's' : ''} — those numbers can join again.`,
        );
      })();
    }, 15000);

    return () => {
      clearInterval(pollTimer);
      clearInterval(cleanupTimer);
      void supabase.removeChannel(channel);
      manageChannel.current = null;
      setDbParticipants([]);
      setPresencePids(new Set());
      setManageMessages([]);
    };
  }, [selectedId, auth, fetchParticipants]);

  async function broadcast(event: string, payload: Record<string, unknown>) {
    const channel = manageChannel.current;
    if (!channel) {
      setNotice('Not connected to the call yet — wait a moment and retry.');
      return false;
    }
    const status = await channel.send({
      type: 'broadcast',
      event,
      payload,
    });
    if (status !== 'ok') {
      setNotice('Signal could not be sent — try again.');
      return false;
    }
    return true;
  }

  async function grantSpeak(p: CallParticipant) {
    if (!selectedId) return;
    setBusy(`grant-${p.participant_id}`);
    const updated = await patchCall(selectedId, {
      action: 'set-speaker',
      speaker_id: p.participant_id,
      speaker_name: p.name,
    });
    setBusy('');
    if (!updated) {
      setNotice('Could not grant the mic.');
      return;
    }
    await broadcast('grant-speak', { participant_id: p.participant_id });
    setNotice(`${p.name} has the mic now.`);
  }

  async function takeBack(p: CallParticipant) {
    if (!selectedId) return;
    setBusy(`revoke-${p.participant_id}`);
    const updated = await patchCall(selectedId, {
      action: 'set-speaker',
      speaker_id: null,
      speaker_name: null,
    });
    setBusy('');
    if (!updated) {
      setNotice('Could not take the mic back.');
      return;
    }
    await broadcast('revoke-speak', { participant_id: p.participant_id });
    setNotice(`Mic taken back from ${p.name}.`);
  }

  async function muteAll() {
    if (!selectedId) return;
    setBusy('mute-all');
    await patchCall(selectedId, {
      action: 'set-speaker',
      speaker_id: null,
      speaker_name: null,
    });
    const ok = await broadcast('mute-all', {});
    setBusy('');
    if (ok) setNotice('Everyone is muted. The mic is free.');
  }

  async function removeParticipant(p: CallParticipant) {
    if (!selectedId) return;
    setBusy(`remove-${p.participant_id}`);
    await fetch('/api/admin/participants/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call_id: selectedId,
        participant_id: p.participant_id,
      }),
    });
    // Kick live: the room client leaves at once on this signal.
    await broadcast('kicked', { participant_id: p.participant_id });
    setBusy('');
    await fetchParticipants(selectedId);
    setNotice(
      `${p.name} was removed. Their number can join again — unless it is also removed from the allowlist.`,
    );
  }

  async function sendAdminChat(e: React.FormEvent) {
    e.preventDefault();
    const body = chatInput.trim();
    if (!body || !selectedId) return;
    setChatInput('');
    const { data, error } = await supabase
      .from('avrix_call_messages')
      .insert({
        call_id: selectedId,
        sender_name: 'Admin',
        sender_role: 'admin',
        participant_id: null,
        body: body.slice(0, 1000),
      })
      .select()
      .single();
    if (error) {
      setNotice('Message could not be sent.');
      return;
    }
    if (data) {
      const msg = data as CallMessage;
      setManageMessages((prev) =>
        prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
      );
    }
  }

  const selectedCall = calls.find((c) => c.id === selectedId) ?? null;

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
        <h1 className="font-serif text-2xl font-bold text-white">
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
        <h1 className="font-serif text-2xl font-bold text-white">
          Avrix<span className="text-gold">Call</span>{' '}
          <span className="text-lg text-neutral-400">Admin</span>
        </h1>
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

      {blockedAlert && (
        <div className="mt-4 rounded-lg border border-red-500 bg-red-500/10 p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-red-300">
              ⚠ Blocked join attempt — just now
            </p>
            <button
              onClick={() => setBlockedAlert(null)}
              className="shrink-0 text-sm text-red-300 underline"
            >
              Dismiss
            </button>
          </div>
          <p className="mt-1 text-sm text-neutral-200">
            {blockedText(blockedAlert)}
          </p>
        </div>
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

      <section className="mt-8 rounded-lg border border-neutral-800 bg-panel p-4">
        <h2 className="font-serif text-lg font-bold text-white">
          Allowlist — numbers allowed to join
        </h2>
        <p className="mt-1 text-sm text-neutral-400">
          The main Avrixlab database has no phone numbers, so AvrixCall keeps
          its own list. Only numbers here can join any call.
        </p>
        <form
          onSubmit={addAllowlist}
          className="mt-3 flex flex-col gap-2 sm:flex-row"
        >
          <input
            value={allowPhone}
            onChange={(e) => setAllowPhone(e.target.value)}
            inputMode="tel"
            placeholder="Phone, e.g. 01XXXXXXXXX"
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-black px-3 py-2 text-white outline-none placeholder:text-neutral-600 focus:border-gold"
          />
          <input
            value={allowName}
            onChange={(e) => setAllowName(e.target.value)}
            maxLength={60}
            placeholder="Name (optional)"
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-black px-3 py-2 text-white outline-none placeholder:text-neutral-600 focus:border-gold"
          />
          <button
            type="submit"
            disabled={allowBusy}
            className="rounded bg-gold px-4 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40"
          >
            Add number
          </button>
        </form>
        {allowlist.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">
            No numbers yet — add the first investor number above.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {allowlist.map((entry) => (
              <li
                key={entry.phone}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-neutral-800 px-3 py-2"
              >
                <span className="text-sm text-neutral-200">
                  <span className="font-mono">{displayPhone(entry.phone)}</span>
                  {entry.name && (
                    <span className="ml-2 text-neutral-400">
                      {entry.name}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => void removeAllowlist(entry.phone)}
                  className="rounded border border-red-500 px-3 py-1 text-sm font-semibold text-red-400 hover:bg-red-500/10"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
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
                      : call.current_speaker_name
                        ? `Now speaking: ${call.current_speaker_name}`
                        : call.status === 'live'
                          ? 'Live — no one has the mic.'
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
                          setSelectedId(
                            selectedId === call.id ? null : call.id,
                          )
                        }
                        className="rounded border border-neutral-600 px-3 py-1.5 text-sm text-neutral-200 hover:border-gold"
                      >
                        {selectedId === call.id ? 'Close manage' : 'Manage'}
                      </button>
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

              {selectedId === call.id && call.status === 'live' && (
                <div className="mt-4 border-t border-neutral-800 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-white">
                      Manage — in the call ({dbParticipants.length})
                    </h3>
                    <button
                      onClick={() => void muteAll()}
                      disabled={busy === 'mute-all'}
                      className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40"
                    >
                      Mute all
                    </button>
                  </div>
                  {dbParticipants.length === 0 && (
                    <p className="mt-2 text-sm text-neutral-400">
                      No one has joined yet. Open the room yourself first, so
                      you hold moderator in Jitsi.
                    </p>
                  )}
                  <ul className="mt-2 space-y-2">
                    {dbParticipants.map((p) => {
                      const isSpeaker =
                        selectedCall?.current_speaker_id ===
                        p.participant_id;
                      const inRoom = presencePids.has(p.participant_id);
                      return (
                        <li
                          key={p.participant_id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded border border-neutral-800 px-3 py-2"
                        >
                          <span className="text-sm text-neutral-200">
                            <span
                              className={`mr-2 inline-block h-2 w-2 rounded-full ${inRoom ? 'bg-emerald-400' : 'bg-neutral-600'}`}
                              title={inRoom ? 'In the room' : 'Not in the room'}
                            />
                            {p.name}
                            <span className="ml-2 font-mono text-xs text-neutral-400">
                              {displayPhone(p.phone)}
                            </span>
                            <span className="ml-2 text-xs text-neutral-500">
                              joined {formatJoined(p.joined_at)}
                            </span>
                            {isSpeaker && (
                              <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs font-semibold text-emerald-400">
                                SPEAKING
                              </span>
                            )}
                          </span>
                          <span className="flex gap-2">
                            {isSpeaker ? (
                              <button
                                onClick={() => void takeBack(p)}
                                disabled={busy === `revoke-${p.participant_id}`}
                                className="rounded border border-red-500 px-3 py-1 text-sm font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                              >
                                Take mic back
                              </button>
                            ) : (
                              <button
                                onClick={() => void grantSpeak(p)}
                                disabled={busy === `grant-${p.participant_id}`}
                                className="rounded bg-gold px-3 py-1 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40"
                              >
                                Give mic
                              </button>
                            )}
                            <button
                              onClick={() => void removeParticipant(p)}
                              disabled={busy === `remove-${p.participant_id}`}
                              className="rounded border border-neutral-600 px-3 py-1 text-sm text-neutral-300 hover:border-red-500 hover:text-red-400 disabled:opacity-40"
                            >
                              Remove
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="mt-4">
                    <h4 className="text-sm font-semibold text-white">
                      Call chat
                    </h4>
                    <div
                      ref={chatBox}
                      className="mt-2 h-48 space-y-2 overflow-y-auto rounded border border-neutral-800 bg-black p-3"
                    >
                      {manageMessages.length === 0 && (
                        <p className="text-sm text-neutral-500">
                          No messages yet.
                        </p>
                      )}
                      {manageMessages.map((m) => (
                        <p key={m.id} className="text-sm">
                          <span className="font-semibold text-gold">
                            {m.sender_name}
                          </span>
                          <span className="ml-2 text-neutral-200">
                            {m.body}
                          </span>
                        </p>
                      ))}
                    </div>
                    <form
                      onSubmit={sendAdminChat}
                      className="mt-2 flex gap-2"
                    >
                      <input
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        maxLength={1000}
                        placeholder="Message as Admin…"
                        className="min-w-0 flex-1 rounded border border-neutral-700 bg-black px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-gold"
                      />
                      <button
                        type="submit"
                        className="rounded bg-gold px-4 py-2 text-sm font-semibold text-black hover:brightness-110"
                      >
                        Send
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 rounded-lg border border-neutral-800 bg-panel p-4">
        <h2 className="font-serif text-lg font-bold text-white">
          Blocked attempts
        </h2>
        <p className="mt-1 text-sm text-neutral-400">
          Every rejected join shows up here live — a number that is not
          registered, or a number that is already in another meeting. The
          person inside is never touched. Email or WhatsApp alerts are a
          possible later addition; for now the alert appears here the moment
          it happens.
        </p>
        {blocked.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">
            No blocked attempts yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {blocked.slice(0, 20).map((b) => (
              <li
                key={b.id}
                className="rounded border border-neutral-800 px-3 py-2 text-sm text-neutral-200"
              >
                {blockedText(b)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-10 border-t border-neutral-800 pt-4 text-xs text-neutral-500">
        Admin login is a single shared password — test-grade, not production
        auth. Join the room yourself before investors do, so you hold the
        Jitsi moderator seat. If someone closes their browser without
        leaving, their seat is freed automatically once their presence has
        been gone for a while (or with Remove).
      </footer>
    </div>
  );
}
