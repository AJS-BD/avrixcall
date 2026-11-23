'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AVRIXLAB_LOGO_URL } from '@/lib/brand';
import FaceScan from '@/components/FaceScan';

// Face enrollment (MVP). A registered member enrolls their face once;
// from then on, joining a call with their number also requires a
// matching face scan. Only the 128-number descriptor computed in this
// browser is sent to the server — never a photo.
export default function EnrollPage() {
  const [phoneInput, setPhoneInput] = useState('');
  const [consent, setConsent] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function handleDescriptor(descriptor: number[]) {
    setBusy(true);
    setError('');
    const res = await fetch('/api/face/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: phoneInput.trim(),
        descriptor,
        consent: true,
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res) {
      setError('Could not reach the server. Check your connection and try again.');
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError((data?.error as string) || 'Could not enroll your face.');
      return;
    }
    setShowScan(false);
    setMessage(
      'Face enrolled. From now on, joining a call with this number will ask for a quick face scan as well as your name and number.',
    );
  }

  function begin(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    setError('');
    if (!phoneInput.trim()) {
      setError('Enter the phone number the admin registered for you.');
      return;
    }
    if (!consent) {
      setError('Please tick the consent box first — enrollment only happens with your consent.');
      return;
    }
    setShowScan(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-16">
      <div className="card fade-up w-full max-w-md p-6 sm:p-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={AVRIXLAB_LOGO_URL} alt="Avrix Labs" className="h-11 w-auto" />
        <h1 className="mt-6 font-display text-3xl font-semibold text-cream">
          Enroll your face
        </h1>
        <p className="mt-2 text-sm text-muted">
          Members only — enroll once, then joining a call with your number
          will also check your face, so a forwarded invite link and a typed
          number are not enough on their own.
        </p>

        {message ? (
          <>
            <p className="mt-6 text-sm text-emerald">{message}</p>
            <Link href="/" className="btn-primary mt-6">
              Back to calls
            </Link>
          </>
        ) : (
          <>
            <form onSubmit={begin} className="mt-6 space-y-3">
              <input
                value={phoneInput}
                onChange={(e) => {
                  setPhoneInput(e.target.value);
                  setError('');
                  setShowScan(false);
                }}
                inputMode="tel"
                autoComplete="tel"
                maxLength={20}
                placeholder="Phone number, e.g. 01XXXXXXXXX"
                className="field"
              />
              <label className="flex items-start gap-3 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[#d4af37]"
                />
                <span>
                  I consent to enrolling my face for AvrixCall. I understand
                  only a set of numbers describing my face (a face
                  descriptor) is stored — <strong>no photo is stored</strong>{' '}
                  — and it is used <strong>only</strong> to verify me when I
                  join AvrixCall meetings. I can ask the admin to delete my
                  enrolled face at any time.
                </span>
              </label>
              {error && !showScan && (
                <p className="text-sm text-red-400">{error}</p>
              )}
              {!showScan && (
                <button type="submit" className="btn-primary btn-block">
                  Continue to face scan
                </button>
              )}
            </form>

            {showScan && (
              <div className="mt-5">
                <FaceScan
                  mode="enroll"
                  onDescriptor={(d) => void handleDescriptor(d)}
                  onError={(m) => setError(m)}
                  onCancel={() => setShowScan(false)}
                />
                {busy && (
                  <p className="mt-3 text-sm text-muted">Saving your enrollment…</p>
                )}
                {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
              </div>
            )}
          </>
        )}

        <p className="mt-6 text-xs text-muted">
          Your number must already be registered by the admin — enrollment
          does not add new members.
        </p>
      </div>
    </div>
  );
}
