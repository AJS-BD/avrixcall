'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  LiveKitRoom,
  VideoConference,
  useParticipants,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { supabase } from '@/lib/supabase-client';
import { AVRIXLAB_LOGO_URL } from '@/lib/brand';
import type {
  AvrixCall,
  CallMessage,
  ParticipantRole,
} from '@/lib/types';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Inside <LiveKitRoom>: reports the LiveKit participant list up to the
// page so the "In this call" chips render from LiveKit, not Supabase.
function ParticipantTracker({
  onChange,
}: {
  onChange: (list: { id: string; name: string }[]) => void;
}) {
  const participants = useParticipants();
  useEffect(() => {
    onChange(
      participants.map((p) => ({
        id: p.identity,
        name: p.name || 'Guest',
      })),
    );
  }, [participants, onChange]);
  return null;
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
  // LiveKit credentials, minted server-side after the member check.
  const [livekitToken, setLivekitToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string | null>(null);
  const [videoConnected, setVideoConnected] = useState(false);
  const [videoError, setVideoError] = useState('');
  // Join form — display name + FULL phone number (members only).
  const [nameInput, setNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);

  const [messages, setMessages] = useState<CallMessage[]>([]);
  const [participants, setParticipants] = useState<
    { id: string; name: string }[]
  >([]);
  const [chatInput, setChatInput] = useState('');
  const [chatError, setChatError] = useState('');

  const chatBox = useRef<HTMLDivElement | null>(null);
  // Keep the current participant row handy for the beforeunload beacon.
  const seatRef = useRef({ callId: '', participantId: '' });

  const onParticipantsChange = useCallback(
    (list: { id: string; name: string }[]) => {
      setParticipants(list);
    },
    [],
  );

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
  // gets a server-minted admin token — no phone, no participant row.
  // Guests reuse a stored join (name + phone + participant row) after
  // verifying it, which mints a fresh token; otherwise they join with
  // name + phone through the member check.
  useEffect(() => {
    if (!call || call.status !== 'live') return;
    const urlName = searchParams.get('name');
    const urlRole = searchParams.get('role');
    if (urlRole === 'admin' && urlName) {
      let cancelled = false;
      fetch('/api/admin/livekit-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_id: id }),
      })
        .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
        .then(({ ok, data }) => {
          if (cancelled || !ok) return;
          const pid =
            sessionStorage.getItem(`avrixcall_pid_${id}`) ??
            crypto.randomUUID();
          sessionStorage.setItem(`avrixcall_pid_${id}`, pid);
          queueMicrotask(() => {
            setName(urlName);
            setRole('admin');
            setParticipantId(pid);
            seatRef.current = { callId: id, participantId: pid };
            setLivekitToken(data.token as string);
            setLivekitUrl(data.url as string);
            setJoined(true);
          });
        })
        .catch(() => {
          // Admin token failed — stay on the join form.
        });
      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;
    const storedName = sessionStorage.getItem('avrixcall_name') ?? '';
    const storedPhone = sessionStorage.getItem('avrixcall_phone') ?? '';
    const storedPid = sessionStorage.getItem(`avrixcall_pid_${id}`);
    queueMicrotask(() => {
      setNameInput(storedName);
      setPhoneInput(storedPhone);
    });

    if (storedPid && storedName && storedPhone) {
      fetch(`/api/calls/${id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: storedName,
          phone: storedPhone,
          participant_id: storedPid,
        }),
      })
        .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
        .then(({ ok, data }) => {
          if (cancelled || !ok) return;
          setName(data.name as string);
          setRole('guest');
          setParticipantId(data.participant_id as string);
          seatRef.current = {
            callId: id,
            participantId: data.participant_id as string,
          };
          setLivekitToken(data.token as string);
          setLivekitUrl(data.url as string);
          setJoined(true);
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
    if (!phoneInput.trim()) {
      setJoinError('Enter your phone number.');
      return;
    }
    setJoinBusy(true);
    setJoinError('');
    const res = await fetch(`/api/calls/${id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmedName, phone: phoneInput.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setJoinBusy(false);
    if (!res.ok) {
      setJoinError((data?.error as string) || 'Could not join the call.');
      return;
    }
    sessionStorage.setItem('avrixcall_name', trimmedName);
    sessionStorage.setItem('avrixcall_phone', phoneInput.trim());
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
    setLivekitToken(data.token as string);
    setLivekitUrl(data.url as string);
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

  // Realtime channel: call updates + chat. Presence comes from LiveKit
  // (ParticipantTracker), not Supabase.
  useEffect(() => {
    if (!joined || !callId || !name || !participantId) return;

    const channel: RealtimeChannel = supabase.channel(`call:${callId}`);

    channel
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'avrix_calls',
          filter: `id=eq.${callId}`,
        },
        (payload) => {
          const row = ((payload as { new?: unknown }).new ?? {}) as Record<
            string,
            unknown
          >;
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
          const row = ((payload as { new?: unknown }).new ?? {}) as Record<
            string,
            unknown
          >;
          const msg = row as unknown as CallMessage;
          if (msg.id) {
            setMessages((prev) =>
              prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
            );
          }
        },
      )
      .subscribe();

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
    router.push('/');
  }

  // ---- render states ----

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-16">
        <div className="card fade-up w-full max-w-md px-6 py-10 text-center sm:px-8">
          <p className="text-red-400">{loadError}</p>
          <Link href="/" className="btn-primary mt-6">
            Back to calls
          </Link>
        </div>
      </div>
    );
  }

  if (!call) {
    return (
      <div className="flex min-h-screen items-center justify-center px-5 text-muted">
        Loading call…
      </div>
    );
  }

  if (call.status === 'ended') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-16">
        <div className="card fade-up w-full max-w-md px-6 py-10 text-center sm:px-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={AVRIXLAB_LOGO_URL}
            alt="Avrix Labs"
            className="mx-auto h-11 w-auto"
          />
          <h1 className="mt-6 font-display text-3xl font-semibold text-cream">
            This call has ended.
          </h1>
          <p className="mt-2 text-sm text-muted">
            Thanks for joining “{call.title}”.
          </p>
          <Link href="/" className="btn-primary mt-6">
            Back to calls
          </Link>
        </div>
      </div>
    );
  }

  if (call.status === 'scheduled') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-16">
        <div className="card fade-up w-full max-w-md px-6 py-10 text-center sm:px-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={AVRIXLAB_LOGO_URL}
            alt="Avrix Labs"
            className="mx-auto h-11 w-auto"
          />
          <h1 className="mt-6 font-display text-3xl font-semibold text-cream">
            This call hasn&apos;t started yet.
          </h1>
          <p className="mt-2 text-sm text-muted">
            “{call.title}” is scheduled
            {call.scheduled_at
              ? ` for ${new Date(call.scheduled_at).toLocaleString()}`
              : ''}
            . Come back when the admin starts it.
          </p>
          <Link href="/" className="btn-primary mt-6">
            Back to calls
          </Link>
        </div>
      </div>
    );
  }

  if (!joined || !livekitToken || !livekitUrl) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-16">
        <div className="card fade-up w-full max-w-md p-6 sm:p-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={AVRIXLAB_LOGO_URL}
            alt="Avrix Labs"
            className="h-11 w-auto"
          />
          <h1 className="mt-6 font-display text-3xl font-semibold text-cream">
            Join “{call.title}”
          </h1>
          <p className="mt-2 text-sm text-muted">
            Members only — enter your name and the phone number the admin
            registered for you. No account, no password.
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
              className="field"
            />
            <input
              value={phoneInput}
              onChange={(e) => {
                setPhoneInput(e.target.value);
                setJoinError('');
              }}
              inputMode="tel"
              autoComplete="tel"
              maxLength={20}
              placeholder="Phone number, e.g. 01XXXXXXXXX"
              className="field"
            />
            {joinError && <p className="text-sm text-red-400">{joinError}</p>}
            <button
              type="submit"
              disabled={joinBusy}
              className="btn-primary btn-block"
            >
              {joinBusy ? 'Checking…' : 'Join meeting'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ---- live room ----
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-ink/85 px-4 py-3 backdrop-blur sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={AVRIXLAB_LOGO_URL}
            alt="Avrix Labs"
            className="h-8 w-auto shrink-0"
          />
          <h1 className="truncate font-display text-lg font-semibold leading-tight text-cream">
            {call.title}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="pill pill-green">
            <span className="pulse-dot mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald" />
            LIVE
          </span>
          <button onClick={leave} className="btn-danger">
            Leave
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <div className="flex flex-1 flex-col gap-3 p-4 lg:p-5">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-black">
            <div className="h-[55vh] w-full lg:h-auto lg:min-h-[62vh] lg:flex-1">
              <LiveKitRoom
                token={livekitToken}
                serverUrl={livekitUrl}
                connect
                audio={false}
                video={false}
                onConnected={() => {
                  setVideoConnected(true);
                  setVideoError('');
                }}
                onDisconnected={() => setVideoConnected(false)}
                onError={(err) =>
                  setVideoError(
                    err?.message ||
                      'Could not connect to the video service.',
                  )
                }
                className="h-full w-full"
              >
                <VideoConference />
                <ParticipantTracker onChange={onParticipantsChange} />
              </LiveKitRoom>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <p className="text-sm text-muted">
              Members-only LiveKit call — your mic and camera start off;
              turn them on from the video controls.
              {videoConnected ? '' : ' Connecting to video…'}
            </p>
            {videoError && (
              <p className="text-sm text-red-400">{videoError}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 px-1">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              In this call ({participants.length})
            </span>
            {participants.length > 0 ? (
              participants.map((p) => (
                <span key={p.id} className="pill pill-muted">
                  {p.name}
                </span>
              ))
            ) : (
              <span className="text-xs text-muted">just you so far</span>
            )}
          </div>
        </div>

        <aside className="flex h-[45vh] w-full flex-col border-t border-line bg-panel lg:h-auto lg:w-[380px] lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-display text-base font-semibold text-cream">
              Group chat
            </h2>
            <span className="pill pill-muted">
              {messages.length} {messages.length === 1 ? 'message' : 'messages'}
            </span>
          </div>
          <div
            ref={chatBox}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
          >
            {messages.length === 0 && (
              <p className="py-6 text-center text-sm text-muted">
                No messages yet — say hello. Everyone in the call can text
                here.
              </p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className="rounded-xl border border-line bg-panel2 px-3 py-2"
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold text-goldlight">
                    {m.sender_name}
                  </span>
                  {m.sender_role === 'admin' && (
                    <span className="pill pill-gold">ADMIN</span>
                  )}
                  <span className="text-xs text-muted">
                    {formatTime(m.created_at)}
                  </span>
                </div>
                <p className="mt-1 break-words text-sm text-cream">{m.body}</p>
              </div>
            ))}
          </div>
          <form onSubmit={sendMessage} className="border-t border-line p-3">
            <div className="flex gap-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                maxLength={1000}
                placeholder="Message everyone…"
                className="field mt-0 min-w-0 flex-1"
              />
              <button type="submit" className="btn-primary btn-sm shrink-0">
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
        <div className="flex min-h-screen items-center justify-center px-5 text-muted">
          Loading call…
        </div>
      }
    >
      <RoomInner />
    </Suspense>
  );
}
