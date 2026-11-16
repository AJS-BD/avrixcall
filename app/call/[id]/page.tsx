'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase-client';
import { AVRIXLAB_LOGO_URL } from '@/lib/brand';
import type {
  AvrixCall,
  CallMessage,
  ParticipantPresence,
  ParticipantRole,
} from '@/lib/types';

// Jitsi server. Override with NEXT_PUBLIC_JITSI_DOMAIN when moving to a
// self-hosted server later — this is the only place the domain lives.
const JITSI_DOMAIN =
  process.env.NEXT_PUBLIC_JITSI_DOMAIN ?? 'meet.jit.si';

function asRecord(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function RoomInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = Array.isArray(params.id) ? params.id[0] : (params.id as string);

  const [call, setCall] = useState<AvrixCall | null>(null);
  const [loadError, setLoadError] = useState('');
  // Identity, resolved once joined (or admin bypass).
  const [name, setName] = useState<string | null>(null);
  const [role, setRole] = useState<ParticipantRole>('guest');
  const [participantId, setParticipantId] = useState('');
  const [joined, setJoined] = useState(false);
  // Join form — display name only, no phone, no allowlist.
  const [nameInput, setNameInput] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);

  const [messages, setMessages] = useState<CallMessage[]>([]);
  const [participants, setParticipants] = useState<ParticipantPresence[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatError, setChatError] = useState('');
  const [jitsiJoined, setJitsiJoined] = useState(false);
  const [jitsiError, setJitsiError] = useState('');

  const jitsiApi = useRef<JitsiMeetExternalAPIInstance | null>(null);
  const jitsiContainer = useRef<HTMLDivElement | null>(null);
  const jitsiStarted = useRef(false);
  const chatBox = useRef<HTMLDivElement | null>(null);
  // Keep the current participant row handy for the beforeunload beacon.
  const seatRef = useRef({ callId: '', participantId: '' });

  // Load the call.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    supabase
      .from('avrix_calls')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) setLoadError('Call not found.');
        else setCall(data as AvrixCall);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const callId = call?.id ?? '';

  // Resolve identity. Admin (?name=Admin&role=admin from the dashboard)
  // joins without a participant row. Guests reuse a stored participant
  // row for this call after verifying it is still active, otherwise join
  // with just a display name.
  useEffect(() => {
    if (!call || call.status !== 'live') return;
    const urlName = searchParams.get('name');
    const urlRole = searchParams.get('role');
    if (urlRole === 'admin' && urlName) {
      const pid =
        sessionStorage.getItem(`avrixcall_pid_${id}`) ?? crypto.randomUUID();
      sessionStorage.setItem(`avrixcall_pid_${id}`, pid);
      // Deferred: state updates do not belong in the synchronous effect body.
      queueMicrotask(() => {
        setName(urlName);
        setRole('admin');
        setParticipantId(pid);
        seatRef.current = { callId: id, participantId: pid };
        setJoined(true);
      });
      return;
    }

    let cancelled = false;
    const storedName = sessionStorage.getItem('avrixcall_name') ?? '';
    const storedPid = sessionStorage.getItem(`avrixcall_pid_${id}`);
    queueMicrotask(() => {
      setNameInput(storedName);
    });

    if (storedPid && storedName) {
      fetch(
        `/api/calls/${id}/join?participant_id=${encodeURIComponent(storedPid)}`,
      )
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          if (data?.active) {
            setName(data.name as string);
            setRole('guest');
            setParticipantId(data.participant_id as string);
            seatRef.current = {
              callId: id,
              participantId: data.participant_id as string,
            };
            setJoined(true);
          } else {
            // Participant row was closed — join again with a name.
            sessionStorage.removeItem(`avrixcall_pid_${id}`);
          }
        })
        .catch(() => {
          // Verification failed — stay on the join form.
        });
    }
    return () => {
      cancelled = true;
    };
  }, [call, id, searchParams]);

  async function joinMeeting(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = nameInput.trim();
    if (!trimmedName) {
      setJoinError('Enter your name.');
      return;
    }
    setJoinBusy(true);
    setJoinError('');
    const res = await fetch(`/api/calls/${id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmedName }),
    });
    const data = await res.json().catch(() => ({}));
    setJoinBusy(false);
    if (!res.ok) {
      setJoinError((data?.error as string) || 'Could not join the call.');
      return;
    }
    sessionStorage.setItem('avrixcall_name', trimmedName);
    sessionStorage.setItem(
      `avrixcall_pid_${id}`,
      data.participant_id as string,
    );
    setName(data.name as string);
    setRole('guest');
    setParticipantId(data.participant_id as string);
    seatRef.current = {
      callId: id,
      participantId: data.participant_id as string,
    };
    setJoined(true);
  }

  // Mark the participant row closed. Best effort on page close (beacon)
  // and on Leave. Admins have no row — the call is a no-op for them.
  const leaveSeat = useCallback((beacon: boolean) => {
    const seat = seatRef.current;
    if (!seat.participantId || !seat.callId) return;
    const payload = JSON.stringify({ participant_id: seat.participantId });
    if (beacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(
        `/api/calls/${seat.callId}/leave`,
        new Blob([payload], { type: 'application/json' }),
      );
    } else {
      void fetch(`/api/calls/${seat.callId}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      });
    }
    seatRef.current = { callId: '', participantId: '' };
  }, []);

  useEffect(() => {
    const onUnload = () => leaveSeat(true);
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [leaveSeat]);

  // Start Jitsi once (never re-init on call updates).
  useEffect(() => {
    if (!joined || !call || !name || call.status === 'ended' || jitsiStarted.current) {
      return;
    }
    const container = jitsiContainer.current;
    if (!container) return;
    jitsiStarted.current = true;

    let api: JitsiMeetExternalAPIInstance | null = null;
    let disposed = false;

    const init = () => {
      if (disposed || !window.JitsiMeetExternalAPI) return;
      api = new window.JitsiMeetExternalAPI(JITSI_DOMAIN, {
        roomName: call.room_name,
        width: '100%',
        height: '100%',
        parentNode: container,
        userInfo: { displayName: name },
        configOverwrite: {
          startWithAudioMuted: true,
          startWithVideoMuted: true,
          prejoinPageEnabled: false,
          disableDeepLinking: true,
          enableWelcomePage: false,
        },
        interfaceConfigOverwrite: { SHOW_JITSI_WATERMARK: false },
      });
      jitsiApi.current = api;
      api.addListener('videoConferenceJoined', () => setJitsiJoined(true));
    };

    if (window.JitsiMeetExternalAPI) {
      init();
    } else {
      const script = document.createElement('script');
      script.src = `https://${JITSI_DOMAIN}/external_api.js`;
      script.async = true;
      script.onload = init;
      script.onerror = () =>
        setJitsiError(
          'Could not load the video service. Check your connection and reload.',
        );
      document.head.appendChild(script);
    }

    return () => {
      disposed = true;
      try {
        api?.dispose();
      } catch {
        // Ignore.
      }
      jitsiApi.current = null;
    };
  }, [joined, call, name]);

  // Realtime channel: presence + call updates + chat.
  // Presence carries {participant_id, name} ONLY.
  useEffect(() => {
    if (!joined || !callId || !name || !participantId) return;

    const channel: RealtimeChannel = supabase.channel(`call:${callId}`, {
      config: { presence: { key: participantId }, broadcast: { self: true } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const list = (Object.values(state).flat() as unknown[])
          .map((p) => asRecord(p))
          .map((p) => ({
            participant_id: String(p.participant_id ?? ''),
            name: String(p.name ?? 'Guest'),
          }))
          .filter((p) => p.participant_id);
        setParticipants(list);
      })
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'avrix_calls',
          filter: `id=eq.${callId}`,
        },
        (payload) => {
          const row = asRecord((payload as { new?: unknown }).new);
          setCall((prev) =>
            prev
              ? {
                  ...prev,
                  status: (row.status as AvrixCall['status']) ?? prev.status,
                  ended_at: (row.ended_at as string | null) ?? null,
                }
              : prev,
          );
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'avrix_call_messages',
          filter: `call_id=eq.${callId}`,
        },
        (payload) => {
          const row = asRecord((payload as { new?: unknown }).new);
          const msg = row as unknown as CallMessage;
          if (msg.id) {
            setMessages((prev) =>
              prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
            );
          }
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void channel.track({ participant_id: participantId, name });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [joined, callId, name, participantId]);

  // Chat history.
  useEffect(() => {
    if (!callId) return;
    supabase
      .from('avrix_call_messages')
      .select('*')
      .eq('call_id', callId)
      .order('created_at', { ascending: true })
      .limit(200)
      .then(({ data }) => {
        if (data) setMessages(data as CallMessage[]);
      });
  }, [callId]);

  // Auto-scroll chat to the newest message.
  useEffect(() => {
    const el = chatBox.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const body = chatInput.trim();
    if (!body || !callId || !name) return;
    setChatInput('');
    setChatError('');
    const { data, error } = await supabase
      .from('avrix_call_messages')
      .insert({
        call_id: callId,
        sender_name: name,
        sender_role: role,
        participant_id: role === 'admin' ? null : participantId,
        body: body.slice(0, 1000),
      })
      .select()
      .single();
    if (error) {
      setChatError('Message could not be sent.');
      return;
    }
    if (data) {
      const msg = data as CallMessage;
      setMessages((prev) =>
        prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
      );
    }
  }

  function leave() {
    leaveSeat(false);
    try {
      jitsiApi.current?.dispose();
    } catch {
      // Ignore.
    }
    router.push('/');
  }

  // ---- render states ----

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 text-center">
        <p className="text-red-400">{loadError}</p>
        <Link href="/" className="mt-4 inline-block text-gold underline">
          Back to calls
        </Link>
      </div>
    );
  }

  if (!call) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 text-center text-neutral-400">
        Loading call…
      </div>
    );
  }

  if (call.status === 'ended') {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 text-center">
        <h1 className="font-serif text-2xl font-bold text-white">
          This call has ended.
        </h1>
        <p className="mt-2 text-neutral-400">
          Thanks for joining “{call.title}”.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded bg-gold px-4 py-2 text-sm font-semibold text-black"
        >
          Back to calls
        </Link>
      </div>
    );
  }

  if (call.status === 'scheduled') {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 text-center">
        <h1 className="font-serif text-2xl font-bold text-white">
          This call hasn&apos;t started yet.
        </h1>
        <p className="mt-2 text-neutral-400">
          “{call.title}” is scheduled
          {call.scheduled_at
            ? ` for ${new Date(call.scheduled_at).toLocaleString()}`
            : ''}
          . Come back when the admin starts it.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded bg-gold px-4 py-2 text-sm font-semibold text-black"
        >
          Back to calls
        </Link>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="mx-auto max-w-md px-5 py-16">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={AVRIXLAB_LOGO_URL}
          alt="Avrix Labs"
          className="h-10 w-auto"
        />
        <h1 className="mt-6 font-serif text-2xl font-bold text-white">
          Join “{call.title}”
        </h1>
        <p className="mt-2 text-neutral-400">
          Just your display name — no account, no password, no rules.
        </p>
        <form onSubmit={joinMeeting} className="mt-6 space-y-3">
          <input
            value={nameInput}
            onChange={(e) => {
              setNameInput(e.target.value);
              setJoinError('');
            }}
            maxLength={60}
            placeholder="Your name"
            autoFocus
            className="w-full rounded border border-neutral-700 bg-black px-3 py-2 text-white outline-none placeholder:text-neutral-600 focus:border-gold"
          />
          {joinError && <p className="text-sm text-red-400">{joinError}</p>}
          <button
            type="submit"
            disabled={joinBusy}
            className="w-full rounded bg-gold px-4 py-2 font-semibold text-black hover:brightness-110 disabled:opacity-40"
          >
            {joinBusy ? 'Joining…' : 'Join meeting'}
          </button>
        </form>
      </div>
    );
  }

  // ---- live room ----
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={AVRIXLAB_LOGO_URL}
            alt="Avrix Labs"
            className="h-8 w-auto"
          />
          <h1 className="font-serif text-lg font-bold leading-tight text-white">
            {call.title}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            LIVE
          </span>
          <button
            onClick={leave}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500"
          >
            Leave
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <div className="flex flex-1 flex-col">
          <div
            ref={jitsiContainer}
            className="h-[55vh] w-full bg-black lg:h-auto lg:min-h-[70vh] lg:flex-1"
          />
          <div className="border-t border-neutral-800 px-4 py-2 text-sm">
            <p className="text-neutral-400">
              Plain Jitsi call — control your own mic and camera in the video
              window.
              {jitsiJoined ? '' : ' Connecting to video…'}
            </p>
            {jitsiError && <p className="mt-1 text-red-400">{jitsiError}</p>}
          </div>
          <div className="border-t border-neutral-800 px-4 py-2">
            <p className="text-xs text-neutral-500">
              In this call ({participants.length}):{' '}
              {participants.length > 0
                ? participants.map((p) => p.name).join(', ')
                : 'just you so far'}
            </p>
          </div>
        </div>

        <aside className="flex h-[45vh] w-full flex-col border-t border-neutral-800 bg-panel lg:h-auto lg:w-[360px] lg:border-l lg:border-t-0">
          <h2 className="border-b border-neutral-800 px-4 py-3 font-serif text-base font-bold text-white">
            Group chat
          </h2>
          <div
            ref={chatBox}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
          >
            {messages.length === 0 && (
              <p className="text-sm text-neutral-500">
                No messages yet — say hello. Everyone in the call can text
                here.
              </p>
            )}
            {messages.map((m) => (
              <div key={m.id} className="text-sm">
                <span className="font-semibold text-gold">{m.sender_name}</span>
                {m.sender_role === 'admin' && (
                  <span className="ml-1 rounded bg-gold/20 px-1 text-[10px] font-bold text-gold">
                    ADMIN
                  </span>
                )}
                <span className="ml-2 text-xs text-neutral-500">
                  {formatTime(m.created_at)}
                </span>
                <p className="mt-0.5 break-words text-neutral-200">{m.body}</p>
              </div>
            ))}
          </div>
          <form
            onSubmit={sendMessage}
            className="border-t border-neutral-800 p-3"
          >
            <div className="flex gap-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                maxLength={1000}
                placeholder="Message everyone…"
                className="min-w-0 flex-1 rounded border border-neutral-700 bg-black px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-gold"
              />
              <button
                type="submit"
                className="shrink-0 rounded bg-gold px-4 py-2 text-sm font-semibold text-black hover:brightness-110"
              >
                Send
              </button>
            </div>
            {chatError && (
              <p className="mt-2 text-xs text-red-400">{chatError}</p>
            )}
          </form>
        </aside>
      </div>
    </div>
  );
}

export default function CallPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl px-5 py-16 text-center text-neutral-400">
          Loading call…
        </div>
      }
    >
      <RoomInner />
    </Suspense>
  );
}
