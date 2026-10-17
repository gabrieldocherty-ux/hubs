// Uploads and file serving (BUILD_PLAN §3.5). Public blobs are content-addressed and
// immutable; private bytes go through an authenticated route that never caches.
//
// Sites (docs/handoff/tenancy.md): on a showroom only its team uploads (files belong to the
// showroom), and a file is readable only by files.canReadOnSite: never another showroom's.

import { HttpError } from '../http/respond.mjs';
import { serveFile } from '../http/static.mjs';
import { mimeFor } from '../files/meta.mjs';

const SANDBOX = "default-src 'none'; sandbox";

/** @param {any} ctx */
export default function routes(ctx) {
  const { files, auth } = ctx.services;

  return [
    {
      method: 'PUT',
      path: '/api/files',
      body: 'none', // streamed by files.saveUpload
      // Per account, and per real address (many throwaway accounts behind one address).
      rateLimit: [
        { name: 'upload', max: 120, windowMs: 3_600_000, by: 'user' },
        { name: 'upload-ip', max: 300, windowMs: 3_600_000, by: 'ip' },
      ],
      handler: async (rc) => {
        const kind = rc.query.get('kind') || '';
        if (!['model', 'image', 'reference'].includes(kind)) throw new HttpError(400, 'Choose a file kind: model, image or reference.');
        if (rc.tenant && !rc.memberRole) throw new HttpError(403, 'Only the showroom’s team can upload files here.', { code: 'not_staff' });
        const brandId = rc.query.get('brandId') || null;
        if (brandId && rc.tenant) throw new HttpError(400, 'Brand files are uploaded on the BluModel Studio site.');
        if (brandId) auth.requireBrandMember(rc, brandId);
        const visibility = rc.query.get('visibility') === 'public' && kind !== 'reference' ? 'public' : 'private';
        const file = await files.saveUpload(rc, { kind, visibility, brandId, originalName: rc.query.get('name') || '' });
        rc.send(201, { file: files.toWire(file) });
      },
    },
    {
      method: 'GET',
      path: '/api/files/:id',
      auth: 'optional',
      handler: (rc) => {
        const file = files.get(rc.params.id);
        if (!file || !files.canReadOnSite(rc, file)) throw new HttpError(404, 'Not found.');
        return { file: files.toWire(file, { shareToken: rc.query.get('share') || undefined }) };
      },
    },
    {
      method: 'GET',
      path: '/api/files/:id/content',
      auth: 'optional',
      handler: (rc) => {
        const file = files.get(rc.params.id);
        if (!file || !files.canReadOnSite(rc, file)) throw new HttpError(404, 'Not found.');
        rc.sent = true;
        serveFile(rc.req, rc.res, files.blobPath(file.sha256, file.ext), {
          'Content-Type': mimeFor(file.ext),
          'Cache-Control': 'private, no-store',
          'Content-Security-Policy': SANDBOX,
          'Cross-Origin-Resource-Policy': 'same-origin',
        });
      },
    },
    {
      method: 'GET',
      path: '/files/:name',
      // optional: an admin or the studio on the sales site may see a showroom's files.
      auth: 'optional',
      params: { name: /^[0-9a-f]{64}\.(glb|png|jpg|webp)$/ },
      handler: (rc) => {
        const [sha, ext] = rc.params.name.split('.');
        const file = files.publicBlob(sha, ext, rc.site, rc.user ?? null);
        if (!file) throw new HttpError(404, 'Not found.');
        rc.sent = true;
        serveFile(rc.req, rc.res, files.blobPath(sha, ext), {
          'Content-Type': mimeFor(ext),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Content-Security-Policy': SANDBOX,
          'Cross-Origin-Resource-Policy': 'same-origin',
        });
      },
    },
  ];
}
