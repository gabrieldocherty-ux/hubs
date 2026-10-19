// Encrypted files for everything that may leave this machine: the off-site backups
// (server/ops/offsite.mjs) and the export / move-data bundles (server/ops/dataBundle.mjs). Only
// node:crypto, nothing else.
//
// The key: scrypt(BACKUP_PASSPHRASE, a random 16-byte salt per file) -> 32 bytes. The cipher:
// AES-256-GCM in sealed chunks (the "STREAM" construction), so a file of any size is written and
// read without holding it in memory, and a file cut short, reordered or edited anywhere fails:
//
//   "BMENC" 0x00 0x01 0x00        8 bytes: magic and format version 1
//   uint32 BE  n                  length of the public header
//   n bytes    public header      JSON: { kdf: { name: 'scrypt', N, r, p, salt }, nonce, chunk }
//   record*                       uint32 BE length, ciphertext, 16-byte GCM tag
//
// Record 0 is the sealed header: JSON the writer was given (what the file holds, when it was
// made). Checking it is how a passphrase and a copy are verified without reading the whole file.
// Then the data records, each at most `chunk` bytes; the last carries a "final" flag, so a file
// cut off at a record boundary is refused too. Every record's nonce is the file's random 8-byte
// prefix plus its uint32 counter; its additional data is sha256(magic, length, public header),
// its kind (header or data) and the final flag. Nothing secret is in the public header: the
// salt and nonce prefix are random, and the scrypt settings are the standard ones.
//
// Lose the passphrase and these files can never be opened. Nobody can recover it.

import crypto from 'node:crypto';
import fs from 'node:fs';

export const MAGIC = Buffer.from([0x42, 0x4d, 0x45, 0x4e, 0x43, 0x00, 0x01, 0x00]); // "BMENC" 0 1 0
export const ENC_EXT = '.enc';
export const MIN_PASSPHRASE = 12;
const TAG = 16;
const DEFAULT_CHUNK = 1024 * 1024;
const MAX_CHUNK = 16 * 1024 * 1024;
const MAX_PUBLIC_HEADER = 4096;
const MAX_SEALED_HEADER = 1024 * 1024;
/** scrypt N=2^15, r=8, p=1: about 32 MB and a tenth of a second per file; brute force pays the same per guess. */
export const KDF = Object.freeze({ N: 1 << 15, r: 8, p: 1 });

export class CryptError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const wrong = () => new CryptError('The passphrase is wrong, or the file is damaged (its first record does not decrypt).', 'bad_passphrase');
const damaged = (what) => new CryptError(`The encrypted file is damaged or was edited (${what}). Use another copy.`, 'damaged');

/** Null when `p` is usable as BACKUP_PASSPHRASE, else what's wrong (never the value). */
export function passphraseProblem(p) {
  if (typeof p !== 'string' || !p) return 'BACKUP_PASSPHRASE is not set';
  if (p.trim() !== p) return 'BACKUP_PASSPHRASE starts or ends with a space';
  if ([...p].length < MIN_PASSPHRASE) return `BACKUP_PASSPHRASE is shorter than ${MIN_PASSPHRASE} characters`;
  return null;
}

/** The 32-byte key for `passphrase` and `salt`. */
export function deriveKey(passphrase, salt, { N, r, p } = KDF) {
  if (passphraseProblem(passphrase)) throw new CryptError(`${passphraseProblem(passphrase)}.`, 'no_passphrase');
  return crypto.scryptSync(Buffer.from(passphrase.normalize('NFC'), 'utf8'), salt, 32, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 });
}

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const nonceOf = (prefix, counter) => Buffer.concat([prefix, u32(counter)]);
const aadOf = (base, kind, final) => Buffer.concat([base, Buffer.from([kind, final ? 1 : 0])]);
const HEADER_KIND = 1;
const DATA_KIND = 2;

/** True when the file starts with the magic bytes (an encrypted file of this format). */
export function isEncryptedFile(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const b = Buffer.alloc(MAGIC.length);
      return fs.readSync(fd, b, 0, b.length, 0) === b.length && b.equals(MAGIC);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/**
 * Writes an encrypted file, synchronously, a chunk at a time: `write(buf)` as often as needed, then
 * `close()`. The file is created new (never over an existing one), 0600 on Linux. `abort()` closes
 * and deletes it. `close()` returns `{ bytes, plainBytes, plainSha256 }`.
 */
export class EncryptWriter {
  /**
   * @param {string} file
   * @param {{ passphrase: string, header?: Record<string, any>, chunk?: number, kdf?: { N: number, r: number, p: number } }} o
   */
  constructor(file, { passphrase, header = {}, chunk = DEFAULT_CHUNK, kdf = KDF }) {
    const salt = crypto.randomBytes(16);
    this.prefix = crypto.randomBytes(8);
    this.key = deriveKey(passphrase, salt, kdf);
    this.chunk = chunk;
    const pub = Buffer.from(JSON.stringify({ kdf: { name: 'scrypt', N: kdf.N, r: kdf.r, p: kdf.p, salt: salt.toString('base64') }, nonce: this.prefix.toString('base64'), chunk }));
    const lead = Buffer.concat([MAGIC, u32(pub.length), pub]);
    this.base = crypto.createHash('sha256').update(lead).digest();
    this.file = file;
    this.fd = fs.openSync(file, 'wx', 0o600);
    this.counter = 0;
    this.pending = [];
    this.pendingBytes = 0;
    this.bytes = 0;
    this.plainBytes = 0;
    this.hash = crypto.createHash('sha256');
    this.out(lead);
    this.seal(Buffer.from(JSON.stringify(header)), HEADER_KIND, false);
  }
  out(buf) {
    fs.writeSync(this.fd, buf);
    this.bytes += buf.length;
  }
  seal(plain, kind, final) {
    const c = crypto.createCipheriv('aes-256-gcm', this.key, nonceOf(this.prefix, this.counter++));
    c.setAAD(aadOf(this.base, kind, final));
    const body = Buffer.concat([c.update(plain), c.final()]);
    this.out(Buffer.concat([u32(body.length), body, c.getAuthTag()]));
  }
  /** @param {Buffer | Uint8Array} buf */
  write(buf) {
    if (!buf.length) return;
    this.hash.update(buf);
    this.plainBytes += buf.length;
    this.pending.push(Buffer.from(buf));
    this.pendingBytes += buf.length;
    while (this.pendingBytes > this.chunk) {
      const all = Buffer.concat(this.pending);
      this.seal(all.subarray(0, this.chunk), DATA_KIND, false);
      const rest = all.subarray(this.chunk);
      this.pending = [rest];
      this.pendingBytes = rest.length;
    }
  }
  close() {
    this.seal(Buffer.concat(this.pending), DATA_KIND, true);
    this.pending = [];
    fs.fsyncSync(this.fd);
    fs.closeSync(this.fd);
    this.fd = null;
    this.key.fill(0);
    return { bytes: this.bytes, plainBytes: this.plainBytes, plainSha256: this.hash.digest('hex') };
  }
  abort() {
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd);
      } catch {
        /* closed */
      }
      this.fd = null;
    }
    fs.rmSync(this.file, { force: true });
  }
}

/** Reads exactly `n` bytes at `pos` (fewer only at the end of the file). */
function readAt(fd, pos, n) {
  const b = Buffer.alloc(n);
  let got = 0;
  while (got < n) {
    const k = fs.readSync(fd, b, got, n - got, pos + got);
    if (k <= 0) break;
    got += k;
  }
  return got === n ? b : b.subarray(0, got);
}

/** Opens an encrypted file: its public header, the key, and a reader for its records. */
function openEncrypted(fd, passphrase) {
  const size = fs.fstatSync(fd).size;
  const head = readAt(fd, 0, MAGIC.length + 4);
  if (head.length < MAGIC.length + 4 || !head.subarray(0, MAGIC.length).equals(MAGIC)) throw new CryptError('This is not an encrypted BluModel Studio file (no BMENC header).', 'not_encrypted');
  const n = head.readUInt32BE(MAGIC.length);
  if (n < 2 || n > MAX_PUBLIC_HEADER) throw damaged('its header length');
  const pubBuf = readAt(fd, MAGIC.length + 4, n);
  if (pubBuf.length !== n) throw damaged('it ends inside its header');
  let pub;
  try {
    pub = JSON.parse(pubBuf.toString('utf8'));
  } catch {
    throw damaged('its header is not JSON');
  }
  const k = pub?.kdf;
  const okInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (k?.name !== 'scrypt' || !okInt(k.N, 2, 1 << 20) || (k.N & (k.N - 1)) !== 0 || !okInt(k.r, 1, 32) || !okInt(k.p, 1, 16) || !okInt(pub.chunk, 1, MAX_CHUNK)) throw damaged('its key settings');
  const salt = Buffer.from(String(k.salt ?? ''), 'base64');
  const prefix = Buffer.from(String(pub.nonce ?? ''), 'base64');
  if (salt.length !== 16 || prefix.length !== 8) throw damaged('its salt or nonce');
  const lead = Buffer.concat([head, pubBuf]);
  const base = crypto.createHash('sha256').update(lead).digest();
  const key = deriveKey(passphrase, salt, k);
  let pos = lead.length;
  let counter = 0;
  /** The next record, decrypted, or throws `fail()` when it doesn't authenticate. */
  const next = (kind, final, max, fail) => {
    const lenBuf = readAt(fd, pos, 4);
    if (lenBuf.length < 4) return null;
    const len = lenBuf.readUInt32BE(0);
    if (len > max || pos + 4 + len + TAG > size) throw fail();
    const body = readAt(fd, pos + 4, len + TAG);
    const d = crypto.createDecipheriv('aes-256-gcm', key, nonceOf(prefix, counter));
    d.setAAD(aadOf(base, kind, final));
    d.setAuthTag(body.subarray(len));
    let plain;
    try {
      plain = Buffer.concat([d.update(body.subarray(0, len)), d.final()]);
    } catch {
      return { ok: false };
    }
    pos += 4 + len + TAG;
    counter++;
    return { ok: true, plain };
  };
  return { size, pub, key, next, at: () => pos };
}

/**
 * Checks the passphrase and the start of the file by decrypting its sealed header, without reading
 * the rest. Returns `{ header, public: { kdf, chunk } }`. Throws CryptError ('bad_passphrase',
 * 'not_encrypted', 'damaged').
 */
export function readEncryptedHeader(file, passphrase) {
  const fd = fs.openSync(file, 'r');
  try {
    const e = openEncrypted(fd, passphrase);
    try {
      const r = e.next(HEADER_KIND, false, MAX_SEALED_HEADER, () => damaged('its first record'));
      if (!r) throw damaged('it ends before its first record');
      if (!r.ok) throw wrong();
      return { header: JSON.parse(r.plain.toString('utf8')), public: { kdf: { ...e.pub.kdf, salt: undefined }, chunk: e.pub.chunk } };
    } finally {
      e.key.fill(0);
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Decrypts the whole file, calling `onData(buf)` with each chunk in order, and checks every record
 * and that the file ends where it should. Returns `{ header, plainBytes, plainSha256 }`. On any
 * failure it throws after `onData` may already have seen part of the data: callers that write it
 * somewhere delete that on a throw (decryptToFile does).
 * @param {string} file
 * @param {string} passphrase
 * @param {(buf: Buffer) => void} [onData]
 */
export function decryptFile(file, passphrase, onData = () => {}) {
  const fd = fs.openSync(file, 'r');
  try {
    const e = openEncrypted(fd, passphrase);
    try {
      const h = e.next(HEADER_KIND, false, MAX_SEALED_HEADER, () => damaged('its first record'));
      if (!h) throw damaged('it ends before its first record');
      if (!h.ok) throw wrong();
      const header = JSON.parse(h.plain.toString('utf8'));
      const hash = crypto.createHash('sha256');
      let plainBytes = 0;
      for (;;) {
        const fail = () => damaged(`record ${plainBytes ? 'after byte ' + plainBytes : 1}`);
        // A record is a middle one or the final one: try middle, then final (a failed try doesn't
        // move on, so the second reads the same bytes).
        let r = e.next(DATA_KIND, false, e.pub.chunk, fail);
        if (!r) throw damaged('it was cut short: the last record is missing');
        let final = false;
        if (!r.ok) {
          r = e.next(DATA_KIND, true, e.pub.chunk, fail);
          if (!r?.ok) throw fail();
          final = true;
        }
        hash.update(r.plain);
        plainBytes += r.plain.length;
        if (r.plain.length) onData(r.plain);
        if (final) break;
      }
      if (e.at() !== e.size) throw damaged('there is data after its last record');
      return { header, plainBytes, plainSha256: hash.digest('hex') };
    } finally {
      e.key.fill(0);
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** Decrypts `file` to `dest` (created new, 0600). Deletes `dest` if anything fails. */
export function decryptToFile(file, dest, passphrase) {
  const out = fs.openSync(dest, 'wx', 0o600);
  try {
    const r = decryptFile(file, passphrase, (b) => fs.writeSync(out, b));
    fs.fsyncSync(out);
    fs.closeSync(out);
    return r;
  } catch (err) {
    try {
      fs.closeSync(out);
    } catch {
      /* closed */
    }
    fs.rmSync(dest, { force: true });
    throw err;
  }
}

/** Encrypts `src` into `dest` (created new). Returns the writer's totals. */
export function encryptFile(src, dest, { passphrase, header = {}, chunk, kdf } = /** @type {any} */ ({})) {
  const w = new EncryptWriter(dest, { passphrase, header, chunk, kdf });
  try {
    const fd = fs.openSync(src, 'r');
    try {
      const buf = Buffer.allocUnsafe(DEFAULT_CHUNK);
      let n;
      while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) w.write(buf.subarray(0, n));
    } finally {
      fs.closeSync(fd);
    }
    return w.close();
  } catch (err) {
    w.abort();
    throw err;
  }
}
