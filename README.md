# AvrixCall

Plain Jitsi group calls with Avrixlab branding. Separate app, separate
repo — the Avrixlab site itself is untouched.

- **Admin** creates a call (scheduled, or Start now) and opens the room
  first, so they hold the Jitsi moderator seat.
- **Anyone with a room link** joins with just a display name. No account,
  no password, no allowlist, no seat check, no mic rules — Jitsi's own
  controls handle muting and moderation.
- **Text chat is open to everyone** for the whole call.

Branding: the real Avrixlab logo, loaded from
`https://avrixlab.vercel.app/logo.png` (see `lib/brand.ts`). The image is
referenced by URL, never copied into this repo — snapshot pushes cannot
carry binaries. Dark near-black + gold theme, same as the Avrixlab site.

Stack: Next.js 16 (App Router) + TypeScript + Tailwind v4 + Supabase.
Video: Jitsi Meet IFrame API (script tag, no jitsi npm package). The only
npm dependency beyond the Next.js scaffold is `@supabase/supabase-js`.

## How joining works (plain language)

1. The joiner opens the AvrixCall link, finds the call (or types its room
   name), and enters a **display name**.
2. That is it. A lightweight participant row is created so chat messages
   carry an identity; leaving (or closing the browser) closes the row.
   No phone number is asked for or stored — the `phone` column on the
   participant table is a legacy NOT NULL column, so each row stores its
   own participant id there (unique by construction, never read).

## The call itself

- Video runs on the **free Jitsi server** (`meet.jit.si`), up to 100
  people per call. The domain is one env var,
  `NEXT_PUBLIC_JITSI_DOMAIN` — when the team moves to a self-hosted Jitsi
  server later, change only that value.
- Everyone joins with mic + camera off (`startWithAudioMuted`,
  `startWithVideoMuted`, no prejoin page). Each person unmutes
  themselves in the Jitsi controls; the first person in is the Jitsi
  moderator and can mute/remove others.
- Chat: `avrix_call_messages` via Realtime `postgres_changes` + initial
  fetch, newest at the bottom, auto-scroll, 1000-character limit. Each
  message carries the `participant_id` of the join (null for admin
  messages from the dashboard link).
- Presence on the Realtime channel `call:<id>` shows who is in the call
  (id + name only).

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in real values, never commit .env.local
npm run dev
```

## Setup

1. **Database** — `supabase/migrations/0001_avrixcall.sql` was already
   applied once in the Supabase SQL editor of the **shared Avrixlab
   project** (ref `vdutlzgqucpzfpwkotfg`). It creates ONLY new tables
   and touches no existing table. (The allowlist / blocked-attempts
   tables from that migration are no longer used by the app — they are
   simply left in place, untouched.)
2. **Env vars** — see `.env.example`:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` (server only),
   `ADMIN_PASSWORD` (the `/admin` login),
   `NEXT_PUBLIC_JITSI_DOMAIN` (default `meet.jit.si`).
3. **Deploy** — Vercel, from the GitHub repo `AJS-BD/avrixcall`. Set the
   same env vars in Vercel (Production).

## Pages & routes

- `/` — public home: Avrixlab logo, join a room by name, live calls
  first, then scheduled.
- `/call/[id]` — the room: Jitsi video + live group chat + who is in
  the call.
- `/admin` — password login, then: create/start/end calls and open the
  room.
- `POST /api/calls/[id]/join` — display name → participant row (no
  checks). `GET` verifies a stored row is still active.
- `POST /api/calls/[id]/leave` — close a participant row
  (`left_at = now()`).
- `POST /api/admin/login` / `POST /api/admin/logout` — admin cookie.
- `POST /api/admin/calls`, `PATCH /api/admin/calls/[id]` — create,
  start, end (admin).

## Honest limitations

- **Free Jitsi server.** Since August 2023, creating a room on
  `meet.jit.si` needs a logged-in moderator (Google/GitHub sign-in) —
  the meeting cannot start until a moderator signs in. The admin should
  sign in at `meet.jit.si` in the same browser before starting a call,
  or the room shows a sign-in screen. This is a provider limitation,
  not something the app works around. The free server is not for
  commercial use per Jitsi's terms; this is a small-scale test, and the
  plan is to self-host later (see `jitsi-deploy/` — prepared earlier,
  not deployed; no VPS/domain yet).
- **Anyone with a room link can join.** There is deliberately no gate
  anymore — that is the point of this version. Do not share room links
  publicly if a call should stay private.
- **No recording** in this version.
- **Admin login is test-grade**: one shared env password, proven by an
  HMAC-signed httpOnly cookie. Replace with real accounts before any
  production use.
- **Chat authorship is not verified server-side.** The client sends its
  `participant_id` with each message, but the insert is done with the
  anon key and the server does not check that the id belongs to the
  sender. A client could post under someone else's name; RLS only
  limits inserts to the 1000-character rule.
