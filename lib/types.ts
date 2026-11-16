export type CallStatus = 'scheduled' | 'live' | 'ended';

export interface AvrixCall {
  id: string;
  title: string;
  room_name: string;
  status: CallStatus;
  scheduled_at: string | null;
  started_at: string | null;
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
  // Participant row id of the joiner (null for admin messages).
  participant_id: string | null;
  body: string;
  created_at: string;
}

export type ParticipantRole = 'admin' | 'guest';

// Realtime presence carries ONLY id + name.
export interface ParticipantPresence {
  participant_id: string;
  name: string;
}
