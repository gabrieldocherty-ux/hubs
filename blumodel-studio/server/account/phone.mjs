// Phone numbers, normalised one way everywhere they are typed (Account settings > Profile, the
// contractor company): North American numbers need their area code and are written
// "(905) 555-0142"; anything else must start with + and its country code and is kept as
// "+<digits>". An extension ("x12", "ext. 12") is kept after the number. The client has the same
// rules (src/lib/phone.ts) so a person sees the problem before saving.

const EXT_RE = /\s*(?:;?ext\.?|extension|x|#)\s*(\d{1,6})\s*$/i;

/**
 * `{ ok: true, value }` with the normalised number, or `{ ok: false, reason }` with a sentence for
 * the person. An empty input is `{ ok: true, value: '' }`: callers decide whether one is required.
 * @param {unknown} raw
 */
export function normalizePhone(raw) {
  let s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { ok: true, value: '' };
  if (s.length > 40) return { ok: false, reason: 'That phone number is too long.' };
  let ext = '';
  const m = s.match(EXT_RE);
  if (m && /\d/.test(s.slice(0, m.index))) {
    ext = m[1];
    s = s.slice(0, m.index);
  }
  if (!/^\+?[0-9().\-\s/]+$/.test(s)) return { ok: false, reason: 'Use only digits, spaces and + ( ) - in a phone number.' };
  const plus = s.startsWith('+');
  let digits = s.replace(/\D/g, '');
  const tail = ext ? ` ext. ${ext}` : '';
  if (plus && !digits.startsWith('1')) {
    if (digits.length < 8 || digits.length > 15) return { ok: false, reason: 'An international number needs its country code and 8 to 15 digits, e.g. +44 20 7946 0958.' };
    return { ok: true, value: `+${digits}${tail}` };
  }
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return { ok: false, reason: 'Include the area code, e.g. (905) 555-0142.' };
  if (!/^[2-9]\d{2}[2-9]/.test(digits)) return { ok: false, reason: 'That phone number doesn’t look right. Check the area code.' };
  return { ok: true, value: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}${tail}` };
}
