'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
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
  useSpeakingParticipants,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { supabase } from '@/lib/supabase-client';
import FaceScan from '@/components/FaceScan';
import { AVRIXLAB_LOGO_URL } from '@/lib/brand';
import {
  callStartMs,
  elapsedMs,
  formatCompact,
  formatHMS,
} from '@/lib/duration';
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

/** Rich participant info reported up from LiveKit for the side panel. */
interface ParticipantInfo {
  id: string;
  name: string;
  isSpeaking: boolean;
  micOn: boolean;
  camOn: boolean;
  isLocal: boolean;
  isAdmin: boolean;
}

// Inside <LiveKitRoom>: reports the LiveKit participant list up to the
// page so the side panel renders from LiveKit, not Supabase.
function ParticipantTracker({
  onChange,
}: {
  onChange: (list: ParticipantInfo[]) => void;
}) {
  const participants = useParticipants();
  const speaking = useSpeakingParticipants();
  const speakingIds = useMemo(
    () => new Set(speaking.map((p) => p.identity)),
    [speaking],
  );
  // Skip redundant reports — LiveKit hands us a new array identity on
  // every room event, and with 60–80 people we don't want to re-render
  // the whole room for a change that isn't one.
  const lastReport = useRef('');
  useEffect(() => {
    const list: ParticipantInfo[] = participants.map((p) => ({
      id: p.identity,
      name: p.name || 'Guest',
      isSpeaking: speakingIds.has(p.identity),
      micOn: p.isMicrophoneEnabled,
      camOn: p.isCameraEnabled,
      isLocal: p.isLocal,
      isAdmin: p.identity === 'admin',
    }));
    const key = JSON.stringify(list);
    if (key === lastReport.current) return;
    lastReport.current = key;
    onChange(list);
  }, [participants, speakingIds, onChange]);
  return null;
}

// ---- avatar helpers (deterministic initials + colour per name) ----

const AVATAR_COLORS = [
  { bg: '#2a2410', fg: '#f2d879' },
  { bg: '#052e16', fg: '#4ade80' },
  { bg: '#0c2d3a', fg: '#7dd3fc' },
  { bg: '#3b0f1e', fg: '#fda4af' },
  { bg: '#241a3a', fg: '#c4b5fd' },
  { bg: '#33230a', fg: '#fbbf24' },
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

function avatarColorOf(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function Avatar({
  name,
  size = 36,
  speaking = false,
}: {
  name: string;
  size?: number;
  speaking?: boolean;
}) {
  const c = avatarColorOf(name);
  return (
    <span
      aria-hidden
      className={`avatar-circle${speaking ? ' avatar-speaking' : ''}`}
      style={{
        width: size,
        height: size,
        backgroundColor: c.bg,
        color: c.fg,
        fontSize: Math.round(size * 0.36),
      }}
    >
      {initialsOf(name)}
    </span>
  );
}

// ---- mic / camera state icons ----

function MicIcon({ on, className }: { on: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label={on ? 'Microphone on' : 'Microphone off'}
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 19v3" />
      {!on && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

function CamIcon({ on, className }: { on: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label={on ? 'Camera on' : 'Camera off'}
    >
      <rect x="2" y="6" width="13" height="12" rx="2" />
      <path d="m15 10 7-3v10l-7-3" />
      {!on && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label="Call duration"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

// ---- one row of the participants list ----

function ParticipantRow({ p }: { p: ParticipantInfo }) {
  return (
    <li
      className={`person-row${p.isSpeaking ? ' person-row--speaking' : ''}`}
    >
      <Avatar name={p.name} size={36} speaking={p.isSpeaking} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-cream">
            {p.name}
          </span>
          {p.isLocal && (
            <span className="pill pill-gold shrink-0">YOU</span>
          )}
          {p.isAdmin && (
            <span className="pill pill-gold shrink-0">ADMIN</span>
          )}
        </span>
        <span className="mt-0.5 block text-xs text-muted">
          {p.isSpeaking ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald">
              <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald" />
              Speaking…
            </span>
          ) : !p.micOn ? (
            'Muted'
          ) : (
            'In the call'
          )}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2.5">
        <MicIcon
          on={p.micOn}
          className={`h-4 w-4 ${p.micOn ? 'text-muted' : 'text-[#e08a80]'}`}
        />
        <CamIcon
          on={p.camOn}
          className={`h-4 w-4 ${p.camOn ? 'text-muted' : 'text-[#e08a80]'}`}
        />
      </span>
    </li>
  );
}

// ---- one chat message: avatar + bubble, yours gold-tinted on the right ----

function ChatMessageBubble({ m, own }: { m: CallMessage; own: boolean }) {
  return (
    <div className={`flex gap-2.5 ${own ? 'flex-row-reverse' : ''}`}>
      <Avatar name={m.sender_name} size={32} />
      <div className="min-w-0 max-w-[82%]">
        <div
          className={`flex flex-wrap items-baseline gap-x-2 ${own ? 'justify-end' : ''}`}
        >
          <span className="text-[13px] font-semibold text-goldlight">
            {m.sender_name}
          </span>
          {m.sender_role === 'admin' && (
            <span className="pill pill-gold">ADMIN</span>
          )}
          <span className="text-[11px] text-muted">
            {formatTime(m.created_at)}
          </span>
        </div>
        <div
          className={`mt-1 px-3.5 py-2 ${own ? 'chat-bubble-own' : 'chat-bubble'}`}
        >
          <p className="break-words text-sm leading-relaxed text-cream">
            {m.body}
          </p>
        </div>
      </div>
    </div>
  );
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
  // Face verification (MVP): only for numbers with a face enrolled.
  // faceNeeded = the status check (or a server 428) says a scan is
  // required; faceDescriptor holds the captured scan until join succeeds.
  const [faceNeeded, setFaceNeeded] = useState(false);
  const [faceDescriptor, setFaceDescriptor] = useState<number[] | null>(null);

  const [messages, setMessages] = useState<CallMessage[]>([]);
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatError, setChatError] = useState('');

  // Ticking clock for the live duration timer (1s client interval).
  // Initialised to 0 and set in an effect — reading Date.now() in a
  // state initializer breaks static prerendering in Next 16.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    queueMicrotask(() => setNowMs(Date.now()));
    if (call?.status !== 'live') return;
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [call?.status]);

  // Elapsed time: started_at (created_at for calls that started before
  // the column existed) until now while live; frozen at ended_at once
  // the call ends.
  const startMs = useMemo(
    () => (call ? callStartMs(call) : null),
    [call],
  );
  const roomElapsedMs = useMemo(() => {
    if (startMs === null || !call) return 0;
    const endMs =
      call.status === 'ended' && call.ended_at
        ? new Date(call.ended_at).getTime()
        : nowMs;
    return elapsedMs(startMs, endMs);
  }, [startMs, call, nowMs]);

  // Side panel: People | Chat tabs, unread badge, people search.
  const [activeTab, setActiveTab] = useState<'participants' | 'chat'>(
    'participants',
  );
  const [unread, setUnread] = useState(0);
  const [peopleSearch, setPeopleSearch] = useState('');
  const unreadInit = useRef(false);
  const prevMsgCount = useRef(0);
  // Only auto-scroll the chat when the reader is already near the
  // bottom, so reading older messages isn't yanked away.
  const stickToBottom = useRef(true);

  const isOwnMessage = useCallback(
    (m: CallMessage) =>
      role === 'admin'
        ? m.sender_role === 'admin'
        : m.participant_id === participantId,
    [role, participantId],
  );

  // Unread chat badge: count messages from others that arrive while the
  // chat tab is not open. The first load (history) is not "new".
  useEffect(() => {
    if (!unreadInit.current) {
      unreadInit.current = true;
      prevMsgCount.current = messages.length;
      return;
    }
    if (messages.length > prevMsgCount.current) {
      const fresh = messages.slice(prevMsgCount.current);
      const fromOthers = fresh.filter((m) => !isOwnMessage(m)).length;
      if (fromOthers > 0 && activeTab !== 'chat') {
        setUnread((u) => u + fromOthers);
      }
    }
    prevMsgCount.current = messages.length;
  }, [messages, activeTab, isOwnMessage]);

  // Speaking people first, then the admin, then the rest alphabetically
  // — so at 60–80 people the person talking is always at the top.
  const sortedParticipants = useMemo(() => {
    const q = peopleSearch.trim().toLowerCase();
    const filtered = q
      ? participants.filter((p) => p.name.toLowerCase().includes(q))
      : participants;
    return [...filtered].sort((a, b) => {
      if (a.isSpeaking !== b.isSpeaking) return a.isSpeaking ? -1 : 1;
      if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [participants, peopleSearch]);

  const chatBox = useRef<HTMLDivElement | null>(null);
  // Keep the current participant row handy for the beforeunload beacon.
  const seatRef = useRef({ callId: '', participantId: '' });

  const onParticipantsChange = useCallback((list: ParticipantInfo[]) => {
    setParticipants(list);
  }, []);

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
          if (cancelled) return;
          if (!ok) {
            // Face-enrolled members cannot silently rejoin — the server
            // answers 428 face_required. Fall back to the join form with
            // the face scan step instead of retrying in a loop.
            if (data?.face_required) {
              setFaceNeeded(true);
              setJoinError(
                'Face verification is required for this number — complete the face scan below to rejoin.',
              );
            }
            return;
          }
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

  async function doJoin(descriptor: number[] | undefined) {
    const trimmedName = nameInput.trim();
    setJoinBusy(true);
    setJoinError('');
    const res = await fetch(`/api/calls/${id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: trimmedName,
        phone: phoneInput.trim(),
        ...(descriptor ? { face_descriptor: descriptor } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setJoinBusy(false);
    if (!res.ok) {
      if (data?.face_required) setFaceNeeded(true);
      // A failed match means the captured scan is spent — clear it so
      // the member scans again instead of resubmitting a stale one.
      if (data?.face_mismatch) setFaceDescriptor(null);
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
    // Already scanned in this form session — go straight to the join.
    if (faceNeeded && faceDescriptor) {
      await doJoin(faceDescriptor);
      return;
    }
    if (faceNeeded) {
      setJoinError('Complete the face scan below first, then join.');
      return;
    }
    // First submit for this number: check whether a face scan is
    // required. Not registered / not enrolled → join exactly as before.
    setJoinBusy(true);
    setJoinError('');
    const statusRes = await fetch(
      `/api/face/status?phone=${encodeURIComponent(phoneInput.trim())}`,
    ).catch(() => null);
    setJoinBusy(false);
    const status = statusRes?.ok
      ? await statusRes.json().catch(() => ({}))
      : {};
    if (status?.registered && status?.enrolled) {
      setFaceNeeded(true);
      setJoinError(
        'This number has face verification — complete the face scan below to join.',
      );
      return;
    }
    await doJoin(undefined);
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
                  // A scheduled call started by the admin arrives here —
                  // merge started_at so the timer starts from the real
                  // start, not created_at.
                  started_at:
                    (row.started_at as string | null) ?? prev.started_at,
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

  // Auto-scroll chat to the newest message — only when the reader is
  // already near the bottom (see stickToBottom).
  const onChatScroll = useCallback(() => {
    const el = chatBox.current;
    if (!el) return;
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }, []);
  useEffect(() => {
    const el = chatBox.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, activeTab]);

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
            {call.ended_at && startMs !== null && (
              <> The call lasted {formatCompact(roomElapsedMs)}.</>
            )}
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
                // A different number may not need a face (or needs a
                // different one) — reset the face step on any change.
                setFaceNeeded(false);
                setFaceDescriptor(null);
              }}
              inputMode="tel"
              autoComplete="tel"
              maxLength={20}
              placeholder="Phone number, e.g. 01XXXXXXXXX"
              className="field"
            />
            {faceNeeded &&
              (faceDescriptor ? (
                <p className="text-sm text-emerald">
                  Face captured — press Join meeting to continue.
                </p>
              ) : (
                <FaceScan
                  mode="verify"
                  onDescriptor={(d) => {
                    setFaceDescriptor(d);
                    void doJoin(d);
                  }}
                  onError={(m) => setJoinError(m)}
                />
              ))}
            {joinError && <p className="text-sm text-red-400">{joinError}</p>}
            <button
              type="submit"
              disabled={joinBusy}
              className="btn-primary btn-block"
            >
              {joinBusy ? 'Checking…' : 'Join meeting'}
            </button>
          </form>
          <p className="mt-4 text-sm text-muted">
            No face enrolled yet?{' '}
            <Link
              href="/enroll"
              className="font-semibold text-goldlight underline underline-offset-4"
            >
              Enroll your face
            </Link>{' '}
            so a typed number alone can&apos;t join as you.
          </p>
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
          <span
            className="pill pill-gold tabular-nums"
            title={`Started ${startMs !== null ? new Date(startMs).toLocaleTimeString() : ''}`}
          >
            <ClockIcon className="mr-1.5 h-3.5 w-3.5" />
            {formatHMS(roomElapsedMs)}
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
        </div>

        <aside className="flex h-[58vh] w-full flex-col border-t border-line bg-panel lg:h-auto lg:w-[400px] lg:border-l lg:border-t-0">
          {/* Tabs: People | Chat (with unread badge). */}
          <div
            role="tablist"
            aria-label="Call side panel"
            className="flex items-center gap-1 border-b border-line px-3 pt-2"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'participants'}
              onClick={() => setActiveTab('participants')}
              className={`side-tab${activeTab === 'participants' ? ' side-tab--active' : ''}`}
            >
              People
              <span className="ml-1 rounded-full bg-panel2 px-2 py-0.5 text-xs font-semibold text-cream">
                {participants.length}
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'chat'}
              onClick={() => {
                setActiveTab('chat');
                setUnread(0);
              }}
              className={`side-tab${activeTab === 'chat' ? ' side-tab--active' : ''}`}
            >
              Chat
              {unread > 0 ? (
                <span className="ml-1 rounded-full bg-gold px-2 py-0.5 text-xs font-bold text-ink">
                  {unread > 99 ? '99+' : unread}
                </span>
              ) : (
                <span className="ml-1 rounded-full bg-panel2 px-2 py-0.5 text-xs font-semibold text-cream">
                  {messages.length}
                </span>
              )}
            </button>
          </div>

          {activeTab === 'participants' ? (
            <>
              <div className="border-b border-line px-4 pb-3 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-base font-semibold text-cream">
                    In this call
                  </h2>
                  <span className="pill pill-green">
                    <span className="pulse-dot mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald" />
                    {participants.length} live
                  </span>
                </div>
                <div className="relative mt-3">
                  <input
                    value={peopleSearch}
                    onChange={(e) => setPeopleSearch(e.target.value)}
                    placeholder="Search people…"
                    aria-label="Search people"
                    className="field mt-0 w-full pr-9 text-sm"
                  />
                  {peopleSearch && (
                    <button
                      type="button"
                      onClick={() => setPeopleSearch('')}
                      aria-label="Clear search"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-1.5 text-lg leading-none text-muted hover:text-cream"
                    >
                      ×
                    </button>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted">
                  {peopleSearch
                    ? `${sortedParticipants.length} of ${participants.length} shown`
                    : `${participants.length} ${participants.length === 1 ? 'person' : 'people'} in this call`}
                </p>
              </div>
              <ul className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
                {sortedParticipants.length === 0 ? (
                  <li className="py-8 text-center text-sm text-muted">
                    {peopleSearch
                      ? `No one matches “${peopleSearch}”.`
                      : 'Just you so far.'}
                  </li>
                ) : (
                  sortedParticipants.map((p) => (
                    <ParticipantRow key={p.id} p={p} />
                  ))
                )}
              </ul>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="font-display text-base font-semibold text-cream">
                  Group chat
                </h2>
                <span className="pill pill-muted">
                  {messages.length}{' '}
                  {messages.length === 1 ? 'message' : 'messages'}
                </span>
              </div>
              <div
                ref={chatBox}
                onScroll={onChatScroll}
                className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
              >
                {messages.length === 0 && (
                  <div className="py-10 text-center">
                    <p className="font-display text-lg font-semibold text-cream">
                      Say hello 👋
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      No messages yet — everyone in the call can text here.
                    </p>
                  </div>
                )}
                {messages.map((m) => (
                  <ChatMessageBubble
                    key={m.id}
                    m={m}
                    own={isOwnMessage(m)}
                  />
                ))}
              </div>
              <form onSubmit={sendMessage} className="border-t border-line p-3">
                <div className="flex items-center gap-2">
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    maxLength={1000}
                    placeholder="Message everyone…"
                    aria-label="Message everyone"
                    className="field mt-0 min-w-0 flex-1"
                  />
                  <button
                    type="submit"
                    className="btn-primary shrink-0"
                    aria-label="Send message"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="h-4 w-4"
                      aria-hidden
                    >
                      <path d="M3.4 20.4l17.4-7.5c.8-.35.8-1.45 0-1.8L3.4 3.6c-.66-.29-1.39.2-1.45.92L1.9 9.5c-.05.48.24.93.7 1.1L15 12 2.6 13.4c-.46.17-.75.62-.7 1.1l.05 4.98c.06.72.79 1.21 1.45.92z" />
                    </svg>
                    Send
                  </button>
                </div>
                {chatError && (
                  <p className="mt-2 text-xs text-red-400">{chatError}</p>
                )}
              </form>
            </>
          )}
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
