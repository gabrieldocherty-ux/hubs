// The owner's admin panel: Overview, Users, Contractors, System and Audit (docs/handoff/admin.md).
//
//   GET  /api/admin/dashboard                      the Overview snapshot (server/admin/dashboard.mjs)
//   GET  /api/admin/users/:id                      one account in full (server/admin/people.mjs)
//   POST /api/admin/users/:id/role {role}          customer <-> studio. Admin is CLI-only
//   POST /api/admin/users/:id/comp {plan, endsOn?, note?}   a complimentary plan, optionally until a date
//   POST /api/admin/users/:id/comp/revoke          end it now
//   POST /api/admin/users/:id/sign-out             end every session the account has
//   POST /api/admin/users/:id/disable {reason?}    can't sign in; every session ended
//   POST /api/admin/users/:id/enable
//   POST /api/admin/users/:id/delete {confirm}     `confirm` must be the account's email
//   GET  /api/admin/contractors?q=                 contractors with plan, page and models
//   POST /api/admin/contractors/:id/verify {verified}   the Verified badge on their brand page
//   GET  /api/admin/system                         health and setup, secrets as yes/no only
//   POST /api/admin/system/update-now              leave the Update now trigger for the automatic update
//   POST /api/admin/system/sites {on}              every site on, or off for maintenance (ops/sitesSwitch.mjs)
//   GET  /api/admin/audit?actor=&action=&from=&to=&page=
//
// Every route is admin-only (the router answers 401 / 403 before the handler runs), every write
// carries the X-BluModel CSRF header (the router's default for non-GET), every route is
// rate-limited per admin, and every action is written to admin_audit with the target's email
// copied in. Nobody can act on their own account here, and nobody can grant, take away, disable or
// delete an ADMIN through the API: that stays `node server/scripts/make-admin.mjs` on the server.

import { HttpError } from '../http/respond.mjs';
import { audit, pseudonymOf } from '../lib/audit.mjs';
import { SUBSCRIPTION_PLANS } from '../lib/plans.mjs';
import { createBillingService } from '../billing/service.mjs';
import { createAllowance } from '../payments/allowance.mjs';
import { createAccountService } from '../account/service.mjs';
import { createDashboard } from '../admin/dashboard.mjs';
import { auditPage, createPeople } from '../admin/people.mjs';
import { systemStatus } from '../admin/system.mjs';
import { requestUpdate, serverHome } from '../admin/updates.mjs';
import { disableAccount, enableAccount, isDisabled } from '../admin/status.mjs';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const READ = { name: 'admin-panel-read', max: 1200, windowMs: HOUR, by: 'user' };
const WRITE = { name: 'admin-panel-write', max: 120, windowMs: HOUR, by: 'user' };
const DESTROY = { name: 'admin-panel-delete', max: 20, windowMs: HOUR, by: 'user' };
const NOTE_MAX = 500;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Roles the panel may set. 'admin' is made and taken away only with server/scripts/make-admin.mjs. */
export const PANEL_ROLES = Object.freeze(['customer', 'studio']);

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bad = (field, message) => new HttpError(400, message, { errors: [{ field, message }] });

/** 'YYYY-MM-DD' (a real calendar day) → ms at the START of that UTC day, or null. */
export function dayStart(s) {
  const m = DATE_RE.exec(String(s ?? ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? ms : null;
}

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, config, services, log } = ctx;
  const { sessions } = ctx.internal;
  const billing = createBillingService({ db, now: ctx.now, log });
  const allowance = createAllowance({ db, now: ctx.now, billing: services.billing, config });
  const account = createAccountService({ db, config, now: ctx.now, tx: ctx.tx, files: services.files });
  const dashboard = createDashboard({ db, now: ctx.now, billing, allowance, config });
  const people = createPeople({ db, now: ctx.now, billing, allowance });

  const target = (id) => {
    const u = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(id);
    if (!u) throw new HttpError(404, 'That account does not exist.');
    return u;
  };
  /** The target, refusing your own account and (unless allowed) an admin's. */
  const other = (rc, { admins = false, what = 'do that' } = {}) => {
    const u = target(rc.params.id);
    if (u.id === rc.user.id) throw new HttpError(400, `You can’t ${what} to your own account here.`, { code: 'self' });
    if (!admins && u.role === 'admin') {
      throw new HttpError(409, `That account is an admin. Admins are changed only on the server with node server/scripts/make-admin.mjs (use --role customer first).`, { code: 'target_admin' });
    }
    return u;
  };
  const record = (rc, action, u, detail = {}) => audit(db, { admin: rc.user, action, targetUserId: u.id, targetEmail: u.email, detail, at: ctx.now() });
  const detail = (id) => people.detail(id);

  return [
    {
      method: 'GET',
      path: '/api/admin/dashboard',
      auth: 'admin',
      rateLimit: READ,
      handler: (rc) => {
        rc.res.setHeader('Cache-Control', 'no-store');
        return dashboard.snapshot();
      },
    },

    // ── users ───────────────────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/admin/users/:id',
      auth: 'admin',
      rateLimit: READ,
      params: { id: ID },
      handler: (rc) => {
        const d = detail(rc.params.id);
        if (!d) throw new HttpError(404, 'That account does not exist.');
        rc.res.setHeader('Cache-Control', 'no-store');
        return d;
      },
    },
    {
      method: 'POST',
      path: '/api/admin/users/:id/role',
      auth: 'admin',
      // Money or access: the password and 2FA code again within REAUTH_MINUTES.
      reauth: true,
      rateLimit: WRITE,
      maxBytes: 2_048,
      params: { id: ID },
      handler: (rc) => {
        const role = rc.body.role;
        if (!PANEL_ROLES.includes(role)) throw bad('role', 'Choose customer or studio. Admins are made only on the server (make-admin).');
        const u = other(rc, { what: 'change the role' });
        if (u.role === role) return detail(u.id);
        ctx.tx(() => {
          db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, u.id);
          record(rc, 'role_change', u, { from: u.role, to: role });
        });
        return detail(u.id);
      },
    },
    {
      method: 'POST',
      path: '/api/admin/users/:id/comp',
      auth: 'admin',
      // Money or access: the password and 2FA code again within REAUTH_MINUTES.
      reauth: true,
      rateLimit: WRITE,
      maxBytes: 4_096,
      params: { id: ID },
      handler: (rc) => {
        const u = target(rc.params.id);
        const plan = rc.body.plan;
        if (!SUBSCRIPTION_PLANS.includes(plan)) throw bad('plan', 'Choose Unlimited or Contractor.');
        const note = str(rc.body.note, NOTE_MAX + 1);
        if (note.length > NOTE_MAX) throw bad('note', `Keep the note to ${NOTE_MAX} characters or fewer.`);
        let endsAt = null;
        if (rc.body.endsOn !== undefined && rc.body.endsOn !== null && rc.body.endsOn !== '') {
          const start = dayStart(rc.body.endsOn);
          if (start === null) throw bad('endsOn', 'Give the end date as YYYY-MM-DD.');
          endsAt = start + DAY; // the plan runs through the whole of that day (UTC)
          if (endsAt <= ctx.now()) throw bad('endsOn', 'Choose an end date after today.');
          if (endsAt > ctx.now() + 5 * 366 * DAY) throw bad('endsOn', 'Choose an end date within five years, or leave it empty for no end.');
        }
        ctx.tx(() => {
          let res;
          try {
            res = billing.grantComp(u.id, { plan, note, adminId: rc.user.id });
          } catch (err) {
            if (err?.code === 'paid_subscription') throw new HttpError(409, err.message, { code: 'paid_subscription' });
            throw err;
          }
          // planOf ends a complimentary plan at current_period_end (server/billing/service.mjs).
          db.prepare('UPDATE subscriptions SET current_period_end = ? WHERE id = ?').run(endsAt, res.row.id);
          record(rc, 'comp_grant', u, { plan, note, endsAt, replaced: res.replaced });
        });
        rc.send(201, detail(u.id));
      },
    },
    {
      method: 'POST',
      path: '/api/admin/users/:id/comp/revoke',
      auth: 'admin',
      rateLimit: WRITE,
      body: 'none',
      params: { id: ID },
      handler: (rc) => {
        const u = target(rc.params.id);
        ctx.tx(() => {
          const sub = db.prepare("SELECT id FROM subscriptions WHERE user_id = ? AND provider = 'comp' AND status = 'active'").get(u.id);
          const r = sub ? billing.revokeComp(sub.id) : null;
          if (!r) throw new HttpError(404, 'That account has no active complimentary plan.');
          record(rc, 'comp_revoke', u, { plan: r.plan, grantId: r.id });
        });
        return detail(u.id);
      },
    },
    {
      method: 'POST',
      path: '/api/admin/users/:id/sign-out',
      auth: 'admin',
      rateLimit: WRITE,
      body: 'none',
      params: { id: ID },
      handler: (rc) => {
        const u = other(rc, { admins: true, what: 'sign everyone out' });
        const ended = ctx.tx(() => {
          const n = sessions.endAll(u.id);
          record(rc, 'sign_out_all', u, { sessions: n });
          return n;
        });
        return { ended, ...detail(u.id) };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/users/:id/disable',
      auth: 'admin',
      // Money or access: the password and 2FA code again within REAUTH_MINUTES.
      reauth: true,
      rateLimit: WRITE,
      maxBytes: 4_096,
      params: { id: ID },
      handler: (rc) => {
        const u = other(rc, { what: 'disable' });
        const reason = str(rc.body.reason, NOTE_MAX + 1);
        if (reason.length > NOTE_MAX) throw bad('reason', `Keep the reason to ${NOTE_MAX} characters or fewer.`);
        if (isDisabled(db, u.id)) throw new HttpError(409, 'That account is already disabled.', { code: 'already_disabled' });
        ctx.tx(() => {
          disableAccount(db, u.id, { by: rc.user.id, reason, at: ctx.now() });
          const n = sessions.endAll(u.id);
          db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(u.id);
          record(rc, 'account_disable', u, { reason, sessions: n });
        });
        log.info?.(`Account ${u.id} disabled by admin ${rc.user.id}.`);
        return detail(u.id);
      },
    },
    {
      method: 'POST',
      path: '/api/admin/users/:id/enable',
      auth: 'admin',
      rateLimit: WRITE,
      body: 'none',
      params: { id: ID },
      handler: (rc) => {
        const u = other(rc, { admins: true, what: 'enable' });
        ctx.tx(() => {
          if (!enableAccount(db, u.id)) throw new HttpError(409, 'That account isn’t disabled.', { code: 'not_disabled' });
          record(rc, 'account_enable', u);
        });
        return detail(u.id);
      },
    },
    {
      method: 'POST',
      path: '/api/admin/users/:id/delete',
      auth: 'admin',
      // Money or access: the password and 2FA code again within REAUTH_MINUTES.
      reauth: true,
      rateLimit: DESTROY,
      maxBytes: 2_048,
      params: { id: ID },
      handler: (rc) => {
        const u = other(rc, { what: 'delete' });
        const confirm = str(rc.body.confirm, 300).toLowerCase();
        if (confirm !== u.email.toLowerCase()) throw bad('confirm', 'Type the account’s email address exactly to confirm.');
        if (account.activePaidPlan(u.id)) {
          throw new HttpError(409, 'This account pays for a plan that still renews. Cancel it in Stripe (or wait for it to end) before deleting the account.', { code: 'active_subscription' });
        }
        const counts = account.deleteAccount(u.id);
        // admin_audit has no foreign key to users: the record stays, about a pseudonym (the account's
        // earlier entries were pseudonymised with it), never the person's name or address.
        record(rc, 'account_delete', { ...u, email: pseudonymOf(u.email) }, { role: u.role, counts });
        log.info?.(`Account ${u.id} deleted by admin ${rc.user.id} (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}).`);
        return { deleted: true, counts };
      },
    },

    // ── contractors ─────────────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/admin/contractors',
      auth: 'admin',
      rateLimit: READ,
      handler: (rc) => ({ contractors: people.contractors(String(rc.query.get('q') || '')) }),
    },
    {
      method: 'POST',
      path: '/api/admin/contractors/:id/verify',
      auth: 'admin',
      rateLimit: WRITE,
      maxBytes: 2_048,
      params: { id: ID },
      handler: (rc) => {
        if (typeof rc.body.verified !== 'boolean') throw bad('verified', 'Say whether the contractor is verified (true or false).');
        const u = target(rc.params.id);
        const brand = people.contractorBrand(u.id);
        if (!brand) throw new HttpError(409, 'This contractor has no brand page yet, so there is nothing to show a Verified badge on.', { code: 'no_brand_page' });
        const verified = rc.body.verified;
        ctx.tx(() => {
          db.prepare('UPDATE brands SET verified_at = ?, updated_at = ? WHERE id = ?').run(verified ? ctx.now() : null, ctx.now(), brand.id);
          db.prepare('INSERT INTO brand_moderation_log (brand_id, product_id, action, by_user_id, note, created_at) VALUES (?, NULL, ?, ?, ?, ?)').run(brand.id, verified ? 'verify' : 'unverify', rc.user.id, 'Admin > Contractors', ctx.now());
          record(rc, verified ? 'contractor_verify' : 'contractor_unverify', u, { brandId: brand.id, brand: brand.name });
        });
        return { contractor: people.contractors(u.email).find((c) => c.userId === u.id) ?? null };
      },
    },

    // ── system and audit ────────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/admin/system',
      auth: 'admin',
      rateLimit: READ,
      handler: (rc) => {
        rc.res.setHeader('Cache-Control', 'no-store');
        return systemStatus({ db, config, now: ctx.now, startedAt: ctx.startedAt, health: ctx.health, home: ctx.home === undefined ? serverHome() : ctx.home, sitesSwitch: ctx.sitesSwitch });
      },
    },
    {
      // Admin > System > All websites: the site-wide switch (ops/sitesSwitch.mjs). OFF leaves the
      // sales site's sign-in and Admin working for admins, so this same button turns it back on.
      method: 'POST',
      path: '/api/admin/system/sites',
      auth: 'admin',
      rateLimit: { name: 'admin-sites-switch', max: 30, windowMs: HOUR, by: 'user' },
      maxBytes: 256,
      handler: (rc) => {
        if (typeof rc.body.on !== 'boolean') throw bad('on', 'Say whether the sites should be on (true or false).');
        const state = ctx.sitesSwitch.set(rc.body.on, { via: 'admin', admin: rc.user });
        return { sites: { on: state.on, since: state.since, by: state.by, via: state.via }, changed: state.changed };
      },
    },
    {
      // Admin > System > Updates > Update now: leaves logs/update-now.request in the home, which the
      // automatic update picks up (Linux: blumodel-update.path at once; Windows: within two minutes).
      // Nothing is run from here. Audited.
      method: 'POST',
      path: '/api/admin/system/update-now',
      auth: 'admin',
      rateLimit: { name: 'admin-update-now', max: 10, windowMs: HOUR, by: 'user' },
      maxBytes: 256,
      handler: (rc) => {
        const home = ctx.home === undefined ? serverHome() : ctx.home;
        let r;
        try {
          r = requestUpdate({ home, now: ctx.now, by: rc.user.email });
        } catch (err) {
          if (err?.code) throw new HttpError(409, err.message, { code: err.code });
          throw err;
        }
        audit(db, { admin: rc.user, action: 'update_now', detail: { alreadyPending: r.already }, at: ctx.now() });
        log.info?.(`admin: ${rc.user.email} asked for an update now`);
        return { requested: true, alreadyPending: r.already, updates: systemStatus({ db, config, now: ctx.now, startedAt: ctx.startedAt, health: ctx.health, home }).updates };
      },
    },
    {
      method: 'GET',
      path: '/api/admin/audit',
      auth: 'admin',
      rateLimit: READ,
      handler: (rc) => {
        const q = rc.query;
        const from = q.get('from') ? dayStart(q.get('from')) : null;
        const toDay = q.get('to') ? dayStart(q.get('to')) : null;
        if (q.get('from') && from === null) throw bad('from', 'Give dates as YYYY-MM-DD.');
        if (q.get('to') && toDay === null) throw bad('to', 'Give dates as YYYY-MM-DD.');
        const page = Math.max(1, Math.min(100_000, Math.floor(Number(q.get('page')) || 1)));
        const action = str(q.get('action'), 60);
        if (action && !/^[a-z_]{1,60}$/.test(action)) throw bad('action', 'Unknown action.');
        return auditPage(db, { actor: str(q.get('actor'), 254), action, from, to: toDay === null ? null : toDay + DAY, page, perPage: 50 });
      },
    },
  ];
}
