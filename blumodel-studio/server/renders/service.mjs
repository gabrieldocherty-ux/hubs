// Photoreal AI renders on a showroom (docs/SHOWROOM_PIVOT.md §5, §7; docs/handoff/renders.md).
// Exposed as ctx.services.renders by server/routes/renders.mjs.
//
// One render, start to finish:
//   1. The editor sends the current 3D view (a PNG/JPEG/WebP, base64) and a structured scene.
//   2. start(): renders set up? (else 503 renders_not_configured, nothing charged) -> may this
//      person render here (team: always; visitor: only when the company switched visitor renders
//      on, within its daily cap) -> the design is theirs, or the team's to see -> the image is a
//      real image within the limits -> one render at a time per person. Then, in one transaction:
//      reserve the credits (402 insufficient_credits), store the captured view as a private file of
//      the showroom, insert the row 'pending'. Answers at once (202).
//   3. In the background the provider renders. Worked: the result is stored, the hold is CHARGED,
//      the row is 'done'. Failed or timed out: the hold is RELEASED, the row is 'failed' with a
//      plain message. A render left 'pending' by a restart is failed and released the next time
//      anything here is read (sweep).
//   4. An admin can refund a done render (the hold is REFUNDED, the row 'refunded'; audited).
//
// Free renders: every account gets config.FREE_RENDERS (3) once. While it has some left, a render is
// free: no credits are held or charged, and it doesn't need the company's visitor setting or wait on
// its daily cap (both are about spending the company's credits). A free render that fails doesn't
// count. After that, the rules above.

import crypto from 'node:crypto';
import { HttpError } from '../http/respond.mjs';
import { inspectUpload } from '../files/meta.mjs';
import { RenderFailure } from './providers.mjs';
import { cleanScene, scenePrompt } from './scene.mjs';

const MB = 1024 * 1024;
const DAY = 86_400_000;
const MIN_SIDE = 64;
const newId = () => `rn_${crypto.randomBytes(12).toString('base64url')}`;
export const RENDER_ID = /^rn_[A-Za-z0-9_-]{16}$/;

/** Start of the UTC day of `t`. The visitor cap counts renders since then. */
const dayStart = (t) => Math.floor(t / DAY) * DAY;
const monthStart = (t) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, config: any, now: () => number, tx: (fn: () => any) => any,
 *   credits: any, files: any, provider: { id: string, render: Function } | null | (() => ({ id: string, render: Function } | null)), log?: any }} deps
 * `provider` may be a function (renders/settings.mjs current()): asked again on every render, so a
 * service set in Admin > System takes effect without a restart.
 */
export function createRenderService({ db, config, now, tx, credits, files, provider: providerOf, log }) {
  const current = typeof providerOf === 'function' ? providerOf : () => providerOf;
  /** Renders in flight in this process: id -> promise. A pending row not in here is stale. */
  const inflight = new Map();
  const costCents = () => config.RENDER_CREDIT_CENTS;
  const freeTotal = () => config.FREE_RENDERS ?? 0;
  /** Free renders this account has used (any showroom; a failed one gives it back). */
  const freeUsed = (userId) =>
    userId ? Number(db.prepare("SELECT COUNT(*) AS n FROM showroom_renders WHERE user_id = ? AND free = 1 AND status IN ('pending', 'done', 'refunded')").get(userId).n) : 0;
  const freeLeft = (userId) => Math.max(0, freeTotal() - freeUsed(userId));

  const row = (id) => (typeof id === 'string' && RENDER_ID.test(id) ? (db.prepare('SELECT * FROM showroom_renders WHERE id = ?').get(id) ?? null) : null);

  const fileMeta = (fileId) => {
    if (!fileId) return null;
    const f = files.get(fileId);
    return f ? { width: f.meta?.width ?? null, height: f.meta?.height ?? null, bytes: f.sizeBytes ?? null } : null;
  };

  /**
   * The wire shape. `viewer` decides what is shown about who asked: the team sees names, a visitor
   * only their own renders.
   */
  const wire = (r, { team = false, userId = null, detail = false } = {}) => {
    if (!r) return null;
    const out = fileMeta(r.output_file_id);
    const by = team && r.user_id ? db.prepare('SELECT name, email FROM users WHERE id = ?').get(r.user_id) : null;
    let scene = null;
    if (detail) {
      try {
        scene = JSON.parse(r.scene);
      } catch {
        scene = null;
      }
    }
    return {
      id: r.id,
      status: r.status,
      projectId: r.project_id ?? null,
      designName: r.design_name,
      provider: r.provider,
      demo: r.provider === 'demo',
      costCents: r.cost_cents,
      free: !!r.free,
      byRole: r.by_role,
      byName: by ? by.name || by.email : null,
      mine: !!userId && r.user_id === userId,
      createdAt: r.created_at,
      finishedAt: r.finished_at ?? null,
      error: r.status === 'failed' ? r.error || 'The render didn’t work. Your credits were returned.' : null,
      imageUrl: r.output_file_id && (r.status === 'done' || r.status === 'refunded') ? `/api/renders/${r.id}/image` : null,
      inputUrl: r.input_file_id ? `/api/renders/${r.id}/input` : null,
      width: out?.width ?? null,
      height: out?.height ?? null,
      ...(detail ? { scene } : {}),
    };
  };

  /** A render this process isn't running and that has outlived the timeout: failed, credits back. */
  function sweep(tenantId) {
    const cutoff = now() - (config.RENDER_TIMEOUT_MS + 60_000);
    const stale = db.prepare("SELECT * FROM showroom_renders WHERE tenant_id = ? AND status = 'pending' AND created_at < ?").all(tenantId, cutoff);
    for (const r of stale) {
      if (inflight.has(r.id)) continue;
      fail(r.id, 'The render was interrupted. Your credits were returned.');
    }
  }

  function fail(id, message) {
    tx(() => {
      const r = row(id);
      if (!r || r.status !== 'pending') return;
      if (r.hold_id) {
        const h = credits.hold(r.hold_id);
        if (h?.status === 'held') credits.release(r.hold_id);
      }
      db.prepare("UPDATE showroom_renders SET status = 'failed', error = ?, finished_at = ? WHERE id = ? AND status = 'pending'").run(String(message).slice(0, 300), now(), id);
    });
  }

  /** The role this request renders as on its showroom: 'owner' | 'staff' | 'visitor'. */
  const roleOf = (rc) => rc.memberRole ?? 'visitor';

  const visitorUsedToday = (tenantId) =>
    Number(db.prepare("SELECT COUNT(*) AS n FROM showroom_renders WHERE tenant_id = ? AND by_role = 'visitor' AND status IN ('pending', 'done', 'refunded') AND created_at >= ?").get(tenantId, dayStart(now())).n);

  /** Whether visitors may render here today, and how many are left. */
  function visitorAllowance(tenant) {
    const enabled = !!tenant.settings?.visitorRenders;
    const dailyCap = Number(tenant.settings?.dailyRenderCap) || 0;
    const usedToday = visitorUsedToday(tenant.id);
    return { enabled, dailyCap, usedToday, left: enabled ? Math.max(0, dailyCap - usedToday) : 0 };
  }

  /** The design a render is for: `projectId` (own kitchen, or any of the showroom's for the team) or a share link (team only). */
  function designFor(rc, { projectId, shareToken }, team) {
    const tenantId = rc.tenant.id;
    if (typeof projectId === 'string' && projectId) {
      const p = db.prepare('SELECT id, name, user_id FROM projects WHERE id = ? AND tenant_id = ?').get(projectId, tenantId);
      if (!p || (!team && p.user_id !== rc.user.id)) throw new HttpError(404, 'That design doesn’t exist.', { code: 'no_design' });
      return { projectId: p.id, name: p.name };
    }
    if (typeof shareToken === 'string' && shareToken) {
      if (!team) throw new HttpError(404, 'That design doesn’t exist.', { code: 'no_design' });
      const p = db
        .prepare('SELECT p.id, p.name FROM share_links s JOIN projects p ON p.id = s.project_id WHERE s.token = ? AND p.tenant_id = ? AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ?)')
        .get(shareToken, tenantId, now());
      if (!p) throw new HttpError(404, 'That design doesn’t exist.', { code: 'no_design' });
      return { projectId: p.id, name: p.name };
    }
    throw new HttpError(400, 'Save this design first, then make it photoreal.', { code: 'no_design', field: 'projectId' });
  }

  /** The captured view: base64 (or a data: URL) of a PNG, JPEG or WebP within the limits. */
  function imageOf(raw) {
    if (typeof raw !== 'string' || !raw) throw new HttpError(400, 'The picture of the 3D view is missing.', { field: 'image' });
    const b64 = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
    const max = config.RENDER_MAX_IMAGE_MB * MB;
    if (b64.length > Math.ceil((max * 4) / 3) + 8) throw new HttpError(413, `The picture of the 3D view can be at most ${config.RENDER_MAX_IMAGE_MB} MB.`, { field: 'image', code: 'too_large' });
    if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) throw new HttpError(400, 'The picture of the 3D view isn’t readable.', { field: 'image' });
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > max) throw new HttpError(413, `The picture of the 3D view can be at most ${config.RENDER_MAX_IMAGE_MB} MB.`, { field: 'image', code: 'too_large' });
    const info = inspectUpload(buf);
    if (!info.ok || info.ext === 'glb') throw new HttpError(400, info.ok ? 'The picture of the 3D view must be a PNG, JPEG or WebP image.' : info.error, { field: 'image' });
    if (info.meta.width < MIN_SIDE || info.meta.height < MIN_SIDE) throw new HttpError(400, `The picture of the 3D view must be at least ${MIN_SIDE} pixels on each side.`, { field: 'image' });
    return { buf, mime: info.mime, width: info.meta.width, height: info.meta.height };
  }

  async function run(id, { image, mime, scene, provider }) {
    const prompt = scenePrompt(scene);
    try {
      if (!provider) throw new RenderFailure('Photoreal renders are being set up. Your credits were returned.');
      const res = await provider.render({ image, mime, scene, prompt, requestId: id, signal: AbortSignal.timeout(config.RENDER_TIMEOUT_MS) });
      const out = res?.image;
      if (!Buffer.isBuffer(out) || !out.length) throw new RenderFailure('The rendering service didn’t send an image back. Your credits were returned.');
      const info = inspectUpload(out);
      if (!info.ok || info.ext === 'glb') throw new RenderFailure('The rendering service sent something that isn’t an image. Your credits were returned.');
      tx(() => {
        const r = row(id);
        if (!r || r.status !== 'pending') return; // swept meanwhile: the credits already went back
        const file = files.saveBuffer(out, { kind: 'image', visibility: 'private', ownerUserId: r.user_id, tenantId: r.tenant_id, originalName: `render-${id}.${info.ext}` });
        if (r.hold_id) credits.charge(r.hold_id);
        db.prepare("UPDATE showroom_renders SET status = 'done', output_file_id = ?, finished_at = ? WHERE id = ?").run(file.id, now(), id);
      });
    } catch (err) {
      const msg = err instanceof RenderFailure ? err.message : err instanceof HttpError ? `${err.message} Your credits were returned.` : 'The render didn’t work. Your credits were returned.';
      if (!(err instanceof RenderFailure)) log?.warn?.(`renders: ${id} failed: ${err?.message ?? err}`);
      try {
        fail(id, msg);
      } catch (e) {
        log?.error?.(`renders: could not mark ${id} failed: ${e?.message ?? e}`);
      }
    } finally {
      inflight.delete(id);
    }
  }

  const svc = {
    /** Who makes the renders here: 'architect' | 'demo' | null (not set up). */
    get providerId() {
      return current()?.id ?? null;
    },

    costCents,

    /**
     * What the editor's button needs: whether renders are set up, what one costs, whether this
     * person may render now and, if not, why. Charges nothing.
     */
    status(rc) {
      const tenant = rc.tenant;
      sweep(tenant.id);
      const provider = current();
      const configured = !!provider;
      const role = rc.user ? roleOf(rc) : null;
      const team = role === 'owner' || role === 'staff';
      const visitor = visitorAllowance(tenant);
      const balance = credits.balance(tenant.id);
      const free = rc.user ? freeLeft(rc.user.id) : freeTotal();
      let reason = null;
      if (!configured) reason = 'not_configured';
      else if (!rc.user) reason = 'sign_in';
      else if (free > 0) reason = null;
      else if (!team && !visitor.enabled) reason = 'visitor_off';
      else if (!team && visitor.left <= 0) reason = 'daily_cap';
      else if (balance < costCents()) reason = team ? 'no_credits' : 'unavailable';
      return {
        configured,
        provider: provider?.id ?? null,
        demo: provider?.id === 'demo',
        costCents: costCents(),
        role,
        canRender: reason === null,
        reason,
        // The team sees the balance; a visitor only whether they can render.
        balanceCents: team ? balance : null,
        visitor: team ? visitor : { enabled: visitor.enabled, left: visitor.left },
        // This account's free renders: the next render is free while left > 0.
        free: { total: freeTotal(), left: free },
        maxImageMb: config.RENDER_MAX_IMAGE_MB,
      };
    },

    /** Steps 1–2 above. Returns the pending render's wire. */
    start(rc, body) {
      const b = body && typeof body === 'object' ? body : {};
      const provider = current();
      if (!provider) throw new HttpError(503, 'Photoreal renders are being set up. Nothing was charged.', { code: 'renders_not_configured' });
      const tenant = rc.tenant;
      const role = roleOf(rc);
      const team = role !== 'visitor';
      sweep(tenant.id);
      // One of this account's free renders, while it has any: no credits, no visitor rules.
      const free = freeLeft(rc.user.id) > 0;
      if (!team && !free) {
        const v = visitorAllowance(tenant);
        if (!v.enabled) throw new HttpError(403, `${tenant.name} hasn’t switched on photoreal renders for visitors.`, { code: 'visitor_renders_off' });
        if (v.left <= 0) throw new HttpError(429, 'Today’s photoreal renders are used up. Try again tomorrow.', { code: 'daily_cap_reached' });
      }
      const design = designFor(rc, b, team);
      const img = imageOf(b.image);
      const busy = db.prepare("SELECT id FROM showroom_renders WHERE tenant_id = ? AND user_id = ? AND status = 'pending' LIMIT 1").get(tenant.id, rc.user.id);
      if (busy) throw new HttpError(409, 'A render is already on its way. Wait for it to finish.', { code: 'render_in_progress', renderId: busy.id });
      const scene = cleanScene(b.scene, { showroom: tenant.name, designName: design.name });
      if (!scene.camera.widthPx) scene.camera.widthPx = img.width;
      if (!scene.camera.heightPx) scene.camera.heightPx = img.height;
      const id = newId();
      tx(() => {
        // Free again inside the transaction, so two requests can't both take the last free one.
        const isFree = free && freeLeft(rc.user.id) > 0;
        if (free && !isFree) throw new HttpError(409, 'Your free photoreal renders were just used. Try again.', { code: 'free_used' });
        // The cap again inside the transaction, so two visitors can't both take the last one.
        if (!isFree && !team && visitorAllowance(tenant).left <= 0) throw new HttpError(429, 'Today’s photoreal renders are used up. Try again tomorrow.', { code: 'daily_cap_reached' });
        const hold = isFree ? null : credits.reserve(tenant.id, costCents(), { purpose: 'render', ref: id, by: rc.user.id });
        const input = files.saveBuffer(img.buf, { kind: 'image', visibility: 'private', ownerUserId: rc.user.id, tenantId: tenant.id, originalName: `view-${id}.${img.mime.split('/')[1]}` });
        db.prepare(
          `INSERT INTO showroom_renders (id, tenant_id, user_id, by_role, project_id, design_name, status, provider, cost_cents, hold_id, free, input_file_id, scene, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, tenant.id, rc.user.id, role, design.projectId, design.name.slice(0, 120), provider.id, isFree ? 0 : costCents(), hold?.id ?? null, isFree ? 1 : 0, input.id, JSON.stringify(scene), now());
      });
      // Registered before it runs, so its own `finally` always finds the entry to remove.
      inflight.set(id, Promise.resolve().then(() => run(id, { image: img.buf, mime: img.mime, scene, provider })));
      return wire(row(id), { team, userId: rc.user.id });
    },

    /** A render this person may see on this showroom (the team: any; a visitor: their own), or null. */
    visible(rc, id) {
      const r = row(id);
      if (!r || r.tenant_id !== rc.tenant?.id || r.hidden_at) return null;
      const team = !!rc.memberRole;
      if (!team && r.user_id !== rc.user?.id) return null;
      return r;
    },

    get(rc, id) {
      if (rc.tenant) sweep(rc.tenant.id);
      const r = svc.visible(rc, id);
      if (!r) throw new HttpError(404, 'That render doesn’t exist.');
      return wire(r, { team: !!rc.memberRole, userId: rc.user?.id, detail: true });
    },

    /** The bytes of a render's result ('image') or captured view ('input'): { path, ext } or null. */
    blob(rc, id, which) {
      const r = svc.visible(rc, id);
      const fileId = r ? (which === 'input' ? r.input_file_id : r.status === 'done' || r.status === 'refunded' ? r.output_file_id : null) : null;
      const f = fileId ? files.get(fileId) : null;
      return f ? { path: files.blobPath(f.sha256, f.ext), ext: f.ext } : null;
    },

    /**
     * Renders, newest first. A design's (`projectId`) or, for the team without one, every render
     * of the showroom; a visitor sees only their own. `before` pages by createdAt.
     */
    list(rc, { projectId, shareToken, before, limit = 30 } = {}) {
      const tenantId = rc.tenant.id;
      sweep(tenantId);
      const team = !!rc.memberRole;
      // The team, on a lead's design opened from its share link: that design's renders.
      if (!projectId && shareToken) {
        if (!team) return { renders: [], more: false };
        try {
          projectId = designFor(rc, { shareToken }, true).projectId;
        } catch {
          return { renders: [], more: false };
        }
      }
      const n = Math.max(1, Math.min(100, Number(limit) || 30));
      const where = ['tenant_id = ?', 'hidden_at IS NULL'];
      const args = [tenantId];
      if (!team) {
        where.push('user_id = ?');
        args.push(rc.user.id);
      }
      if (typeof projectId === 'string' && projectId) {
        where.push('project_id = ?');
        args.push(projectId);
      }
      if (Number.isInteger(before)) {
        where.push('created_at < ?');
        args.push(before);
      }
      const rows = db.prepare(`SELECT * FROM showroom_renders WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...args, n + 1);
      return { renders: rows.slice(0, n).map((r) => wire(r, { team, userId: rc.user.id })), more: rows.length > n };
    },

    /** Takes a render out of the gallery (the row, its files and the ledger stay). */
    hide(rc, id) {
      const r = svc.visible(rc, id);
      if (!r) throw new HttpError(404, 'That render doesn’t exist.');
      if (r.status === 'pending') throw new HttpError(409, 'Wait for the render to finish first.', { code: 'render_in_progress' });
      if (!rc.memberRole && r.user_id !== rc.user.id) throw new HttpError(404, 'That render doesn’t exist.');
      db.prepare('UPDATE showroom_renders SET hidden_at = ? WHERE id = ?').run(now(), r.id);
      return { ok: true };
    },

    /** Usage for the workspace and Admin > Tenants. */
    usage(tenantId) {
      const t = now();
      const q = (sql, ...a) => Number(db.prepare(sql).get(tenantId, ...a).n);
      return {
        total: q("SELECT COUNT(*) AS n FROM showroom_renders WHERE tenant_id = ? AND status = 'done'"),
        thisMonth: q("SELECT COUNT(*) AS n FROM showroom_renders WHERE tenant_id = ? AND status = 'done' AND created_at >= ?", monthStart(t)),
        visitorToday: visitorUsedToday(tenantId),
        failedThisMonth: q("SELECT COUNT(*) AS n FROM showroom_renders WHERE tenant_id = ? AND status = 'failed' AND created_at >= ?", monthStart(t)),
        spentThisMonthCents: q("SELECT COALESCE(SUM(cost_cents), 0) AS n FROM showroom_renders WHERE tenant_id = ? AND status = 'done' AND created_at >= ?", monthStart(t)),
      };
    },

    /** An admin gives a done render's credits back. The caller audits. */
    refund(tenantId, id, { note = '', by = null } = {}) {
      return tx(() => {
        const r = row(id);
        if (!r || r.tenant_id !== tenantId) throw new HttpError(404, 'That render doesn’t exist.');
        if (r.status !== 'done') throw new HttpError(409, 'Only a finished render can be refunded.', { code: 'render_not_done' });
        if (!r.hold_id) throw new HttpError(409, 'That was a free render: there are no credits to give back.', { code: 'render_free' });
        credits.refund(r.hold_id, { note: note || 'Render refunded', by });
        db.prepare("UPDATE showroom_renders SET status = 'refunded' WHERE id = ?").run(id);
        return wire(row(id), { team: true });
      });
    },

    /** Resolves when every render in flight here has finished (tests, shutdown). */
    async settled() {
      while (inflight.size) await Promise.allSettled([...inflight.values()]);
    },
  };
  return svc;
}
