// Face descriptor math — pure, server-safe (no browser / face-api
// imports). A descriptor is 128 numbers computed in the member's browser
// by @vladmandic/face-api; the server only ever compares two descriptors
// with Euclidean distance. The stored descriptor is never sent to a
// client.

/** Maximum Euclidean distance for two descriptors to count as the same face. */
export const FACE_MATCH_THRESHOLD = 0.6;

/** True when `value` is an array of exactly 128 finite numbers. */
export function isValidDescriptor(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === 128 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** Euclidean distance between two equal-length descriptor arrays. */
export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}
