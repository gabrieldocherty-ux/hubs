// Server-generated ids: a prefix plus random [a-z0-9] characters (no modulo bias).

import crypto from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function randomId(prefix = '', length = 24) {
  let out = '';
  while (out.length < length) {
    for (const b of crypto.randomBytes(length * 2)) {
      if (b < 252) out += ALPHABET[b % 36];
      if (out.length === length) break;
    }
  }
  return prefix + out;
}

export const PRODUCT_ID_RE = /^p_[a-z0-9]{24}$/;
export const FILE_ID_RE = /^f_[a-z0-9]{24}$/;
export const BUILTIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
