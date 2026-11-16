# AvrixCall

Members-only group calls with Avrixlab branding. Separate app, separate
repo — the Avrixlab site itself is untouched.

- **Admin** creates a call (scheduled, or Start now), manages the member
  list (phone numbers), and copies each call's invite link — only the
  admin can see the links.
- **Only registered members can join.** A member opens the invite link,
  enters their name and the phone number the admin registered, and the
  server mints them a short-lived LiveKit video key (6 hours). Without
  a key the video server refuses the connection — a forwarded invite
  link alone gets nobody in.
- **Text chat is open to everyone** in the call for the whole time.

Branding: the real Avrixlab logo, loaded from
`https://avrixlab.vercel.app/logo.png` (see `lib/brand.ts`). The image is
referenced by URL, never copied into this repo — snapshot pushes cannot
carry binaries. Dark near-black + gold theme, same as the Avrixlab site.

Design: the Avrixlab visual language — Fraunces serif display type +
Inter, near-black `#050505` + gold `#D4AF37` / light gold `#F2D879`, one
button system (gold primary, gold outline, ghost, danger), cards, status
pills, one field style. The shared classes live in `app/globals.css`
(`.eyebrow`, `.h2`, `.card`, `.btn-primary`, `.pill`, `.field`, …), so
every page reads as one product.

Stack: Next.js 16 (App Router) + TypeScript + Tailwind v4 + Supabase +
LiveKit (`livekit-client`, `@livekit/components-react`,
`livekit-server-sdk`).

## How joining works (plain language)

1. The admin adds a member's phone number (Members section) and sends
   them a call's invite link (Copy invite link).
2. The member opens the link (or types the room name on the home page)
   and enters their **name + full phone number**.
3. The server checks the number against the member list. Not on the
   list → turned away (403) and the attempt is logged in
   `avrix_call_blocked_attempts` for the admin.
4. On the list → the server mints a **LiveKit access token** (room =
   the call's room slug, identity = the phone number, 6-hour expiry)
   and the member joins the video. Mic and camera start off; each
   person turns them on from the video controls.
5. A lightweight participant row is created so chat messages carry an
   identity; leaving (or closing the browser) closes the row. The
   `phone` column on the participant table is a legacy NOT NULL column,
   so each row stores its own participant id there (unique by
   construction, never read). The real phone is never stored on the
   participant row — it lives on the member list only.

The admin joins from the dashboard "Open room" link: a server-minted
admin token (identity `admin`, no phone needed), protected by the admin
cookie.

## The call itself

- Video runs on **LiveKit Cloud** (free tier: 5,000 participant-minutes
  a month, 100 people per call, no card). There is no public room link:
  entry needs a server-minted token, so only members get in. If two
  people connect with the same identity, LiveKit drops the earlier one
  — sharing a number or a token locks the sharer out.
- Chat: `avrix_call_messages` via Realtime `postgres_changes` + initial
  fetch, newest at the bottom, auto-scroll, 1000-character limit. Each
  message carries the `participant_id` of the join (null for admin
  messages from the dashboard link).
- Who is in the call comes from LiveKit (`useParticipants`), shown as
  name chips under the video.

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
   and touches no existing table. No new migration is needed for this
   version — the allowlist and blocked-attempts tables from that
   migration are used again (member list + rejected joins).
2. **LiveKit** — create a free project at https://cloud.livekit.io and
   copy the API key, API secret and the project's WebSocket URL into
   the env vars below. The secret signs every video token: server-only,
   never in client code.
3. **Env vars** — see `.env.example`:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` (server only),
   `ADMIN_PASSWORD` (the `/admin` login),
   `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (server only),
   `NEXT_PUBLIC_LIVEKIT_URL` (wss://…).
4. **Deploy** — Vercel, from the GitHub repo `AJS-BD/avrixcall`. Set the
   same env vars in Vercel (Production).

## Pages & routes

- `/` — public home: sticky header with logo, hero with serif display
  headline, join-a-room-by-name card (a pasted invite link works too),
  and live/scheduled counts. **No calls are listed here** — only the
  admin sees calls and invite links.
- `/call/[id]` — the room: member gate (name + phone), then LiveKit
  video in a rounded card + live group chat (bubble messages, admin
  badge, message count) + who is in the call as name chips.
- `/admin` — password login, then a dashboard: overview stats (total /
  live / scheduled / ended), create-call card, and the calls list with
  status pills, Start / Copy invite link / Open room / End actions,
  plus Refresh; and a Members section (add/remove phone numbers). The
  list also updates live (Realtime + 30s poll). The “call is live”
  notice only shows while that call is still live.
- `POST /api/calls/[id]/join` — name + phone → member check → LiveKit
  token + participant row. `GET` verifies a stored row is still active.
- `POST /api/calls/[id]/leave` — close a participant row
  (`left_at = now()`).
- `GET /api/calls/resolve?name=` — find a call by exact title or room
  name (for the home join box, without listing calls).
- `GET /api/calls/stats` — live/scheduled counts only.
- `POST /api/admin/livekit-token` — admin token for "Open room"
  (admin cookie required).
- `GET/POST/DELETE /api/admin/allowlist` — member list (admin).
- `POST /api/admin/login` / `POST /api/admin/logout` — admin cookie.
- `POST /api/admin/calls`, `PATCH /api/admin/calls/[id]` — create,
  start, end (admin).

## Honest limitations

- **LiveKit free tier.** 5,000 participant-minutes a month (each person
  connected for one minute = 1 minute). At 2 hours a day: 5 people last
  ~8 days, 10 people ~4 days, 20 people ~2 days, 100 people ~25 minutes
  of one meeting. Regular large calls need the $50/month Ship plan
  (150,000 minutes) or a self-hosted LiveKit server later.
- **Numbers are typed, not SMS-verified.** Anyone who knows a
  registered member's number can type it in and join as that member.
  Full proof needs an SMS code (OTP) step — not built yet.
- **The public call list is hidden in the UI, not at the database.**
  The `avrix_calls` table still has a public-read RLS policy ("Public
  can view calls"), so a technical user with the anon key could still
  list call ids through the Supabase API directly. The room page and
  admin page still read that table through the anon client (Realtime),
  so dropping the policy needs a follow-up change first. The security
  boundary is the member check + LiveKit token, not the listing.
- **No recording** in this version.
- **Admin login is test-grade**: one shared env password, proven by an
  HMAC-signed httpOnly cookie. Replace with real accounts before any
  production use.
- **Chat authorship is not verified server-side.** The client sends its
  `participant_id` with each message, but the insert is done with the
  anon key and the server does not check that the id belongs to the
  sender. A client could post under someone else's name; RLS only
  limits inserts to the 1000-character rule.
