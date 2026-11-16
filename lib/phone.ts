// Bangladesh mobile numbers, canonical 13-digit 880 form.
// Accepts 01XXXXXXXXX, 8801XXXXXXXXX, +8801XXXXXXXXX, 1XXXXXXXXX,
// with spaces, dashes or a leading +. Returns null when invalid.
// (No OTP in this round — the number is typed, not SMS-verified.)

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  // 8801XXXXXXXXX — already canonical.
  if (/^8801[3-9]\d{8}$/.test(digits)) return digits;
  // 01XXXXXXXXX — the usual local form.
  if (/^01[3-9]\d{8}$/.test(digits)) return `880${digits.slice(1)}`;
  // 1XXXXXXXXX — local form without the leading 0.
  if (/^1[3-9]\d{8}$/.test(digits)) return `880${digits}`;
  return null;
}
