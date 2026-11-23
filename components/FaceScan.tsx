'use client';

import { useEffect, useRef, useState } from 'react';

// Browser-only face scan (MVP). Face detection + the 128-number face
// descriptor are computed entirely in the member's browser with
// @vladmandic/face-api — no photo or video ever leaves the device; only
// the descriptor numbers are handed to onDescriptor.
//
// Basic MVP liveness: step 1 captures the face looking straight, step 2
// asks for a slight head turn and requires a measurable landmark shift
// (nose position relative to the eye midpoint) within ~10 seconds.
// This stops a static photo held still, but it is NOT strong
// anti-spoofing — see README "Face verification (MVP)".

const MODEL_URL =
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
// How far the nose offset (normalised by the eye distance) must move
// from the straight-on baseline to count as a real head turn.
const TURN_SHIFT = 0.22;
const TURN_TIMEOUT_MS = 10_000;
const POLL_MS = 300;

type FaceApi = typeof import('@vladmandic/face-api');

let modelsPromise: Promise<FaceApi> | null = null;
function loadFaceApi(): Promise<FaceApi> {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      return faceapi;
    })();
    // If loading fails, allow a later retry instead of caching failure.
    modelsPromise.catch(() => {
      modelsPromise = null;
    });
  }
  return modelsPromise;
}

interface Detection {
  descriptor: number[];
  /** Nose x-offset from the eye midpoint, normalised by eye distance. */
  noseOffset: number;
}

function averagePoint(points: { x: number; y: number }[]): { x: number; y: number } {
  const sum = points.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

async function detectOnce(
  faceapi: FaceApi,
  video: HTMLVideoElement,
): Promise<Detection | null> {
  const result = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!result) return null;
  const leftEye = averagePoint(result.landmarks.getLeftEye());
  const rightEye = averagePoint(result.landmarks.getRightEye());
  const nose = averagePoint(result.landmarks.getNose());
  const eyeMidX = (leftEye.x + rightEye.x) / 2;
  const eyeDistance = Math.max(
    Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y),
    1,
  );
  return {
    descriptor: Array.from(result.descriptor),
    noseOffset: (nose.x - eyeMidX) / eyeDistance,
  };
}

type Phase = 'idle' | 'loading' | 'straight' | 'turn' | 'done' | 'error';

export interface FaceScanProps {
  mode: 'enroll' | 'verify';
  onDescriptor: (descriptor: number[]) => void;
  onError?: (message: string) => void;
  onCancel?: () => void;
}

export default function FaceScan({
  mode,
  onDescriptor,
  onError,
  onCancel,
}: FaceScanProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runRef = useRef(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  // Stop the camera when the component goes away.
  useEffect(() => {
    const runAtMount = runRef.current;
    return () => {
      runRef.current = runAtMount + 1;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  function fail(message: string) {
    runRef.current += 1;
    stopCamera();
    setPhase('error');
    setError(message);
    onError?.(message);
  }

  function cancel() {
    runRef.current += 1;
    stopCamera();
    setPhase('idle');
    setStatus('');
    setError('');
    onCancel?.();
  }

  async function start() {
    const run = runRef.current + 1;
    runRef.current = run;
    const alive = () => runRef.current === run;
    setError('');
    setPhase('loading');
    setStatus('Loading the face models — this can take a few seconds…');

    let faceapi: FaceApi;
    try {
      faceapi = await loadFaceApi();
    } catch {
      if (alive()) {
        fail('Could not load the face models. Check your connection and try again.');
      }
      return;
    }
    if (!alive()) return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
    } catch {
      if (alive()) {
        fail(
          'Camera access was denied or no camera was found. Allow camera access for this site and try again.',
        );
      }
      return;
    }
    if (!alive()) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // Autoplay quirks — the polling below still works once frames flow.
    }

    // Step 1 — look straight.
    setPhase('straight');
    setStatus('Look straight at the camera…');
    let first: Detection | null = null;
    const straightDeadline = Date.now() + 20_000;
    while (alive() && !first) {
      if (Date.now() > straightDeadline) {
        fail('No face was detected. Move to good light, face the camera, and try again.');
        return;
      }
      first = await detectOnce(faceapi, video).catch(() => null);
      if (!first) {
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    }
    if (!alive() || !first) return;

    // Step 2 — turn the head slightly; require a real landmark shift.
    setPhase('turn');
    setStatus('Now slowly turn your head a little to one side…');
    const baseline = first.noseOffset;
    const firstDescriptor = first.descriptor;
    const turnDeadline = Date.now() + TURN_TIMEOUT_MS;
    let second: Detection | null = null;
    while (alive() && !second) {
      if (Date.now() > turnDeadline) {
        fail(
          'We could not see your head turn — this check needs a live face, not a still photo. Try again and turn your head slowly.',
        );
        return;
      }
      const det = await detectOnce(faceapi, video).catch(() => null);
      if (det && Math.abs(det.noseOffset - baseline) >= TURN_SHIFT) {
        second = det;
      } else {
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    }
    if (!alive() || !second) return;

    // Average the straight and turned descriptors for a steadier match.
    const averaged = firstDescriptor.map(
      (v, i) => (v + second.descriptor[i]) / 2,
    );
    stopCamera();
    setPhase('done');
    setStatus(
      mode === 'enroll'
        ? 'Face captured — saving your enrollment…'
        : 'Face captured — checking your match…',
    );
    onDescriptor(averaged);
  }

  return (
    <div className="card p-5">
      <p className="text-sm font-semibold text-cream">
        {mode === 'enroll' ? 'Face scan — enrollment' : 'Face scan — verify it is you'}
      </p>
      <p className="mt-1 text-sm text-muted">
        The scan runs on this device. No photo is uploaded — only a set of
        numbers describing your face.
      </p>

      <div className="mt-4 overflow-hidden rounded-xl border border-line bg-black">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="aspect-[4/3] w-full object-cover"
        />
      </div>

      {status && phase !== 'error' && (
        <p className="mt-3 text-sm text-goldlight" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {phase === 'idle' || phase === 'error' ? (
          <button
            type="button"
            onClick={() => void start()}
            className="btn-primary btn-sm"
          >
            {phase === 'error' ? 'Retry scan' : 'Start face scan'}
          </button>
        ) : phase === 'done' ? (
          <span className="pill pill-green">Face captured</span>
        ) : (
          <span className="pill pill-gold">
            {phase === 'loading'
              ? 'Loading models…'
              : phase === 'straight'
                ? 'Step 1 of 2 — look straight'
                : 'Step 2 of 2 — turn your head'}
          </span>
        )}
        {phase !== 'idle' && phase !== 'done' && (
          <button type="button" onClick={cancel} className="btn-ghost btn-sm">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
