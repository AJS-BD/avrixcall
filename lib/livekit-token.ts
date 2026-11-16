// Server-only LiveKit token minting. The API secret lives in env and
// must NEVER be imported from client code — only API routes use this
// module (join route after the member check, admin token route after
// the admin-cookie check).
import { AccessToken } from 'livekit-server-sdk';

export interface LiveKitTokenParams {
  /** Call's room slug, e.g. avrixcall-1a2b3c4d. */
  roomName: string;
  /** Stable identity — the member's normalized phone, or 'admin'. */
  identity: string;
  /** Display name shown to other participants. */
  name: string;
}

/** Mint a 6-hour join token, or null when LiveKit is not configured. */
export async function mintLiveKitToken({
  roomName,
  identity,
  name,
}: LiveKitTokenParams): Promise<string | null> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    ttl: '6h',
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });
  return token.toJwt();
}

/** Public LiveKit server URL (wss://...) for the client, or null. */
export function getLiveKitUrl(): string | null {
  return process.env.NEXT_PUBLIC_LIVEKIT_URL ?? null;
}
