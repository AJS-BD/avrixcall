#!/usr/bin/env bash
# Deploy branded self-hosted Jitsi (AvrixCall) on Ubuntu 22.04/24.04.
# Run on the VPS as root (or with sudo). Expects .env already created
# from .env.example with CALLS_DOMAIN filled in.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (or with sudo)." >&2; exit 1
fi
if [ ! -f .env ]; then
  echo "Missing .env — copy .env.example to .env and set CALLS_DOMAIN first." >&2
  exit 1
fi

# 1. Docker + git
apt-get update -qq
apt-get install -y -qq curl git ca-certificates
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 2. Official Jitsi Meet Docker stack, latest stable release
if [ ! -d docker-jitsi-meet ]; then
  TAG=$(curl -fsSL https://api.github.com/repos/jitsi/docker-jitsi-meet/releases \
    | grep -m1 '"tag_name": "stable-' | sed 's/.*"tag_name": "\(stable-[^"]*\)".*/\1/')
  echo "Using docker-jitsi-meet tag: ${TAG:-(default branch)}"
  git clone https://github.com/jitsi/docker-jitsi-meet.git
  cd docker-jitsi-meet
  [ -n "${TAG:-}" ] && git checkout "$TAG" || true
else
  cd docker-jitsi-meet
fi

# 3. Config + branding assets alongside the stack
cp ../.env .env
mkdir -p branding
cp ../branding/logo.png ../branding/custom.css branding/ 2>/dev/null || true
echo "Branding assets copied to $(pwd)/branding/ — apply per the repo's"
echo "customization docs (logo + custom.css), then start the stack."

# 4. Start
docker compose up -d
echo
echo "Jitsi is starting. First run takes a few minutes (images + TLS cert)."
echo "Check with: docker compose ps && docker compose logs -f web"
