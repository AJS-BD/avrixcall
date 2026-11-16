# AvrixCall

A small, standalone group-call tool for Avrixlab investors. Separate app,
separate repo — the Avrixlab site itself is untouched.

- **Admin** creates a call (scheduled, or Start now), opens the room first,
  and runs it.
- **Investors** join from the link with their **name + phone number**. No
  password, no account — the phone number is the entry pass.
- **One speaker at a time.** Everyone joins muted, camera off. The admin
  gives the mic (and camera) to one person at a time and can take it back.
- **Text chat is open to everyone** for the whole call.

Stack: Next.js 16 (App Router) + TypeScript + Tailwind v4 + Supabase.
Video: Jitsi Meet IFrame API (script tag, no jitsi npm package). The only
npm dependency beyond the Next.js scaffold is `@supabase/supabase-js`.

## How joining works (plain language)

1. The joiner opens the AvrixCall link, clicks **Join meeting**, and enters
   **name + phone number**.
2. The phone number must already be on the **allowlist** — a list the admin
   manages in the admin panel. If it is not there, the join is refused:
   _"This number is not registered for AvrixCall — ask the admin to add it."_
3. **One phone number = one active seat SYSTEM-WIDE.** A number can join
   meetings over time, but it can hold only one active seat at any moment.
   If the number already has an active session in **any** call and someone
   else tries to join with that same number, the new attempt is blocked —
   _"This number is already in a meeting."_ — and the person already
   inside is **not touched**: they stay in their meeting, untouched.
   Matching is always on the **full normalized number**, never on the last
   digits.
4. When the first person leaves, the number is free again and can join
   again (same or different meeting).

### Why an allowlist?

The main Avrixlab database has **no phone column anywhere** (profiles are
email + full name only). So AvrixCall cannot check numbers against Avrixlab —
it keeps its own allowlist (`avrix_call_allowlist`), managed by the admin.
V1 source of truth = the allowlist. If phone numbers are ever added to the
main Avrixlab DB, the join check can be pointed at that instead.

### Phone normalization

All numbers are stored and compared in one canonical form: 13 digits
starting with `880` (Bangladesh country code, no `+`, no leading `0`).
`lib/phone.ts` is the one helper, used everywhere:

- `+880 1XXX-XXXXXX` / `8801XXXXXXXXX` → kept as-is
- `01XXXXXXXXX` (11 digits) → `8801XXXXXXXXX`
- `1XXXXXXXXX` (10 digits) → `8801XXXXXXXXX`
- anything else → invalid, the join is refused

### Blocked attempts (admin is notified)

Every rejected join is recorded in `avrix_call_blocked_attempts`:

- `not_registered` — the number is not on the allowlist
- `already_in_meeting` — the number already holds an active seat, with
  `active_call_id` saying which call it is in

The admin dashboard has a live **Blocked attempts** section: the moment a
blocked attempt arrives, a red banner appears with the time, the number,
the name tried, the reason, and (for duplicates) which call the number is
already in — plus a list of recent attempts. This in-dashboard live alert
is the v1 notification. Email or WhatsApp alerts are a possible later
addition, not v1. Blocked joiners are never told anything about who owns
the number.

### Stuck seats

If a joiner just closes the browser, their participant row stays active and
their number stays blocked system-wide. Three things handle it:

1. The room client frees its seat on clean leave, and best-effort on page
   close (a `beforeunload` beacon).
2. While a call is live, the admin dashboard watches the Realtime presence
   channel and automatically frees any seat whose presence has been gone
   for a while (90-second grace, so nobody is freed while still
   connecting).
3. The admin has a **Remove** button per participant — it frees the number
   at once and kicks the person out of the room live (a `kicked` signal).
   A removed number can rejoin unless it is also removed from the
   allowlist.

## The call itself

- Video runs on the **free Jitsi server** (`meet.jit.si`), up to 100
  people per call. The domain is one env var,
  `NEXT_PUBLIC_JITSI_DOMAIN` — when the team moves to a self-hosted Jitsi
  server later, change only that value.
- Everyone joins with mic + camera off (`startWithAudioMuted`,
  `startWithVideoMuted`, no prejoin page).
- The admin grants speak to one participant: the server route updates
  `avrix_calls.current_speaker_id/name`, and the admin's browser
  broadcasts a `grant-speak` signal on the Realtime channel
  `call:<id>`; the matching client unmutes its own mic + camera.
  `revoke-speak` takes it back; `mute-all` mutes everyone. Presence on
  the same channel tracks who is in the call.
- Chat: `avrix_call_messages` via Realtime `postgres_changes` + initial
  fetch, newest at the bottom, auto-scroll, 1000-character limit. Each
  message carries the `participant_id` of the verified join (null for
  admin messages from the dashboard).

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in real values, never commit .env.local
npm run dev
```

## Setup

1. **Database** — run `supabase/migrations/0001_avrixcall.sql` once in the
   Supabase SQL editor of the **shared Avrixlab project** (ref
   `vdutlzgqucpzfpwkotfg`). It creates ONLY new tables
   (`avrix_calls`, `avrix_call_messages`, `avrix_call_allowlist`,
   `avrix_call_participants`, `avrix_call_blocked_attempts`) and touches no
   existing table. It also adds the new tables to the `supabase_realtime`
   publication (needed for live chat, speaker updates, and blocked-attempt
   alerts).
2. **Env vars** — see `.env.example`:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` (server only),
   `ADMIN_PASSWORD` (the `/admin` login),
   `NEXT_PUBLIC_JITSI_DOMAIN` (default `meet.jit.si`).
3. **Allowlist** — sign in at `/admin` and add investor numbers before the
   first call. The list starts empty, so nobody can join until the admin
   adds numbers.
4. **Deploy** — Vercel, from the GitHub repo `AJS-BD/avrixcall`. Set the
   same env vars in Vercel (Production).

## Pages & routes

- `/` — public home: live calls first, then scheduled; join with name +
  phone.
- `/call/[id]` — the room: Jitsi video + live group chat + speaker banner.
- `/admin` — password login, then: create/start/end calls, allowlist
  management, live participant list with Give mic / Take mic back /
  Remove, Mute all, call chat, and the live Blocked attempts section.
- `POST /api/calls/[id]/join` — name + phone → seat (allowlist check,
  system-wide seat check, race-safe via the partial unique index).
- `POST /api/calls/[id]/leave` — free a seat (`left_at = now()`).
- `GET /api/admin/participants?call_id=` — active participants (admin).
- `POST /api/admin/participants/remove` — free a seat + kick (admin).
- `GET/POST/DELETE /api/admin/allowlist` — manage the allowlist (admin).
- `GET /api/admin/blocked-attempts` — recent blocked attempts (admin).
- `POST /api/admin/login` / `POST /api/admin/logout` — admin cookie.
- `POST /api/admin/calls`, `PATCH /api/admin/calls/[id]` — create,
  start, end, set speaker (admin).

## Honest limitations (v1)

- **Free Jitsi server.** On `meet.jit.si` the **first person to join a
  room becomes moderator** — so the admin must open the room first; if an
  investor joins before the admin, the admin may not hold moderator and
  Jitsi's native mute-everyone may not work. Our own broadcast mute-all
  still works either way, because each client mutes itself. Also, since
  August 2023 creating a room on `meet.jit.si` needs a free Jitsi account
  sign-in — the admin should sign in at `meet.jit.si` in the same browser
  before starting a call, or the room may show a sign-in screen. The free
  server is not for commercial use per Jitsi's terms; this is a
  small-scale test, and the plan is to self-host later.
- **One-speaker enforcement is cooperative.** Grant/revoke works because
  each browser mutes/unmutes itself on our Realtime signal. A determined
  user could unmute manually in the Jitsi controls. This is a moderation
  convenience, not a hard security boundary.
- **No recording** in v1.
- **Admin login is test-grade**: one shared env password, proven by an
  HMAC-signed httpOnly cookie. Replace with real accounts before any
  production use.
- **Chat authorship is not verified server-side in v1.** The client sends
  its `participant_id` with each message, but the insert is done with the
  anon key and the server does not check that the id belongs to the
  sender. A client could post under someone else's name; RLS only limits
  inserts to the 1000-character rule.
- **Phone numbers are the credential, not a secret.** Anyone who knows an
  allowlisted number can join as that number. For this test that is the
  agreed design; a one-time code per join would be the next step if it
  ever matters.
- **Presence is not a perfect "in the room" signal.** The admin's
  stuck-seat cleanup uses presence + a 90-second grace; a seat can stay
  blocked for up to ~2 minutes after a dirty disconnect, and the Remove
  button is the instant fix.
