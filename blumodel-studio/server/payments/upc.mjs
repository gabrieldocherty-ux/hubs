// UPC / EAN codes on a custom-model request (docs/PLANS_AND_CONTRACTORS.md §8).
//
// Accepted: UPC-A (12 digits), EAN-13 (13) and EAN-8 (8), typed with spaces or dashes or pasted.
// The check digit is verified (GS1: weights 3,1,3,… from the right, excluding the check digit).
// Stored normalised: digits only, and a 13-digit code that starts with 0 is the 12-digit UPC-A it
// encodes, so the same product is one code however it was typed or scanned.
// The client has the same rules in src/features/orders/upc.ts; keep the two in step.

const FORMATS = Object.freeze({ 12: 'upc_a', 13: 'ean_13', 8: 'ean_8' });

/** The GS1 check digit for `body` (every digit except the last). */
export function gs1CheckDigit(body) {
  let sum = 0;
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(body[i]) * w;
  return (10 - (sum % 10)) % 10;
}

/**
 * @param {unknown} raw what was typed, pasted or scanned
 * @returns {{ ok: true, code: string, format: 'upc_a' | 'ean_13' | 'ean_8' } | { ok: false, message: string }}
 */
export function normalizeUpc(raw) {
  if (typeof raw !== 'string') return { ok: false, message: 'Enter the UPC as the digits under the barcode.' };
  const s = raw.trim().replace(/[\s \-–.]/g, '');
  if (!s) return { ok: false, message: 'Enter the UPC as the digits under the barcode.' };
  if (!/^\d+$/.test(s)) return { ok: false, message: 'A UPC has digits only (no letters).' };
  const code = s.length === 13 && s.startsWith('0') ? s.slice(1) : s;
  const format = FORMATS[code.length];
  if (!format) {
    return { ok: false, message: `That code has ${s.length} digit${s.length === 1 ? '' : 's'}. A UPC has 12, an EAN 13 or 8.` };
  }
  if (gs1CheckDigit(code.slice(0, -1)) !== Number(code.at(-1))) {
    return { ok: false, message: 'That code doesn’t check out: a digit is probably mistyped. Compare it with the numbers under the barcode.' };
  }
  return { ok: true, code, format };
}
