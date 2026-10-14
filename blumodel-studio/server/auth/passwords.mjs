// Salted scrypt password hashes, computed off the event loop (crypto.scrypt runs on the
// libuv thread pool), so a login never stalls other requests. The stored format is
// unchanged from the single-file server: `scrypt$<salt hex>$<hash hex>`.

import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const MAX_PASSWORD = 200;

const scrypt = (password, salt, len) =>
  new Promise((resolve, reject) => crypto.scrypt(password, salt, len, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))));

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (!expected.length) return false;
  const actual = await scrypt(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

let dummy = null;
/**
 * A fixed hash to verify against when the email is unknown, so a miss costs the same
 * time as a wrong password and response timing doesn't reveal which accounts exist.
 */
export function dummyHash() {
  dummy ??= hashPassword(crypto.randomBytes(12).toString('hex'));
  return dummy;
}
