// TOTP (RFC 6238 over RFC 4226 HOTP), with node:crypto only: HMAC-SHA1, 6 digits, 30-second steps,
// the shape every authenticator app (Google Authenticator, 1Password, Authy, Microsoft
// Authenticator) reads from an otpauth:// link. Plus the one-time recovery codes.
//
// Nothing here stores anything; server/auth/mfa.mjs does, and it remembers the last step used so a
// code can't be replayed.

import crypto from 'node:crypto';

export const STEP_SECONDS = 30;
export const DIGITS = 6;
/** Steps either side of now that still count (phone clocks drift): one, so a code lives 60-90 s. */
export const WINDOW = 1;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, no padding. */
export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Base32 to bytes; spaces, dashes and case are ignored. Throws on anything else. */
export function base32Decode(s) {
  const clean = String(s).toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('not base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 (the length RFC 4226 recommends for SHA-1). */
export const newSecret = () => base32Encode(crypto.randomBytes(20));

/** The HOTP value for `counter` (RFC 4226 §5.3), as a zero-padded string. */
export function hotp(secret, counter) {
  const key = Buffer.isBuffer(secret) ? secret : base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', key).update(msg).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** The time step a moment falls in. */
export const stepAt = (ms) => Math.floor(ms / 1000 / STEP_SECONDS);

/** The TOTP code at `ms` (RFC 6238). */
export const totp = (secret, ms = Date.now()) => hotp(secret, stepAt(ms));

/**
 * The step `code` matches within WINDOW of `ms`, or null. A step at or before `lastStep` never
 * matches (a code is good once). Compared in constant time.
 */
export function verifyTotp(secret, code, { ms = Date.now(), lastStep = -1 } = {}) {
  const c = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = stepAt(ms);
  let found = null;
  for (let s = now - WINDOW; s <= now + WINDOW; s++) {
    const want = Buffer.from(hotp(secret, s));
    if (crypto.timingSafeEqual(want, Buffer.from(c)) && s > lastStep && found === null) found = s;
  }
  return found;
}

/**
 * The link an authenticator app reads (Key Uri Format): otpauth://totp/<issuer>:<account>?secret=…
 * The secret is in it, so it is shown once while setting up and never stored or logged.
 */
export function otpauthUrl({ issuer = 'BluModel Studio', account, secret }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${q}`;
}

/** The secret in groups of four, for typing in by hand. */
export const groupKey = (secret) => String(secret).replace(/(.{4})/g, '$1 ').trim();

const RC = 'abcdefghjkmnpqrstuvwxyz23456789';
/** Ten one-time recovery codes like "k7mq-x3vd-9fhp" (about 70 bits each). */
export function newRecoveryCodes(n = 10) {
  return Array.from({ length: n }, () => {
    const b = crypto.randomBytes(12);
    let s = '';
    for (let i = 0; i < 12; i++) s += RC[b[i] % RC.length];
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
  });
}

/** A recovery code as stored and compared: lowercase, no spaces or dashes. */
export const normalizeRecovery = (code) => String(code ?? '').toLowerCase().replace(/[\s-]/g, '');
export const looksLikeRecovery = (code) => /^[a-z0-9]{12}$/.test(normalizeRecovery(code));
