// Phone normalization — ONE helper, used everywhere (join route, admin
// routes, client forms). Canonical form is 13 digits starting with 880
// (Bangladesh country code, no leading + or 0).
//
//   +880 1XXX-XXXXXX / 8801XXXXXXXXX  -> 8801XXXXXXXXX (kept as-is)
//   01XXXXXXXXX (11 digits)           -> 8801XXXXXXXXX
//   1XXXXXXXXX  (10 digits)           -> 8801XXXXXXXXX
//
// Anything else returns null (not a valid Bangladeshi mobile number).
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('880')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) {
    return `880${digits.slice(1)}`;
  }
  if (digits.length === 10 && digits.startsWith('1')) {
    return `880${digits}`;
  }
  return null;
}

/** Human-friendly display of a canonical number: +880 1XXX-XXXXXX. */
export function displayPhone(canonical: string): string {
  if (canonical.length === 13 && canonical.startsWith('880')) {
    return `+880 ${canonical.slice(3, 7)}-${canonical.slice(7)}`;
  }
  return canonical;
}
