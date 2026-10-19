// A person's own data: the export (GET /api/account/export) and deleting the account
// (POST /api/account/delete). Launch contract; docs/LAUNCH.md.
//
// Both are strictly about ONE user: every query below is keyed on that user's id (or on rows that
// belong to them), so another person's kitchens, files, shares or leads are never included or
// deleted. The export holds no secrets: no password hash, session, share token, payment-provider
// reference or file path.
//
// Deleting keeps what the accounts need and makes it anonymous:
//   - custom-model orders stay (their user becomes NULL; the Stripe event payloads, which carry
//     the buyer's email, are cleared);
//   - receipts stay (billing_payments.user_id becomes NULL, kitchen names cleared);
//   - the admin audit log stays as written.
// Everything else that is theirs goes: kitchens (with their unlocks, photo refs, quotes and share
// links), share links they made, their contractor brand page (with its listings, leads and
// events), their own catalog products, their sessions, preferences and unused reset links,
// subscriptions and checkouts, export
// records, and every upload only they own (the file on disk and its mirror copy go too, unless
// another upload row still points at the same bytes). An upload someone else still uses (granted
// to another account, a partner brand's logo, a product that stays) is kept, without its owner.

import { pseudonymiseAudit } from '../lib/audit.mjs';
import fs from 'node:fs';
import path from 'node:path';

const parse = (s, d) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, config: any, now?: () => number, tx: (fn: () => any) => any,
 *   files: any, billing?: { subscriptionWire?: (id: string) => any, receiptsOf?: (id: string) => any[], unlocksOf?: (id: string) => any[] } }} deps
 */
export function createAccountService({ db, config, now = Date.now, tx, files }) {
  const userRow = (userId) => db.prepare('SELECT id, email, name, phone, role, created_at FROM users WHERE id = ?').get(userId) ?? null;
  const prefsOf = (userId) => {
    const row = db.prepare('SELECT prefs FROM user_prefs WHERE user_id = ?').get(userId);
    return row ? parse(row.prefs, {}) : {};
  };

  /** Brands this user owns outright as a contractor (their brand page). */
  const ownBrands = (userId) => db.prepare("SELECT * FROM brands WHERE owner_user_id = ? AND kind = 'contractor'").all(userId);

  /**
   * True while the user has a paid plan (Stripe or demo) that is active or past due and not set to
   * cancel: Stripe keeps charging (or retrying) such a subscription, so deleting the account then
   * would leave it billing someone with no account. A complimentary plan doesn't count.
   */
  function activePaidPlan(userId) {
    const r = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
    if (!r || r.provider === 'comp' || r.cancel_at_period_end) return false;
    return r.status === 'active' || r.status === 'past_due';
  }

  // ── export ────────────────────────────────────────────────────────────────

  function exportFor(userId, { billing } = {}) {
    const u = userRow(userId);
    if (!u) return null;
    const projects = db
      .prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at')
      .all(userId)
      .map((r) => ({ id: r.id, name: r.name, client: r.client, revision: r.revision, createdAt: r.created_at, updatedAt: r.updated_at, doc: parse(r.doc, null) }));
    const shares = db
      .prepare(
        `SELECT s.* FROM share_links s JOIN projects p ON p.id = s.project_id
          WHERE p.user_id = ? ORDER BY s.created_at`,
      )
      .all(userId)
      .map((s) => ({
        id: s.id,
        projectId: s.project_id,
        label: s.label,
        showPrices: !!s.show_prices,
        expiresAt: s.expires_at ?? null,
        revokedAt: s.revoked_at ?? null,
        viewCount: s.view_count,
        lastViewedAt: s.last_viewed_at ?? null,
        createdAt: s.created_at,
      }));
    const orders = db
      .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at')
      .all(userId)
      .map((o) => ({
        id: o.id,
        status: o.status,
        target: o.target,
        tier: o.tier,
        amountCents: o.amount_cents,
        currency: o.currency,
        provider: o.provider,
        line: o.line || null,
        items: db
          .prepare('SELECT idx, brief, tier, extra_finishes, amount_cents, delivered_at FROM order_items WHERE order_id = ? ORDER BY idx')
          .all(o.id)
          .map((it) => ({ idx: it.idx, tier: it.tier, extraFinishes: it.extra_finishes, amountCents: it.amount_cents, deliveredAt: it.delivered_at ?? null, brief: parse(it.brief, {}) })),
        createdAt: o.created_at,
        paidAt: o.paid_at ?? null,
        deliveredAt: o.delivered_at ?? null,
        completedAt: o.completed_at ?? null,
        refundedAt: o.refunded_at ?? null,
      }));

    const out = {
      exportedAt: new Date(now()).toISOString(),
      app: 'blumodel-studio',
      user: { email: u.email, name: u.name, phone: u.phone ?? '', createdAt: u.created_at },
      preferences: prefsOf(userId),
      projects,
      shares,
      orders,
      billing: {
        subscription: billing?.subscriptionWire?.(userId) ?? null,
        receipts: billing?.receiptsOf?.(userId, 1000) ?? [],
        unlocks: billing?.unlocksOf?.(userId) ?? [],
      },
      uploads: db
        .prepare('SELECT id, kind, ext, size_bytes, original_name, visibility, created_at FROM files WHERE owner_user_id = ? ORDER BY created_at')
        .all(userId)
        .map((f) => ({ id: f.id, kind: f.kind, type: f.ext, sizeBytes: f.size_bytes, name: f.original_name, visibility: f.visibility, createdAt: f.created_at })),
    };

    const brands = ownBrands(userId);
    if (brands.length) {
      const b = brands[0];
      out.brandPage = {
        name: b.name,
        slug: b.slug,
        tagline: b.tagline,
        about: b.description,
        website: b.website,
        status: b.status,
        priceDisplay: b.price_display,
        leadForm: !!b.lead_form,
        createdAt: b.created_at,
        products: db
          .prepare("SELECT id, name, status, created_at FROM products WHERE brand_id = ? ORDER BY created_at")
          .all(b.id)
          .map((p) => ({ id: p.id, name: p.name, status: p.status, createdAt: p.created_at })),
      };
      const ids = brands.map((x) => x.id);
      out.leads = db
        .prepare(`SELECT * FROM leads WHERE brand_id IN (${ids.map(() => '?').join(', ')}) ORDER BY created_at`)
        .all(...ids)
        .map((l) => ({
          id: l.id,
          productName: l.product_name,
          projectName: l.project_name,
          name: l.name,
          email: l.email,
          phone: l.phone,
          location: l.location,
          message: l.message,
          status: l.status,
          notes: l.notes,
          createdAt: l.created_at,
        }));
    }

    const profile = db.prepare('SELECT * FROM contractor_profiles WHERE user_id = ?').get(userId);
    if (profile) {
      out.contractor = {
        company: profile.company,
        phone: profile.phone,
        email: profile.email,
        website: profile.website,
        serviceArea: profile.service_area,
        defaultMarkupPct: profile.default_markup_pct,
        taxPct: profile.tax_pct,
        carriedBrands: db.prepare('SELECT brand_key, enabled, pct_off_list, markup_pct FROM carried_brands WHERE user_id = ?').all(userId).map((r) => ({ ...r })),
        priceBook: db
          .prepare('SELECT product_id, cost_cents, cost_by_width, markup_pct, updated_at FROM price_book WHERE user_id = ?')
          .all(userId)
          .map((r) => ({ productId: r.product_id, costCents: r.cost_cents, costByWidth: parse(r.cost_by_width, null), markupPct: r.markup_pct, updatedAt: r.updated_at })),
        catalog: db
          .prepare("SELECT id, name, status, spec, created_at FROM products WHERE owner_user_id = ? AND source = 'contractor' ORDER BY created_at")
          .all(userId)
          .map((p) => ({ id: p.id, name: p.name, status: p.status, spec: parse(p.spec, null), createdAt: p.created_at })),
      };
    }
    return out;
  }

  // ── delete ────────────────────────────────────────────────────────────────

  /** True when something that stays still points at this upload. */
  function fileStillUsed(fileId, userId) {
    if (db.prepare('SELECT 1 FROM file_grants WHERE file_id = ? AND user_id <> ?').get(fileId, userId)) return true;
    if (db.prepare('SELECT 1 FROM brands WHERE logo_file_id = ? OR cover_file_id = ?').get(fileId, fileId)) return true;
    if (db.prepare('SELECT 1 FROM contractor_profiles WHERE logo_file_id = ? AND user_id <> ?').get(fileId, userId)) return true;
    const like = `%${fileId}%`;
    if (db.prepare('SELECT 1 FROM products WHERE spec LIKE ? OR live_spec LIKE ?').get(like, like)) return true;
    return false;
  }

  /**
   * Deletes the account (see the top of this file). The caller has checked the password and that
   * no paid plan is active. Returns counts of what went.
   */
  function deleteAccount(userId) {
    const removedBlobs = [];
    const counts = tx(() => {
      const c = { projects: 0, shares: 0, brands: 0, leads: 0, products: 0, files: 0, sessions: 0 };
      const myOrders = db.prepare('SELECT id FROM orders WHERE user_id = ?').all(userId).map((r) => r.id);

      // The contractor brand page: its leads, listings, events and public copies go with it.
      for (const b of ownBrands(userId)) {
        c.leads += db.prepare('SELECT COUNT(*) AS n FROM leads WHERE brand_id = ?').get(b.id).n;
        db.prepare('DELETE FROM products WHERE brand_id = ?').run(b.id);
        db.prepare('DELETE FROM brands WHERE id = ?').run(b.id);
        c.brands++;
      }
      // Their own catalog and the custom models delivered to them (not brand products).
      c.products += db.prepare("DELETE FROM products WHERE owner_user_id = ? AND brand_id IS NULL AND source IN ('contractor','custom')").run(userId).changes;
      c.shares += db.prepare('DELETE FROM share_links WHERE created_by = ? OR project_id IN (SELECT id FROM projects WHERE user_id = ?)').run(userId, userId).changes;
      c.projects += db.prepare('DELETE FROM projects WHERE user_id = ?').run(userId).changes;
      c.sessions += db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes;
      // Account settings: preferences and any reset link still outstanding (account-001).
      db.prepare('DELETE FROM user_prefs WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM signin_alerts WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM export_events WHERE user_id = ?').run(userId);
      db.prepare('UPDATE product_events SET user_id = NULL WHERE user_id = ?').run(userId);
      db.prepare('UPDATE brand_events SET user_id = NULL WHERE user_id = ?').run(userId);
      // Kept for the accounts, made anonymous.
      db.prepare("UPDATE billing_payments SET project_name = '' WHERE user_id = ?").run(userId);
      for (const id of myOrders) db.prepare('UPDATE payment_events SET payload = NULL WHERE order_id = ?').run(id);

      // Uploads only they own.
      const mine = db.prepare('SELECT id, sha256, ext FROM files WHERE owner_user_id = ?').all(userId);
      for (const f of mine) {
        if (fileStillUsed(f.id, userId)) continue;
        db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
        c.files++;
        removedBlobs.push({ sha256: f.sha256, ext: f.ext });
      }

      // The audit log keeps what happened, not to whom: this account's email and phone become a pseudonym.
      const who = db.prepare('SELECT email, phone FROM users WHERE id = ?').get(userId);
      if (who) pseudonymiseAudit(db, { emails: [who.email], phones: [who.phone] });
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      return c;
    });

    // Bytes on disk, after the commit: only when no other upload row has the same bytes.
    const mirror = path.join(config.BACKUP_DIR, 'uploads-mirror');
    for (const b of removedBlobs) {
      if (db.prepare('SELECT 1 FROM files WHERE sha256 = ? AND ext = ?').get(b.sha256, b.ext)) continue;
      const blob = files.blobPath(b.sha256, b.ext);
      fs.rmSync(blob, { force: true });
      fs.rmSync(path.join(mirror, path.relative(config.UPLOAD_DIR, blob)), { force: true });
    }
    return counts;
  }

  return { exportFor, deleteAccount, activePaidPlan };
}
