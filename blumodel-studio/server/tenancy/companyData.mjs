// A company that leaves (audit 2026-10; docs/handoff/data-lifecycle.md): everything of a showroom
// handed back as one zip, and everything of it deleted, keeping only the billing records tax law
// needs, anonymised. Admin > Companies > a company (server/routes/tenantsAdmin.mjs).
//
//   exportCompany  streams a zip: tenant.json (settings, branding, contact, hostnames, standing),
//                  team.json, products.json, designs.json (every design with its document),
//                  leads.json (each lead with its designs, sends and timeline) and leads.csv,
//                  billing.json (licenses, the monthly plan, receipts), credits.json (lots and the
//                  whole history), renders.json, files.json (what each upload is) and uploads/
//                  (the bytes of every upload of the showroom). Nothing of another showroom.
//   deleteCompany  in one transaction: the billing rows are copied, without names, notes or emails,
//                  into deleted_tenant_billing (protect-005); every lead (as a staff delete does),
//                  the showroom's own accounts and their sessions, the team, every design and share
//                  link, product, upload row, render, credit, hostname and setting; then the
//                  tenant. Emails and phones of the people in it are pseudonymised in the audit log.
//                  After the commit, upload bytes nothing else uses are removed from disk and the
//                  uploads mirror. Returns counts.

import fs from 'node:fs';
import path from 'node:path';
import { createZipWriter } from '../lib/zip.mjs';
import { pseudonymiseAudit } from '../lib/audit.mjs';

const parse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};
const json = (v) => Buffer.from(`${JSON.stringify(v, null, 2)}\n`);

/** What the export holds, counted (for the audit row and the admin's confirmation). */
export function companyCounts(db, tenantId) {
  const n = (sql) => Number(db.prepare(sql).get(tenantId).n);
  return {
    team: n('SELECT COUNT(*) AS n FROM tenant_members WHERE tenant_id = ?'),
    accounts: n('SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?'),
    products: n('SELECT COUNT(*) AS n FROM products WHERE tenant_id = ?'),
    designs: n('SELECT COUNT(*) AS n FROM projects WHERE tenant_id = ?'),
    leads: n('SELECT COUNT(*) AS n FROM tenant_leads WHERE tenant_id = ?'),
    files: n('SELECT COUNT(*) AS n FROM files WHERE tenant_id = ?'),
    renders: n('SELECT COUNT(*) AS n FROM showroom_renders WHERE tenant_id = ?'),
    payments: n('SELECT COUNT(*) AS n FROM tenant_payments WHERE tenant_id = ?'),
  };
}

/**
 * Streams the company's data as a zip to `out` (an http response, headers already set).
 * @param {{ db: any, services: any, config: any }} ctx
 */
export async function exportCompany(ctx, tenant, out, { origin, now = Date.now() } = {}) {
  const { db, services, config } = ctx;
  const id = tenant.id;
  const zip = createZipWriter(out, { now });
  const wire = services.tenants.adminWire(tenant, origin);
  await zip.add('README.txt', `BluModel Studio: everything of ${tenant.name}'s showroom (${tenant.slug}), exported ${new Date(now).toISOString()}.\n\nJSON files hold the data; leads.csv opens in a spreadsheet; uploads/ holds every picture, model and render the showroom uploaded (files.json says which is which).\n`);
  await zip.add('tenant.json', json({ id: wire.id, slug: wire.slug, name: wire.name, status: wire.status, url: wire.url, branding: wire.branding, contact: wire.contact, settings: wire.settings, hostnames: wire.hostnames, createdAt: wire.createdAt, updatedAt: wire.updatedAt }));
  await zip.add('team.json', json(services.tenants.members(id)));
  const products = db.prepare('SELECT * FROM products WHERE tenant_id = ? ORDER BY category, name, id').all(id);
  await zip.add('products.json', json(products.map((p) => ({ id: p.id, status: p.status, name: p.name, category: p.category, kind: p.kind, priceCents: p.price_cents, spec: parse(p.spec), liveSpec: parse(p.live_spec), createdAt: p.created_at, updatedAt: p.updated_at }))));
  const projects = db.prepare('SELECT * FROM projects WHERE tenant_id = ? ORDER BY created_at, id').all(id);
  await zip.add('designs.json', json(projects.map((p) => ({ id: p.id, name: p.name, client: p.client, lead: p.lead_id ?? null, account: p.user_id ?? null, revision: p.revision, doc: parse(p.doc), createdAt: p.created_at, updatedAt: p.updated_at }))));
  const leadIds = db.prepare('SELECT id FROM tenant_leads WHERE tenant_id = ? ORDER BY first_seen_at, id').all(id).map((r) => r.id);
  await zip.add('leads.json', json(leadIds.map((l) => services.leads.get(id, l))));
  await zip.add('leads.csv', services.leads.csv(id));
  await zip.add(
    'billing.json',
    json({
      licenses: db.prepare('SELECT * FROM tenant_licenses WHERE tenant_id = ? ORDER BY starts_on').all(id),
      monthly: db.prepare('SELECT provider, status, current_period_end, cancel_at_period_end, amount_cents, currency, created_at FROM tenant_subscriptions WHERE tenant_id = ?').get(id) ?? null,
      receipts: db.prepare('SELECT id, kind, amount_cents, currency, provider, ref, period_end, status, refunded_cents, created_at FROM tenant_payments WHERE tenant_id = ? ORDER BY created_at').all(id),
    }),
  );
  await zip.add('credits.json', json({ ...services.credits.summary(id), history: db.prepare('SELECT kind, cents, balance_after, ref, note, by_email, created_at FROM tenant_credit_entries WHERE tenant_id = ? ORDER BY id').all(id) }));
  await zip.add('renders.json', json(db.prepare('SELECT id, project_id, design_name, status, provider, cost_cents, input_file_id, output_file_id, created_at, finished_at FROM showroom_renders WHERE tenant_id = ? ORDER BY created_at').all(id)));
  const files = db.prepare('SELECT id, sha256, ext, mime, size_bytes, kind, visibility, original_name, created_at FROM files WHERE tenant_id = ? ORDER BY created_at, id').all(id);
  await zip.add('files.json', json(files.map((f) => ({ id: f.id, kind: f.kind, visibility: f.visibility, mime: f.mime, bytes: f.size_bytes, originalName: f.original_name, path: `uploads/${f.id}.${f.ext}`, createdAt: f.created_at }))));
  let missing = 0;
  for (const f of files) {
    let bytes;
    try {
      bytes = fs.readFileSync(services.files.blobPath(f.sha256, f.ext));
    } catch {
      missing++;
      continue;
    }
    await zip.add(`uploads/${f.id}.${f.ext}`, bytes, { store: /^(png|jpe?g|webp|glb|gif|zip)$/i.test(f.ext) });
  }
  if (missing) await zip.add('uploads/MISSING.txt', `${missing} upload(s) listed in files.json were not on disk when this was made.\n`);
  void config;
  return zip.finish();
}

/**
 * Deletes the company (the caller checked the admin, the typed confirmation and re-authentication).
 * @param {{ db: any, services: any, config: any, tx: (fn: () => any) => any, now: () => number }} ctx
 */
export function deleteCompany(ctx, tenant) {
  const { db, services, config } = ctx;
  const id = tenant.id;
  const blobs = [];
  const counts = ctx.tx(() => {
    const c = companyCounts(db, id);
    const t = ctx.now();
    // Billing records tax law needs (6 years in Canada): amounts, dates and the provider's reference, nobody's name.
    c.billingKept =
      Number(
        db
          .prepare(
            `INSERT INTO deleted_tenant_billing (id, tenant_id, tenant_slug, kind, amount_cents, currency, provider, ref, period_start, period_end, paid_how, status, created_at, deleted_at)
             SELECT id, tenant_id, ?, kind, amount_cents, currency, provider, ref, NULL, period_end, NULL, status, created_at, ? FROM tenant_payments WHERE tenant_id = ?`,
          )
          .run(tenant.slug, t, id).changes,
      ) +
      Number(
        db
          .prepare(
            `INSERT INTO deleted_tenant_billing (id, tenant_id, tenant_slug, kind, amount_cents, currency, provider, ref, period_start, period_end, paid_how, status, created_at, deleted_at)
             SELECT id, tenant_id, ?, 'license', amount_cents, currency, 'admin', id, starts_on, ends_on, paid_how, CASE WHEN voided_at IS NULL THEN 'recorded' ELSE 'voided' END, created_at, ? FROM tenant_licenses WHERE tenant_id = ?`,
          )
          .run(tenant.slug, t, id).changes,
      );
    // Every lead, as a staff delete does it (designs, browsers, links; pseudonymised in the audit log).
    for (const { id: leadId } of db.prepare('SELECT id FROM tenant_leads WHERE tenant_id = ? AND duplicate_of IS NOT NULL').all(id)) services.leads.remove(id, leadId);
    for (const { id: leadId } of db.prepare('SELECT id FROM tenant_leads WHERE tenant_id = ?').all(id)) services.leads.remove(id, leadId);
    // The showroom's own accounts (users.tenant_id) go; sales-site accounts on its team only lose the membership.
    const people = db.prepare('SELECT email, phone FROM users WHERE tenant_id = ?').all(id);
    const contact = tenant.contact ?? {};
    pseudonymiseAudit(db, { emails: [...people.map((p) => p.email), contact.email ?? ''], phones: [...people.map((p) => p.phone), contact.phone ?? ''] });
    db.prepare('DELETE FROM sessions WHERE tenant_id = ?').run(id);
    db.prepare('DELETE FROM share_links WHERE project_id IN (SELECT id FROM projects WHERE tenant_id = ?)').run(id);
    db.prepare('DELETE FROM projects WHERE tenant_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE tenant_id = ?').run(id);
    db.prepare('DELETE FROM products WHERE tenant_id = ?').run(id);
    for (const f of db.prepare('SELECT id, sha256, ext FROM files WHERE tenant_id = ?').all(id)) blobs.push(f);
    db.prepare('DELETE FROM files WHERE tenant_id = ?').run(id);
    // The rest goes with the tenant (ON DELETE CASCADE): team, invites, hostnames, credits, renders,
    // pricing, model requests, the monthly plan, checkouts, payments and licenses (copied above).
    db.prepare('DELETE FROM tenants WHERE id = ?').run(id);
    return c;
  });
  // Bytes on disk, after the commit, only when no other upload row has the same bytes.
  const mirror = path.join(config.BACKUP_DIR, 'uploads-mirror');
  let removed = 0;
  for (const b of blobs) {
    if (db.prepare('SELECT 1 FROM files WHERE sha256 = ? AND ext = ?').get(b.sha256, b.ext)) continue;
    const blob = services.files.blobPath(b.sha256, b.ext);
    if (fs.existsSync(blob)) removed++;
    fs.rmSync(blob, { force: true });
    fs.rmSync(path.join(mirror, path.relative(config.UPLOAD_DIR, blob)), { force: true });
  }
  services.tenants.forget?.(id);
  return { ...counts, blobsRemoved: removed };
}
