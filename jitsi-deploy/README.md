# Branded self-hosted Jitsi — AvrixCall

Plain Jitsi meetings with Avrixlab branding. **No rules system** — no
allowlist, no phone check, no mic-grant flow. First person into a room is
the moderator, with Jitsi's own mute / remove / lobby controls.

Brand (taken from the live Avrixlab site):
- Logo: `branding/logo.png` — the real Avrixlab logo (gold hexagon +
  "Avrix Labs" wordmark), copied from `avrixlab-site/public/logo.png`
- Gold: `#D4AF37`, light gold `#F2D879`, gradient `#E8C95A → #D4AF37 → #F2D879`
- Near-black: `#0E0D0A` / `#121210`, text `#EDE8DC`, muted `#9A958A`
- Name shown on the welcome page: **AvrixCall**

## What you need before deploying

1. **A VPS** — Ubuntu 22.04 or 24.04, 4 vCPU / 8 GB RAM, 100 GB disk.
   (Enough for ~100 people in a call with one speaker.)
2. **A domain** — e.g. `call.avrixlab.com` or any domain Xafor owns.
   DNS: one A record pointing the domain at the server's IP.
3. **Ports open on the server:**
   - `80/tcp` and `443/tcp` — web + TLS
   - `10000/udp` — video media
   - `3478/tcp+udp` and `5349/tcp+udp` — TURN (people on strict networks)

## Deploy

```bash
# 1. Copy this folder to the server, then on the server:
cp .env.example .env
# 2. Edit .env — set CALLS_DOMAIN to the real domain (3 places).
./deploy.sh
```

`deploy.sh` installs Docker, clones the official
`jitsi/docker-jitsi-meet` repo at its latest `stable-*` tag, writes the
`.env` values, and starts everything. First start takes a few minutes
(images download, Let's Encrypt issues the certificate).

## Branding step (done at deploy time)

Jitsi's own branding hooks live in the `docker-jitsi-meet` repo docs
(custom files for the web container). At deploy time, apply from this
folder:
- `branding/logo.png` → the welcome-page / header logo
- `branding/custom.css` → black + gold overrides (colours above)
- Welcome-page title: `AvrixCall`, subtitle: `Group calls for Avrixlab investors`

Exact mount points / config keys are taken from the repo's customization
docs at deploy time — they change between releases, so they are not
hard-coded here.

## Verify live (after deploy)

1. Open `https://CALLS_DOMAIN` — welcome page shows the Avrixlab logo
   and name, no Jitsi branding.
2. Create a room, join from a second browser — video + audio work,
   no sign-in wall.
3. First joiner is moderator: mute / remove works from their toolbar.

## What stays as-is

- `https://avrixcall.vercel.app/` (the AvrixCall app with the Jitsi
  embed) stays live until the branded server is verified — then we
  switch over. Nothing is deleted.
- No Avrixlab project files were touched by this package.
