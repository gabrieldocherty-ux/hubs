// Saved kitchens. Every query is scoped to the owner AND the site (projects.tenant_id, tenancy-003:
// a kitchen saved on a showroom exists only there); another user's kitchen is a 404.
// The owner is the signed-in account or, on a showroom, the visitor who answered "Before you start"
// (their cookie, server/tenancy/leads.mjs; leads-001 projects.visitor_id): a visitor designs and
// saves without an account, and each design joins their lead (projects.lead_id).
// Saves are optimistic: `revision` is required (unless `force: true`) and the write is a
// conditional UPDATE, so of two saves from the same revision exactly one wins.

import crypto from 'node:crypto';
import { HttpError } from '../http/respond.mjs';
import { normalizeDoc } from '../lib/doc.mjs';
import { requestVisitor } from '../tenancy/leads.mjs';

export const MAX_DOC = 600_000;
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** Either owner column matches (a NULL never does). */
const MINE = '(user_id = ? OR visitor_id = ?)';

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, services } = ctx;

  const projectWire = (r, withDoc = true) => ({
    id: r.id,
    name: r.name,
    client: r.client,
    revision: r.revision,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(withDoc ? { doc: JSON.parse(r.doc) } : {}),
  });

  /** Who may open designs on this request: { userId, visitorId, visitor }; a 401 when neither. */
  const ownerOf = (rc) => {
    const visitor = requestVisitor(rc);
    const o = { userId: rc.user?.id ?? null, visitorId: visitor?.id ?? null, visitor };
    if (!o.userId && !o.visitorId) throw new HttpError(401, 'Please sign in.');
    return o;
  };

  const owned = (o, id, tenantId) => {
    const row = db.prepare(`SELECT * FROM projects WHERE id = ? AND ${MINE} AND tenant_id IS ?`).get(id, o.userId, o.visitorId, tenantId ?? null);
    if (!row) throw new HttpError(404, 'That kitchen does not exist.');
    return row;
  };

  /** The lead a new design joins on a showroom (the visitor's, else the account's), or null. */
  const leadFor = (rc, o) => (rc.site.tenantId ? services.leads.leadIdFor(rc.site.tenantId, { userId: o.userId, visitor: o.visitor }) : null);

  const insert = (row) =>
    db
      .prepare('INSERT INTO projects (id, user_id, visitor_id, lead_id, name, client, doc, revision, created_at, updated_at, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)')
      .run(row.id, row.userId, row.userId ? null : row.visitorId, row.leadId, row.name, row.client, row.doc, row.at, row.at, row.tenantId);

  /** Validates, names and serialises a doc; 400 for junk, 413 when too large. */
  const serialise = (doc, name) => {
    const v = normalizeDoc(doc);
    if (!v.ok) throw new HttpError(400, v.field === 'doc' || v.field === 'room' || v.field === 'surfaces' || v.field === 'items' ? 'That is not a kitchen design.' : v.message, { field: v.field });
    const json = JSON.stringify({ ...v.doc, name });
    if (json.length > MAX_DOC) throw new HttpError(413, 'That design is too large to save.');
    return json;
  };

  return [
    {
      method: 'GET',
      path: '/api/projects',
      auth: 'optional',
      handler: (rc) => {
        const o = ownerOf(rc);
        return {
          projects: db
            .prepare(`SELECT * FROM projects WHERE ${MINE} AND tenant_id IS ? ORDER BY updated_at DESC`)
            .all(o.userId, o.visitorId, rc.site.tenantId)
            .map((r) => projectWire(r)),
        };
      },
    },
    {
      method: 'POST',
      path: '/api/projects',
      auth: 'optional',
      handler: (rc) => {
        const o = ownerOf(rc);
        const name = str(rc.body.name, 120) || 'Untitled Kitchen';
        const client = str(rc.body.client, 120);
        const doc = serialise(rc.body.doc, name);
        const id = crypto.randomUUID();
        const leadId = leadFor(rc, o);
        ctx.tx(() => {
          insert({ id, userId: o.userId, visitorId: o.visitorId, leadId, name, client, doc, at: ctx.now(), tenantId: rc.site.tenantId });
          if (leadId) services.leads.designActivity(rc.site.tenantId, leadId, id, 'started', name);
        });
        rc.send(201, { project: projectWire(owned(o, id, rc.site.tenantId)) });
      },
    },
    {
      method: 'GET',
      path: '/api/projects/:id',
      auth: 'optional',
      handler: (rc) => ({ project: projectWire(owned(ownerOf(rc), rc.params.id, rc.site.tenantId)) }),
    },
    {
      method: 'DELETE',
      path: '/api/projects/:id',
      auth: 'optional',
      handler: (rc) => {
        const o = ownerOf(rc);
        owned(o, rc.params.id, rc.site.tenantId);
        db.prepare(`DELETE FROM projects WHERE id = ? AND ${MINE} AND tenant_id IS ?`).run(rc.params.id, o.userId, o.visitorId, rc.site.tenantId);
        return { ok: true };
      },
    },
    {
      method: 'PUT',
      path: '/api/projects/:id',
      auth: 'optional',
      handler: (rc) => {
        const body = rc.body;
        const id = rc.params.id;
        const o = ownerOf(rc);
        const row = owned(o, id, rc.site.tenantId);
        const force = body.force === true;
        if (!force && typeof body.revision !== 'number') throw new HttpError(400, 'Reload this kitchen to get the latest version, then try again.');
        const conflict = (current) => rc.send(409, { error: 'This kitchen was changed somewhere else.', project: projectWire(current) });
        if (!force && body.revision !== row.revision) return conflict(row);

        const name = body.name !== undefined ? str(body.name, 120) || row.name : row.name;
        const client = body.client !== undefined ? str(body.client, 120) : row.client;
        let doc = row.doc;
        if (body.doc !== undefined) doc = serialise(body.doc, name);
        else if (name !== row.name) doc = JSON.stringify({ ...JSON.parse(row.doc), name });

        const t = ctx.now();
        const res = force
          ? db.prepare(`UPDATE projects SET name = ?, client = ?, doc = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND ${MINE}`).run(name, client, doc, t, id, o.userId, o.visitorId)
          : db
              .prepare(`UPDATE projects SET name = ?, client = ?, doc = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND ${MINE} AND revision = ?`)
              .run(name, client, doc, t, id, o.userId, o.visitorId, body.revision);
        if (!res.changes) return conflict(owned(o, id, rc.site.tenantId));
        if (row.lead_id && rc.site.tenantId) services.leads.designActivity(rc.site.tenantId, row.lead_id, id, 'saved', name);
        return { project: projectWire(owned(o, id, rc.site.tenantId)) };
      },
    },
    {
      method: 'POST',
      path: '/api/projects/:id/duplicate',
      body: 'none',
      auth: 'optional',
      handler: (rc) => {
        const o = ownerOf(rc);
        const src = owned(o, rc.params.id, rc.site.tenantId);
        const nid = crypto.randomUUID();
        const t = ctx.now();
        const name = `${src.name} (copy)`.slice(0, 120);
        const doc = JSON.stringify({ ...JSON.parse(src.doc), name });
        ctx.tx(() => {
          insert({ id: nid, userId: src.user_id, visitorId: src.visitor_id, leadId: src.lead_id, name, client: src.client, doc, at: t, tenantId: rc.site.tenantId });
          // The photos a kitchen was started from (Start from a photo) go with its copy.
          db.prepare('INSERT INTO generate_photo_refs (project_id, user_id, file_ids, updated_at) SELECT ?, user_id, file_ids, ? FROM generate_photo_refs WHERE project_id = ?').run(nid, t, src.id);
          if (src.lead_id) services.leads.designActivity(rc.site.tenantId, src.lead_id, nid, 'started', name);
        });
        rc.send(201, { project: projectWire(owned(o, nid, rc.site.tenantId)) });
      },
    },
  ];
}
