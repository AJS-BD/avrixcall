export type CallStatus = 'scheduled' | 'live' | 'ended';

export interface AvrixCall {
  id: string;
  title: string;
  room_name: string;
  status: CallStatus;
  scheduled_at: string | null;
  current_speaker_id: string | null;
  current_speaker_name: string | null;
  created_at: string;
  ended_at: string | null;
}

export interface CallMessage {
  id: string;
  call_id: string;
  sender_name: string;
  sender_role: 'admin' | 'guest';
  // Client-supplied id of the verified join; null for admin messages.
  participant_id: string | null;
  body: string;
  created_at: string;
}

export type ParticipantRole = 'admin' | 'guest';

// Realtime presence carries ONLY id + name — never a phone number.
export interface ParticipantPresence {
  participant_id: string;
  name: string;
}

export interface AllowlistEntry {
  phone: string;
  name: string | null;
  created_at: string;
}

export interface CallParticipant {
  id: string;
  call_id: string;
  phone: string;
  name: string;
  participant_id: string;
  joined_at: string;
  left_at: string | null;
}

export interface BlockedAttempt {
  id: string;
  call_id: string | null;
  phone: string;
  attempted_name: string | null;
  reason: 'not_registered' | 'already_in_meeting';
  active_call_id: string | null;
  attempted_at: string;
  target_call_title?: string | null;
  active_call_title?: string | null;
}
