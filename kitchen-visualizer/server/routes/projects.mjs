// Saved kitchens. Every query is scoped to the owner; another user's kitchen is a 404.
// Saves are optimistic: `revision` is required (unless `force: true`) and the write is a
// conditional UPDATE, so of two saves from the same revision exactly one wins.

import crypto from 'node:crypto';
import { HttpError } from '../http/respond.mjs';
import { normalizeDoc } from '../lib/doc.mjs';

export const MAX_DOC = 600_000;
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** @param {any} ctx */
export default function routes(ctx) {
  const { db } = ctx;

  const projectWire = (r, withDoc = true) => ({
    id: r.id,
    name: r.name,
    client: r.client,
    revision: r.revision,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(withDoc ? { doc: JSON.parse(r.doc) } : {}),
  });

  const owned = (userId, id) => {
    const row = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, userId);
    if (!row) throw new HttpError(404, 'That kitchen does not exist.');
    return row;
  };

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
      handler: (rc) => ({
        projects: db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC').all(rc.user.id).map((r) => projectWire(r)),
      }),
    },
    {
      method: 'POST',
      path: '/api/projects',
      handler: (rc) => {
        const name = str(rc.body.name, 120) || 'Untitled Kitchen';
        const client = str(rc.body.client, 120);
        const doc = serialise(rc.body.doc, name);
        const id = crypto.randomUUID();
        const t = ctx.now();
        db.prepare('INSERT INTO projects (id, user_id, name, client, doc, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)').run(id, rc.user.id, name, client, doc, t, t);
        rc.send(201, { project: projectWire(owned(rc.user.id, id)) });
      },
    },
    {
      method: 'GET',
      path: '/api/projects/:id',
      handler: (rc) => ({ project: projectWire(owned(rc.user.id, rc.params.id)) }),
    },
    {
      method: 'DELETE',
      path: '/api/projects/:id',
      handler: (rc) => {
        owned(rc.user.id, rc.params.id);
        db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(rc.params.id, rc.user.id);
        return { ok: true };
      },
    },
    {
      method: 'PUT',
      path: '/api/projects/:id',
      handler: (rc) => {
        const body = rc.body;
        const id = rc.params.id;
        const row = owned(rc.user.id, id);
        const force = body.force === true;
        if (!force && typeof body.revision !== 'number') throw new HttpError(400, 'Reload this kitchen to get the latest version, then try again.');
        const conflict = (current) => rc.send(409, { error: 'This kitchen was changed somewhere else.', project: projectWire(current) });
        if (!force && body.revision !== row.revision) return conflict(row);

        const name = body.name !== undefined ? str(body.name, 120) || row.name : row.name;
        const client = body.client !== undefined ? str(body.client, 120) : row.client;
        let doc = row.doc;
        if (body.doc !== undefined) doc = serialise(body.doc, name);
        else if (name !== row.name) doc = JSON.stringify({ ...JSON.parse(row.doc), name });

        const res = force
          ? db.prepare('UPDATE projects SET name = ?, client = ?, doc = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ?').run(name, client, doc, ctx.now(), id, rc.user.id)
          : db
              .prepare('UPDATE projects SET name = ?, client = ?, doc = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?')
              .run(name, client, doc, ctx.now(), id, rc.user.id, body.revision);
        if (!res.changes) return conflict(owned(rc.user.id, id));
        return { project: projectWire(owned(rc.user.id, id)) };
      },
    },
    {
      method: 'POST',
      path: '/api/projects/:id/duplicate',
      body: 'none',
      handler: (rc) => {
        const src = owned(rc.user.id, rc.params.id);
        const nid = crypto.randomUUID();
        const t = ctx.now();
        const name = `${src.name} (copy)`.slice(0, 120);
        const doc = JSON.stringify({ ...JSON.parse(src.doc), name });
        db.prepare('INSERT INTO projects (id, user_id, name, client, doc, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)').run(nid, rc.user.id, name, src.client, doc, t, t);
        rc.send(201, { project: projectWire(owned(rc.user.id, nid)) });
      },
    },
  ];
}
