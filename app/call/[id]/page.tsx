'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase-client';
import { normalizePhone } from '@/lib/phone';
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
  // Identity, resolved once the seat is verified (or admin bypass).
  const [name, setName] = useState<string | null>(null);
  const [role, setRole] = useState<ParticipantRole>('guest');
  const [participantId, setParticipantId] = useState('');
  const [joined, setJoined] = useState(false);
  // Join gate form.
  const [nameInput, setNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [kicked, setKicked] = useState(false);

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
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Keep the current seat handy for the beforeunload beacon.
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

  // Resolve identity + seat. Admin (?name=Admin&role=admin from the
  // dashboard) skips the allowlist entirely and takes a client-side id —
  // the admin is not a phone seat. Guests reuse a stored seat for this
  // call after verifying it is still active, otherwise join via the API.
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
    const storedPhone = sessionStorage.getItem('avrixcall_phone') ?? '';
    const storedPid = sessionStorage.getItem(`avrixcall_pid_${id}`);
    queueMicrotask(() => {
      setNameInput(storedName);
      setPhoneInput(storedPhone);
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
            // Seat was freed (admin removed it, or it expired) — the
            // joiner must join again with name + phone.
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
    const phone = normalizePhone(phoneInput);
    if (!trimmedName) {
      setJoinError('Enter your name.');
      return;
    }
    if (!phone) {
      setJoinError('Enter a valid Bangladeshi phone number.');
      return;
    }
    setJoinBusy(true);
    setJoinError('');
    const res = await fetch(`/api/calls/${id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmedName, phone }),
    });
    const data = await res.json().catch(() => ({}));
    setJoinBusy(false);
    if (!res.ok) {
      setJoinError(
        (data?.error as string) || 'Could not join the call.',
      );
      return;
    }
    sessionStorage.setItem('avrixcall_name', trimmedName);
    sessionStorage.setItem('avrixcall_phone', phone);
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

  // Free the seat. Best effort on page close (beacon) and on Leave.
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

  // Mic / camera helpers: toggle only when the state actually differs.
  const setMic = useCallback(async (on: boolean) => {
    const api = jitsiApi.current;
    if (!api) return;
    try {
      const muted = await api.isAudioMuted();
      if (on && muted) api.executeCommand('toggleAudio');
      if (!on && !muted) api.executeCommand('toggleAudio');
    } catch {
      // Jitsi not ready — ignore.
    }
  }, []);

  const setVideo = useCallback(async (on: boolean) => {
    const api = jitsiApi.current;
    if (!api) return;
    try {
      const muted = await api.isVideoMuted();
      if (on && muted) api.executeCommand('toggleVideo');
      if (!on && !muted) api.executeCommand('toggleVideo');
    } catch {
      // Jitsi not ready — ignore.
    }
  }, []);

  // Start Jitsi once (never re-init on speaker/status updates).
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

  // Realtime channel: presence + speak signals + call updates + chat.
  // Presence carries {participant_id, name} ONLY — never a phone number.
  useEffect(() => {
    if (!joined || !callId || !name || !participantId) return;

    const channel: RealtimeChannel = supabase.channel(`call:${callId}`, {
      config: { presence: { key: participantId }, broadcast: { self: true } },
    });
    channelRef.current = channel;

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
      .on('broadcast', { event: 'grant-speak' }, (payload) => {
        const data = asRecord(asRecord(payload).payload);
        if (data.participant_id === participantId && role !== 'admin') {
          void setMic(true);
          void setVideo(true);
        }
      })
      .on('broadcast', { event: 'revoke-speak' }, (payload) => {
        const data = asRecord(asRecord(payload).payload);
        if (data.participant_id === participantId && role !== 'admin') {
          void setMic(false);
          void setVideo(false);
        }
      })
      .on('broadcast', { event: 'mute-all' }, () => {
        if (role === 'admin') {
          // Belt and braces: if the admin is in the room as moderator,
          // Jitsi's own mute-everyone also fires. The self-mute below is
          // what actually guarantees it for everyone else.
          try {
            jitsiApi.current?.executeCommand('muteEveryone', 'audio');
          } catch {
            // Not moderator — ignore.
          }
        } else {
          void setMic(false);
          void setVideo(false);
        }
      })
      .on('broadcast', { event: 'kicked' }, (payload) => {
        const data = asRecord(asRecord(payload).payload);
        if (data.participant_id === participantId) {
          try {
            jitsiApi.current?.dispose();
          } catch {
            // Ignore.
          }
          jitsiApi.current = null;
          void channel.untrack();
          setKicked(true);
        }
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
                  status:
                    (row.status as AvrixCall['status']) ?? prev.status,
                  current_speaker_id:
                    (row.current_speaker_id as string | null) ?? null,
                  current_speaker_name:
                    (row.current_speaker_name as string | null) ?? null,
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
      channelRef.current = null;
    };
  }, [joined, callId, name, participantId, role, setMic, setVideo]);

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

  const isSpeaker =
    role === 'admin' || call?.current_speaker_id === participantId;

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

  if (kicked) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 text-center">
        <h1 className="font-serif text-2xl font-bold text-white">
          You were removed from this call.
        </h1>
        <p className="mt-2 text-neutral-400">
          The admin removed you. Your number is free to join again — unless
          the admin also removed it from the allowlist.
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
        <h1 className="font-serif text-2xl font-bold text-white">
          Join “{call.title}”
        </h1>
        <p className="mt-2 text-neutral-400">
          Enter your name and the phone number registered with AvrixCall.
          No password, no account — your number is your entry pass. One
          number takes one seat in this meeting.
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
          <input
            value={phoneInput}
            onChange={(e) => {
              setPhoneInput(e.target.value);
              setJoinError('');
            }}
            inputMode="tel"
            autoComplete="tel"
            placeholder="Phone number, e.g. 01XXXXXXXXX"
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
          <span className="flex h-8 w-8 items-center justify-center rounded bg-gold font-serif text-base font-bold text-black">
            A
          </span>
          <div>
            <h1 className="font-serif text-lg font-bold leading-tight text-white">
              {call.title}
            </h1>
            <p className="text-xs text-neutral-400">
              {call.current_speaker_name
                ? `🎙 Now speaking: ${call.current_speaker_name}`
                : 'No one has the mic yet — the admin gives one person the mic at a time.'}
            </p>
          </div>
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
            {role === 'admin' ? (
              <p className="text-gold">
                You are in as admin — manage speakers from the{' '}
                <Link href="/admin" target="_blank" className="underline">
                  admin dashboard
                </Link>
                . Your own mic and camera are yours to control in the video
                window.
              </p>
            ) : isSpeaker ? (
              <p className="text-emerald-400">
                🎙 You have the mic — you can speak and show your camera.
              </p>
            ) : (
              <p className="text-neutral-400">
                You are muted. The admin controls the mic — only one person
                speaks at a time.
                {jitsiJoined ? '' : ' Connecting to video…'}
              </p>
            )}
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
