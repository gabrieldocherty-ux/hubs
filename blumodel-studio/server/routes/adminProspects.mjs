// Admin > Prospects: the companies we reach out to, and the people who reached out to us, in one
// searchable place. The outreach list lives in a spreadsheet outside the repo (the repo is public);
// the owner uploads it here and every re-upload updates the same rows (matched on email, else web
// address, else company and city) without touching the stage or notes set in the panel.
//
//   GET    /api/admin/prospects ?q=&stage=&province=&sort=recent|company|fit&page=
//            -> { prospects, total, page, pageSize, counts, provinces, salesLeads, importedAt }
//            `salesLeads`: "Book a call" requests matching q (all of them, newest first, without q)
//   POST   /api/admin/prospects/import { csv }        -> { added, updated, skipped, total }
//   POST   /api/admin/prospects { company, ... }      -> { prospect } (one added by hand)
//   PATCH  /api/admin/prospects/:id { stage?, adminNotes? } -> { prospect }
//   DELETE /api/admin/prospects/:id                   -> { ok } (re-authenticated)
//   GET    /api/admin/prospects/export                -> { filename, contentType, content } (CSV)
//
// Admin-only, CSRF on every write (the router's default), rate-limited per admin, and every write
// is in the audit log with the company's name (never the whole row).

import crypto from 'node:crypto';
import { HttpError } from '../http/respond.mjs';
import { audit } from '../lib/audit.mjs';
import { parseCsv, csvCell } from '../contractors/csv.mjs';

const HOUR = 3_600_000;
const READ = { name: 'admin-prospects-read', max: 1200, windowMs: HOUR, by: 'user' };
const WRITE = { name: 'admin-prospects-write', max: 300, windowMs: HOUR, by: 'user' };
const IMPORT = { name: 'admin-prospects-import', max: 30, windowMs: HOUR, by: 'user' };
const PAGE = 100;
const MAX_ROWS = 5000;

/** Where a company stands. The first three follow the spreadsheet's Status; the rest are set here. */
export const PROSPECT_STAGES = Object.freeze(['new', 'emailed', 'bounced', 'replied', 'call', 'demo', 'won', 'lost', 'do-not-contact']);
const AUTO = new Set(['new', 'emailed', 'bounced']);
const SORTS = new Set(['recent', 'company', 'fit']);
const ID_PARAM = /^[A-Za-z0-9_-]{1,64}$/;

/** Spreadsheet column → field. Headers are matched case-insensitively, so a CRM export works too. */
const COLUMNS = {
  company: ['name', 'company', 'company name', 'business'],
  city: ['city', 'town'],
  province: ['province', 'prov', 'state', 'region'],
  type: ['type', 'segment', 'category'],
  phone: ['phone', 'telephone', 'phone number'],
  email: ['email', 'e-mail', 'email address'],
  website: ['website', 'web', 'url', 'site'],
  address: ['address'],
  contact_name: ['contact name', 'contact'],
  contact_role: ['contact role', 'role', 'title'],
  fit: ['fit', 'fit score', 'score'],
  pitch: ['pitch angle', 'pitch'],
  outreach: ['status', 'outreach'],
  notes: ['notes'],
};
const LIMITS = { company: 200, city: 120, province: 40, type: 120, phone: 60, email: 254, website: 300, address: 400, contact_name: 120, contact_role: 120, pitch: 600, outreach: 300, notes: 2000 };

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const host = (url) => {
  const s = String(url ?? '').trim().toLowerCase();
  if (!s) return '';
  try {
    return new URL(/^https?:\/\//.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** The row's identity across re-imports: its email, else its web address, else company + city. */
export function prospectKey(p) {
  const email = String(p.email ?? '').trim().toLowerCase();
  if (/^[^@\s]+@[^@\s]+$/.test(email)) return `e:${email}`;
  const h = host(p.website);
  if (h) return `w:${h}`;
  return `c:${String(p.company ?? '').trim().toLowerCase()}|${String(p.city ?? '').trim().toLowerCase()}`;
}

/** The spreadsheet's Status text → a stage and when it was emailed ("Emailed 2026-10-19 01:51 (drip)"). */
export function outreachStage(text) {
  const s = String(text ?? '').trim();
  const day = /(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
  // The outreach script writes the server's local time (Ontario), so it's read as local time.
  const at = day ? new Date(+day[1], +day[2] - 1, +day[3], +(day[4] ?? 12), +(day[5] ?? 0)).getTime() : null;
  if (/^bounced|do not retry|undeliverable/i.test(s)) return { stage: 'bounced', at };
  if (/unsubscrib|do not contact|opted out/i.test(s)) return { stage: 'do-not-contact', at };
  if (/^replied|responded/i.test(s)) return { stage: 'replied', at };
  if (/^emailed|^sent|^contacted/i.test(s)) return { stage: 'emailed', at };
  return { stage: 'new', at: null };
}

/** CSV text → prospect rows (fields as in COLUMNS), and how many rows had no company name. */
export function readProspectCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { rows: [], skipped: 0 };
  const head = rows[0].map((h) => String(h).trim().toLowerCase().replace(/\s+/g, ' '));
  const at = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]));
  if (at.company < 0) throw new HttpError(400, 'The spreadsheet needs a Name (or Company) column in its first row.', { field: 'csv' });
  if (rows.length - 1 > MAX_ROWS) throw new HttpError(400, `That’s more than ${MAX_ROWS} rows. Split it into smaller files.`, { field: 'csv' });
  const out = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const p = {};
    for (const [k, i] of Object.entries(at)) p[k] = i >= 0 ? r[i] ?? '' : '';
    for (const k of Object.keys(LIMITS)) p[k] = clean(p[k], LIMITS[k]);
    const fit = Number.parseInt(String(p.fit ?? ''), 10);
    p.fit = fit >= 1 && fit <= 5 ? fit : null;
    if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) p.email = '';
    if (!p.company) {
      skipped++;
      continue;
    }
    out.push(p);
  }
  return { rows: out, skipped };
}

const wire = (r) =>
  r && {
    id: r.id,
    company: r.company,
    city: r.city,
    province: r.province,
    type: r.type,
    phone: r.phone,
    email: r.email,
    website: r.website,
    address: r.address,
    contactName: r.contact_name,
    contactRole: r.contact_role,
    fit: r.fit,
    pitch: r.pitch,
    outreach: r.outreach,
    notes: r.notes,
    stage: r.stage,
    adminNotes: r.admin_notes,
    emailedAt: r.emailed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
const salesWire = (r) => ({ id: r.id, company: r.company, name: r.name, phone: r.phone, email: r.email, city: r.city, message: r.message, status: r.status, adminNotes: r.admin_notes, createdAt: r.created_at });

/** LIKE with the user's % and _ taken literally. */
const like = (q) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** @param {any} ctx */
export default function routes(ctx) {
  const { db } = ctx;
  const get = (id) => db.prepare('SELECT * FROM prospects WHERE id = ?').get(id);
  const must = (id) => {
    const r = get(id);
    if (!r) throw new HttpError(404, 'That company is not on the list.');
    return r;
  };
  const record = (rc, action, detail) => audit(db, { admin: rc.user, action, detail, at: ctx.now() });

  /** Adds or updates one row from the spreadsheet; the stage moves only while it's still automatic. */
  const upsert = (p, t) => {
    const key = prospectKey(p);
    const cur = db.prepare('SELECT * FROM prospects WHERE key = ?').get(key);
    const o = outreachStage(p.outreach);
    if (!cur) {
      db.prepare(
        `INSERT INTO prospects (id, key, company, city, province, type, phone, email, website, address, contact_name, contact_role, fit, pitch, outreach, notes, stage, admin_notes, emailed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`,
      ).run(`pr_${crypto.randomBytes(12).toString('base64url')}`, key, p.company, p.city, p.province, p.type, p.phone, p.email, p.website, p.address, p.contact_name, p.contact_role, p.fit, p.pitch, p.outreach, p.notes, o.stage, o.at, t, t);
      return 'added';
    }
    // A blank cell keeps what we had: an older export shouldn't wipe a phone number.
    const keep = (k) => (p[k] === '' || p[k] === null ? cur[k] : p[k]);
    const stage = AUTO.has(cur.stage) && (o.stage !== 'new' || cur.stage === 'new') ? o.stage : cur.stage;
    const emailedAt = o.at ?? cur.emailed_at;
    const fields = ['company', 'city', 'province', 'type', 'phone', 'email', 'website', 'address', 'contact_name', 'contact_role', 'fit', 'pitch', 'outreach', 'notes'];
    const same = fields.every((k) => keep(k) === cur[k]) && stage === cur.stage && emailedAt === cur.emailed_at;
    if (same) return 'same';
    db.prepare(
      `UPDATE prospects SET company = ?, city = ?, province = ?, type = ?, phone = ?, email = ?, website = ?, address = ?, contact_name = ?, contact_role = ?, fit = ?, pitch = ?, outreach = ?, notes = ?, stage = ?, emailed_at = ?, updated_at = ? WHERE id = ?`,
    ).run(...fields.map(keep), stage, emailedAt, t, cur.id);
    return 'updated';
  };

  return [
    {
      method: 'GET',
      path: '/api/admin/prospects',
      auth: 'admin',
      rateLimit: READ,
      handler: (rc) => {
        const q = clean(rc.query.get('q'), 120);
        const stage = rc.query.get('stage') || '';
        const province = clean(rc.query.get('province'), 40);
        const sort = rc.query.get('sort') || 'recent';
        const page = Math.max(1, Math.min(1000, Number.parseInt(rc.query.get('page') || '1', 10) || 1));
        if (stage && !PROSPECT_STAGES.includes(stage)) throw new HttpError(400, `Stage is one of ${PROSPECT_STAGES.join(', ')}.`);
        if (!SORTS.has(sort)) throw new HttpError(400, 'Sort is recent, company or fit.');

        const where = [];
        const args = [];
        if (q) {
          where.push(
            `(company LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\' OR province LIKE ? ESCAPE '\\' OR type LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR website LIKE ? ESCAPE '\\' OR contact_name LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' OR admin_notes LIKE ? ESCAPE '\\' OR outreach LIKE ? ESCAPE '\\')`,
          );
          args.push(...Array(11).fill(like(q)));
        }
        if (province) {
          where.push('province = ?');
          args.push(province);
        }
        // Counts per stage follow the search and province, so the chips say what's in the result.
        const base = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const counts = Object.fromEntries(PROSPECT_STAGES.map((s) => [s, 0]));
        let all = 0;
        for (const r of db.prepare(`SELECT stage, COUNT(*) AS n FROM prospects ${base} GROUP BY stage`).all(...args)) {
          counts[r.stage] = r.n;
          all += r.n;
        }
        if (stage) {
          where.push('stage = ?');
          args.push(stage);
        }
        const filtered = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const order = sort === 'company' ? 'company COLLATE NOCASE, city' : sort === 'fit' ? 'COALESCE(fit, 0) DESC, company COLLATE NOCASE' : 'COALESCE(emailed_at, 0) DESC, updated_at DESC, company COLLATE NOCASE';
        const total = db.prepare(`SELECT COUNT(*) AS n FROM prospects ${filtered}`).get(...args).n;
        const rows = db.prepare(`SELECT * FROM prospects ${filtered} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, PAGE, (page - 1) * PAGE);
        const provinces = db.prepare("SELECT province, COUNT(*) AS n FROM prospects WHERE province <> '' GROUP BY province ORDER BY n DESC").all();
        const leads = q
          ? db
              .prepare(
                `SELECT * FROM sales_leads WHERE company LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\' OR admin_notes LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 50`,
              )
              .all(...Array(7).fill(like(q)))
          : db.prepare('SELECT * FROM sales_leads ORDER BY created_at DESC LIMIT 50').all();
        const importedAt = db.prepare("SELECT MAX(at) AS at FROM admin_audit WHERE action = 'prospects_import'").get()?.at ?? null;
        return { prospects: rows.map(wire), total, page, pageSize: PAGE, counts: { ...counts, total: all }, provinces, salesLeads: leads.map(salesWire), importedAt };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/prospects/import',
      auth: 'admin',
      rateLimit: IMPORT,
      maxBytes: 4_000_000,
      handler: (rc) => {
        const csv = rc.body?.csv;
        if (typeof csv !== 'string' || !csv.trim()) throw new HttpError(400, 'Choose a .csv file to upload.', { field: 'csv' });
        const { rows, skipped } = readProspectCsv(csv);
        const t = ctx.now();
        const tally = { added: 0, updated: 0, same: 0 };
        ctx.tx(() => {
          for (const p of rows) tally[upsert(p, t)]++;
          record(rc, 'prospects_import', { rows: rows.length, added: tally.added, updated: tally.updated, skipped });
        });
        return { added: tally.added, updated: tally.updated, unchanged: tally.same, skipped, total: db.prepare('SELECT COUNT(*) AS n FROM prospects').get().n };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/prospects',
      auth: 'admin',
      rateLimit: WRITE,
      maxBytes: 16_384,
      handler: (rc) => {
        const b = rc.body ?? {};
        const p = {};
        for (const k of Object.keys(LIMITS)) p[k] = clean(b[k === 'contact_name' ? 'contactName' : k === 'contact_role' ? 'contactRole' : k], LIMITS[k]);
        const fit = Number(b.fit);
        p.fit = Number.isInteger(fit) && fit >= 1 && fit <= 5 ? fit : null;
        if (!p.company) throw new HttpError(400, 'Give the company’s name.', { field: 'company' });
        if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) throw new HttpError(400, 'That email address doesn’t look right.', { field: 'email' });
        if (db.prepare('SELECT 1 FROM prospects WHERE key = ?').get(prospectKey(p))) throw new HttpError(409, `${p.company} is already on the list (same email, web address or name and city).`, { code: 'exists' });
        const t = ctx.now();
        let id;
        ctx.tx(() => {
          upsert(p, t);
          id = db.prepare('SELECT id FROM prospects WHERE key = ?').get(prospectKey(p)).id;
          record(rc, 'prospect_add', { prospectId: id, company: p.company });
        });
        rc.send(201, { prospect: wire(get(id)) });
      },
    },
    {
      method: 'PATCH',
      path: '/api/admin/prospects/:id',
      auth: 'admin',
      rateLimit: WRITE,
      params: { id: ID_PARAM },
      maxBytes: 8_192,
      handler: (rc) => {
        const cur = must(rc.params.id);
        const b = rc.body ?? {};
        let stage = cur.stage;
        if (b.stage !== undefined) {
          if (!PROSPECT_STAGES.includes(b.stage)) throw new HttpError(400, `Stage is one of ${PROSPECT_STAGES.join(', ')}.`, { field: 'stage' });
          stage = b.stage;
        }
        let notes = cur.admin_notes;
        if (b.adminNotes !== undefined) {
          if (typeof b.adminNotes !== 'string' || b.adminNotes.length > 4000) throw new HttpError(400, 'Keep the notes to 4000 characters.', { field: 'adminNotes' });
          notes = b.adminNotes.trim();
        }
        ctx.tx(() => {
          db.prepare('UPDATE prospects SET stage = ?, admin_notes = ?, updated_at = ? WHERE id = ?').run(stage, notes, ctx.now(), cur.id);
          record(rc, 'prospect_update', { prospectId: cur.id, company: cur.company, from: cur.stage, to: stage });
        });
        return { prospect: wire(get(cur.id)) };
      },
    },
    {
      method: 'DELETE',
      path: '/api/admin/prospects/:id',
      auth: 'admin',
      reauth: true,
      rateLimit: WRITE,
      params: { id: ID_PARAM },
      handler: (rc) => {
        const cur = must(rc.params.id);
        ctx.tx(() => {
          db.prepare('DELETE FROM prospects WHERE id = ?').run(cur.id);
          record(rc, 'prospect_delete', { prospectId: cur.id, company: cur.company });
        });
        return { ok: true };
      },
    },
    {
      method: 'GET',
      path: '/api/admin/prospects/export',
      auth: 'admin',
      rateLimit: READ,
      handler: (rc) => {
        const head = ['Name', 'City', 'Province', 'Type', 'Phone', 'Website', 'Address', 'Contact name', 'Contact role', 'Email', 'Fit', 'Pitch angle', 'Status', 'Notes', 'Stage', 'Our notes', 'Emailed'];
        const lines = [head];
        for (const r of db.prepare('SELECT * FROM prospects ORDER BY province, city, company COLLATE NOCASE').all()) {
          lines.push([r.company, r.city, r.province, r.type, r.phone, r.website, r.address, r.contact_name, r.contact_role, r.email, r.fit ?? '', r.pitch, r.outreach, r.notes, r.stage, r.admin_notes, r.emailed_at ? new Date(r.emailed_at).toISOString().slice(0, 10) : '']);
        }
        record(rc, 'prospects_export', { rows: lines.length - 1 });
        const day = new Date(ctx.now()).toISOString().slice(0, 10);
        return { filename: `blumodel-prospects-${day}.csv`, contentType: 'text/csv', content: lines.map((r) => r.map(csvCell).join(',')).join('\n') };
      },
    },
  ];
}
