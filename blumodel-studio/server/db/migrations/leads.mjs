// Showroom leads as people (Gabe, 2026-10-17: "every blumodel subscriber that signed up will get an
// admin page that shows the people that have used the site; people that design will be required to
// give an email or phone number as well as name; this will be called leads"). Append steps; never
// edit or reorder an applied one. Ids are "leads-NNN-name".
//
//   leads-001  tenant_leads: one row per person who used a showroom (name, email and/or phone,
//              deduplicated by either within the showroom; the consent they gave and when; the
//              team's status and notes; first seen, last active). (The name `leads` was taken by
//              the old brand-page leads.)
//              tenant_lead_visitors: the browsers that gave their details ("Before you start"):
//              each holds a visitor token (stored as its SHA-256 only) and what was typed there, so
//              a second browser typing the same email joins the same lead but never sees the first
//              one's designs or details.
//              tenant_lead_events: each lead's timeline (started a design, saved, sent, came back).
//              showroom_leads (each "Send this design") gains lead_id. projects is rebuilt so a
//              design can belong to a visitor instead of an account (user_id nullable, visitor_id,
//              lead_id, and a CHECK that it has one owner or the other).
//              Every existing showroom_leads row becomes (or joins) a lead: the same email in the
//              same showroom is the same person, then the same phone. A lead made from one keeps
//              its id, so an old #/studio/leads/<id> link still opens the person.

import { rebuildTable } from './tenancy.mjs';
import { normalizePhone } from '../../account/phone.mjs';

/** The digits a phone is matched on: "(905) 555-0142" and "+1 905 555 0142" are the same number. */
export function phoneKeyOf(normalised) {
  if (!normalised) return '';
  const main = String(normalised).replace(/\s*ext\.\s*\d+$/, '');
  const digits = main.replace(/\D/g, '');
  if (!digits) return '';
  return main.startsWith('+') ? digits : `1${digits}`;
}

/** @type {{ id: string, foreignKeys?: 'off', up: (db: import('node:sqlite').DatabaseSync) => void }[]} */
export const steps = [
  {
    id: 'leads-001-people-visitors-events',
    foreignKeys: 'off',
    up(db) {
      db.exec(`
        CREATE TABLE tenant_leads (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          -- a showroom account this person also has (the older sign-up path), when known
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          email TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          phone_key TEXT NOT NULL DEFAULT '',
          consent_text TEXT NOT NULL DEFAULT '',
          consent_at INTEGER,
          source TEXT NOT NULL DEFAULT 'form' CHECK (source IN ('form','send','migrated')),
          status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','quoted','won','lost')),
          staff_notes TEXT NOT NULL DEFAULT '',
          read_at INTEGER,
          first_seen_at INTEGER NOT NULL,
          last_active_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          CHECK (email <> '' OR phone <> ''));
        CREATE UNIQUE INDEX tenant_leads_email ON tenant_leads(tenant_id, email) WHERE email <> '';
        CREATE UNIQUE INDEX tenant_leads_phone ON tenant_leads(tenant_id, phone_key) WHERE phone_key <> '';
        CREATE INDEX tenant_leads_active ON tenant_leads(tenant_id, last_active_at DESC);
        CREATE INDEX tenant_leads_user ON tenant_leads(user_id);

        CREATE TABLE tenant_lead_visitors (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          lead_id TEXT NOT NULL REFERENCES tenant_leads(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          -- the showroom account signed in on this browser when it was linked, if any
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          email TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          consent_text TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL);
        CREATE INDEX tenant_lead_visitors_lead ON tenant_lead_visitors(lead_id);
        CREATE INDEX tenant_lead_visitors_user ON tenant_lead_visitors(tenant_id, user_id);

        CREATE TABLE tenant_lead_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          lead_id TEXT NOT NULL REFERENCES tenant_leads(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('captured','returned','started','saved','sent','status','account')),
          -- no foreign key: the timeline keeps "started a design" after the design is deleted
          project_id TEXT,
          detail TEXT NOT NULL DEFAULT '{}',
          at INTEGER NOT NULL);
        CREATE INDEX tenant_lead_events_lead ON tenant_lead_events(lead_id, at DESC);

        ALTER TABLE showroom_leads ADD COLUMN lead_id TEXT REFERENCES tenant_leads(id) ON DELETE CASCADE;
        CREATE INDEX showroom_leads_lead ON showroom_leads(lead_id);
      `);

      rebuildTable(db, 'projects', (sql) => {
        const owner = sql.replace(/user_id\s+TEXT\s+NOT\s+NULL\s+REFERENCES\s+users\(id\)\s+ON\s+DELETE\s+CASCADE/i, 'user_id TEXT REFERENCES users(id) ON DELETE CASCADE');
        if (owner === sql) throw new Error('leads-001: projects.user_id is not the expected NOT NULL column');
        return owner.replace(
          /\)\s*$/,
          `,
          visitor_id TEXT REFERENCES tenant_lead_visitors(id) ON DELETE CASCADE,
          lead_id TEXT REFERENCES tenant_leads(id) ON DELETE SET NULL,
          CHECK (user_id IS NOT NULL OR visitor_id IS NOT NULL))`,
        );
      });
      db.exec(`
        CREATE INDEX projects_visitor ON projects(visitor_id, updated_at DESC);
        CREATE INDEX projects_lead ON projects(lead_id);
      `);

      // Every sent design becomes (or joins) a person.
      const rows = db.prepare('SELECT * FROM showroom_leads ORDER BY tenant_id, created_at, id').all();
      const byEmail = db.prepare("SELECT * FROM tenant_leads WHERE tenant_id = ? AND email = ? AND email <> ''");
      const byPhone = db.prepare("SELECT * FROM tenant_leads WHERE tenant_id = ? AND phone_key = ? AND phone_key <> ''");
      const insert = db.prepare(
        `INSERT INTO tenant_leads (id, tenant_id, user_id, name, email, phone, phone_key, consent_text, consent_at, source, status, staff_notes, read_at,
                                   first_seen_at, last_active_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'migrated', ?, ?, ?, ?, ?, ?, ?)`,
      );
      const event = db.prepare("INSERT INTO tenant_lead_events (tenant_id, lead_id, kind, project_id, detail, at) VALUES (?, ?, 'sent', ?, ?, ?)");
      for (const r of rows) {
        const email = String(r.email ?? '').trim().toLowerCase();
        const p = normalizePhone(r.phone ?? '');
        const phone = p.ok ? p.value : String(r.phone ?? '').trim();
        let key = p.ok ? phoneKeyOf(p.value) : '';
        let lead = (email && byEmail.get(r.tenant_id, email)) || (key && byPhone.get(r.tenant_id, key)) || null;
        if (!lead) {
          if (key && byPhone.get(r.tenant_id, key)) key = '';
          insert.run(r.id, r.tenant_id, r.user_id ?? null, r.name, email, phone, key, r.consent_text ?? '', r.consent ? r.created_at : null, r.status, r.staff_notes ?? '', r.read_at ?? null, r.created_at, r.updated_at ?? r.created_at, r.created_at, r.updated_at ?? r.created_at);
          lead = { id: r.id };
        } else {
          // The same person sent another design: the newest status, every note, unread if any is.
          const cur = db.prepare('SELECT * FROM tenant_leads WHERE id = ?').get(lead.id);
          const notes = [cur.staff_notes, r.staff_notes].map((s) => String(s ?? '').trim()).filter(Boolean);
          const phoneFree = key && !byPhone.get(r.tenant_id, key);
          db.prepare(
            `UPDATE tenant_leads SET status = ?, staff_notes = ?, read_at = CASE WHEN read_at IS NULL OR ? IS NULL THEN NULL ELSE MAX(read_at, ?) END,
                    user_id = COALESCE(user_id, ?), phone = CASE WHEN phone = '' THEN ? ELSE phone END, phone_key = CASE WHEN phone_key = '' AND ? THEN ? ELSE phone_key END,
                    email = CASE WHEN email = '' THEN ? ELSE email END, consent_text = ?, consent_at = COALESCE(?, consent_at),
                    last_active_at = MAX(last_active_at, ?), updated_at = MAX(updated_at, ?) WHERE id = ?`,
          ).run(
            r.status,
            [...new Set(notes)].join('\n\n'),
            r.read_at ?? null,
            r.read_at ?? null,
            r.user_id ?? null,
            phone,
            phoneFree ? 1 : 0,
            key,
            email && !byEmail.get(r.tenant_id, email) ? email : cur.email,
            r.consent_text || cur.consent_text,
            r.consent ? r.created_at : null,
            r.updated_at ?? r.created_at,
            r.updated_at ?? r.created_at,
            lead.id,
          );
        }
        db.prepare('UPDATE showroom_leads SET lead_id = ? WHERE id = ?').run(lead.id, r.id);
        event.run(r.tenant_id, lead.id, r.project_id ?? null, JSON.stringify({ sendId: r.id, design: r.design_name ?? '' }), r.created_at);
        if (r.project_id) db.prepare('UPDATE projects SET lead_id = ? WHERE id = ? AND lead_id IS NULL').run(lead.id, r.project_id);
        if (r.user_id) db.prepare('UPDATE projects SET lead_id = ? WHERE user_id = ? AND tenant_id = ? AND lead_id IS NULL').run(lead.id, r.user_id, r.tenant_id);
      }
    },
  },
];
