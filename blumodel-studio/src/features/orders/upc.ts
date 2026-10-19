/**
 * UPC / EAN codes on a custom-model request: the same rules as server/payments/upc.mjs (the
 * server checks again; this only gives the answer while typing). Accepts UPC-A (12 digits),
 * EAN-13 (13) and EAN-8 (8), with spaces or dashes; verifies the GS1 check digit; normalises to
 * digits only, a 13-digit code starting with 0 becoming the 12-digit UPC-A it encodes.
 */

export type UpcFormat = 'upc_a' | 'ean_13' | 'ean_8';
export type UpcResult = { ok: true; code: string; format: UpcFormat } | { ok: false; message: string };

const FORMATS: Record<number, UpcFormat> = { 12: 'upc_a', 13: 'ean_13', 8: 'ean_8' };

export const UPC_FORMAT_LABEL: Record<UpcFormat, string> = { upc_a: 'UPC-A', ean_13: 'EAN-13', ean_8: 'EAN-8' };

/** The GS1 check digit for `body` (every digit except the last). */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(body[i]) * w;
  return (10 - (sum % 10)) % 10;
}

export function normalizeUpc(raw: unknown): UpcResult {
  if (typeof raw !== 'string') return { ok: false, message: 'Enter the UPC as the digits under the barcode.' };
  const s = raw.trim().replace(/[\s \-–.]/g, '');
  if (!s) return { ok: false, message: 'Enter the UPC as the digits under the barcode.' };
  if (!/^\d+$/.test(s)) return { ok: false, message: 'A UPC has digits only (no letters).' };
  const code = s.length === 13 && s.startsWith('0') ? s.slice(1) : s;
  const format = FORMATS[code.length];
  if (!format) return { ok: false, message: `That code has ${s.length} digit${s.length === 1 ? '' : 's'}. A UPC has 12, an EAN 13 or 8.` };
  if (gs1CheckDigit(code.slice(0, -1)) !== Number(code[code.length - 1])) {
    return { ok: false, message: 'That code doesn’t check out: a digit is probably mistyped. Compare it with the numbers under the barcode.' };
  }
  return { ok: true, code, format };
}

/**
 * While the buyer is still typing: null when there is nothing to say yet (empty, or a run of
 * digits shorter than any code), otherwise the result. Saves telling someone "4 digits" mid-entry.
 */
export function upcWhileTyping(raw: string): UpcResult | null {
  const digits = raw.replace(/[\s \-–.]/g, '');
  if (!digits) return null;
  if (/^\d+$/.test(digits) && digits.length < 8) return null;
  return normalizeUpc(raw);
}

/** 036000291452 → "0 36000 29145 2" (UPC-A), EAN-13 → "4 006381 333931", EAN-8 → "9638 5074". */
export function formatUpc(code: string): string {
  if (code.length === 12) return `${code[0]} ${code.slice(1, 6)} ${code.slice(6, 11)} ${code[11]}`;
  if (code.length === 13) return `${code[0]} ${code.slice(1, 7)} ${code.slice(7)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}

/** The barcode formats a scan should look for (BarcodeDetector names). */
export const SCAN_FORMATS = ['upc_a', 'ean_13', 'ean_8', 'upc_e'] as const;

/**
 * A zero-suppressed UPC-E (8 digits: number system, 6 digits, check) as the UPC-A it stands for,
 * so a small-package barcode scans to the same 12-digit code as its full-size one. Null when it
 * isn't a UPC-E.
 */
export function expandUpcE(raw: string): string | null {
  if (!/^[01]\d{7}$/.test(raw)) return null;
  const n = raw[0]!;
  const d = raw.slice(1, 7);
  const c = raw[7]!;
  const last = Number(d[5]);
  let body: string;
  if (last <= 2) body = `${d[0]}${d[1]}${d[5]}0000${d[2]}${d[3]}${d[4]}`;
  else if (last === 3) body = `${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}`;
  else if (last === 4) body = `${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}`;
  else body = `${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}0000${d[5]}`;
  return `${n}${body}${c}`;
}

/** What a scan read, as the code to put in the UPC field. */
export function scannedCode(rawValue: string, format: string): string {
  const v = rawValue.trim();
  return format === 'upc_e' ? (expandUpcE(v) ?? v) : v;
}
