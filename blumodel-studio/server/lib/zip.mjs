// A small streaming ZIP writer (PKWARE APPNOTE 6.3, no ZIP64), with node:zlib only: each entry is
// written to the stream as soon as it is added (deflated, or stored when deflating doesn't help),
// so memory holds one entry at a time, never the whole archive. Windows Explorer, macOS Archive
// Utility, `unzip` and `tar -xf` all open it. Used by Admin > Companies > Export all data.
//
//   const zip = createZipWriter(res);   // anything with write(chunk) and end(), e.g. an http response
//   await zip.add('tenant.json', Buffer.from(json));
//   await zip.add('uploads/logo.png', bytes, { store: true });
//   await zip.finish();                 // the central directory; ends the stream

import zlib from 'node:zlib';

const MAX = 0xffff_fffe;

/** MS-DOS date and time for a moment (the format ZIP stores), in UTC: the server never reads local time. */
function dosTime(ms) {
  const d = new Date(ms);
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const date = ((Math.max(1980, d.getUTCFullYear()) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

/** A safe entry name: '/' separators, no leading '/', no '..' segments, printable. */
export function zipName(name) {
  const parts = String(name)
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim())
    .filter((p) => p && p !== '.' && p !== '..');
  if (!parts.length) throw new Error('zip: an entry needs a name');
  return parts.join('/');
}

/**
 * @param {{ write: (chunk: Buffer) => boolean, end: () => void, once?: Function }} out
 * @param {{ now?: number }} [opts]
 */
export function createZipWriter(out, { now = Date.now() } = {}) {
  const central = [];
  const seen = new Set();
  let offset = 0;
  const { time, date } = dosTime(now);

  const write = (buf) =>
    new Promise((resolve) => {
      offset += buf.length;
      if (out.write(buf) !== false || !out.once) resolve();
      else out.once('drain', resolve);
    });

  return {
    /** Adds one file. `store: true` skips deflating (pictures and models are compressed already). */
    async add(name, data, { store = false } = {}) {
      let n = zipName(name);
      for (let i = 2; seen.has(n); i++) n = n.replace(/(\.[^./]*)?$/, (ext) => `-${i}${ext ?? ''}`);
      seen.add(n);
      const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
      if (raw.length > MAX || offset > MAX) throw new Error('zip: over 4 GB (ZIP64 is not supported)');
      const crc = zlib.crc32(raw) >>> 0;
      let body = raw;
      let method = 0;
      if (!store && raw.length > 64) {
        const def = zlib.deflateRawSync(raw, { level: 6 });
        if (def.length < raw.length) {
          body = def;
          method = 8;
        }
      }
      const fname = Buffer.from(n, 'utf8');
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0);
      head.writeUInt16LE(20, 4); // version needed
      head.writeUInt16LE(0x0800, 6); // UTF-8 names
      head.writeUInt16LE(method, 8);
      head.writeUInt16LE(time, 10);
      head.writeUInt16LE(date, 12);
      head.writeUInt32LE(crc, 14);
      head.writeUInt32LE(body.length, 18);
      head.writeUInt32LE(raw.length, 22);
      head.writeUInt16LE(fname.length, 26);
      head.writeUInt16LE(0, 28);
      central.push({ fname, method, crc, csize: body.length, size: raw.length, offset });
      await write(Buffer.concat([head, fname]));
      await write(body);
    },

    /** Writes the central directory and ends the stream. */
    async finish() {
      const start = offset;
      for (const e of central) {
        const c = Buffer.alloc(46);
        c.writeUInt32LE(0x02014b50, 0);
        c.writeUInt16LE(0x031e, 4); // made by: Unix, 3.0
        c.writeUInt16LE(20, 6);
        c.writeUInt16LE(0x0800, 8);
        c.writeUInt16LE(e.method, 10);
        c.writeUInt16LE(time, 12);
        c.writeUInt16LE(date, 14);
        c.writeUInt32LE(e.crc, 16);
        c.writeUInt32LE(e.csize, 20);
        c.writeUInt32LE(e.size, 24);
        c.writeUInt16LE(e.fname.length, 28);
        c.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a regular file, rw-r--r--
        c.writeUInt32LE(e.offset, 42);
        await write(Buffer.concat([c, e.fname]));
      }
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(central.length, 8);
      end.writeUInt16LE(central.length, 10);
      end.writeUInt32LE(offset - start, 12);
      end.writeUInt32LE(start, 16);
      await write(end);
      out.end();
      return { entries: central.length, bytes: offset };
    },
  };
}

/** Reads a ZIP this module wrote (tests): [{ name, data }]. Stored and deflated entries only. */
export function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(local + 26);
    const lxlen = buf.readUInt16LE(local + 28);
    const body = buf.subarray(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    if ((zlib.crc32(data) >>> 0) !== crc) throw new Error(`zip: bad CRC for ${name}`);
    out.push({ name, data });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
