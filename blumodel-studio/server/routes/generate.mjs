// Package generate's routes: "Start from a photo".
//
//   POST /api/generate/photo {fileIds}           photos → PhotoModel via the Anthropic API (when configured)
//   GET  /api/generate/photos/:projectId         the reference photos attached to a kitchen
//   PUT  /api/generate/photos/:projectId {fileIds}  attach (or replace) them; owner only
//
// Photos are uploaded through the files API (PUT /api/files?kind=reference: always private).

import fs from 'node:fs';
import { HttpError } from '../http/respond.mjs';
import { AnalysisError, MAX_PHOTOS, MAX_PHOTO_BYTES, analyzePhotos } from '../llm/anthropic.mjs';

const IMAGE_EXTS = new Set(['png', 'jpg', 'webp']);
const MB = 1024 * 1024;

function fileIdsOf(body, { min = 1 } = {}) {
  const ids = body?.fileIds;
  if (!Array.isArray(ids) || ids.length < min || ids.length > MAX_PHOTOS || !ids.every((x) => typeof x === 'string' && x.length <= 80)) {
    throw new HttpError(400, min ? `Choose 1 to ${MAX_PHOTOS} photos.` : `Attach at most ${MAX_PHOTOS} photos.`);
  }
  return [...new Set(ids)];
}

/** @param {any} ctx */
export default function routes(ctx) {
  const { config, db, services } = ctx;
  const { files } = services;

  /** The project, if `user` owns it; otherwise a 404 (no hint that it exists). */
  const ownProject = (user, id) => {
    const row = db.prepare('SELECT id, user_id FROM projects WHERE id = ?').get(String(id));
    if (!row || row.user_id !== user.id) throw new HttpError(404, 'Not found.');
    return row;
  };

  const photoList = (projectId, user, rc) => {
    const row = db.prepare('SELECT file_ids FROM generate_photo_refs WHERE project_id = ?').get(projectId);
    let ids = [];
    try {
      ids = JSON.parse(row?.file_ids || '[]');
    } catch {
      ids = [];
    }
    return ids
      .map((id) => files.get(id))
      .filter((f) => f && files.canRead(user, f, rc))
      .map((f) => files.toWire(f));
  };

  return [
    {
      method: 'POST',
      path: '/api/generate/photo',
      auth: 'user',
      maxBytes: 4_000,
      rateLimit: { name: 'generate-photo', max: 10, windowMs: 3_600_000, by: 'user' },
      handler: async (rc) => {
        if (!config.llmEnabled) throw new HttpError(503, 'Photo analysis is not configured.');
        const ids = fileIdsOf(rc.body);
        const images = [];
        for (const id of ids) {
          const file = files.get(id);
          // Someone else's photo looks exactly like a missing one.
          if (!file || !files.canRead(rc.user, file, rc)) throw new HttpError(404, 'Photo not found.', { fileId: id });
          if (!IMAGE_EXTS.has(file.ext)) throw new HttpError(400, 'That file isn’t a photo.', { fileId: id });
          if (file.sizeBytes > MAX_PHOTO_BYTES) {
            const name = file.originalName ? `“${file.originalName}”` : 'One photo';
            throw new HttpError(413, `${name} is ${(file.sizeBytes / MB).toFixed(1)} MB. Photo analysis takes photos up to 5 MB each: export a smaller copy (a phone’s “medium” size is plenty) and add it again.`, { fileId: id });
          }
          images.push({ ext: file.ext, bytes: fs.readFileSync(files.blobPath(file.sha256, file.ext)) });
        }
        try {
          const { model, warnings } = await analyzePhotos({ fetch: ctx.fetch, apiKey: config.ANTHROPIC_API_KEY, model: config.MISE_LLM_MODEL, images, log: ctx.log });
          return { model, warnings };
        } catch (err) {
          if (err instanceof AnalysisError) throw new HttpError(err.status, err.message);
          throw err;
        }
      },
    },
    {
      method: 'GET',
      path: '/api/generate/photos/:projectId',
      auth: 'user',
      handler: (rc) => {
        ownProject(rc.user, rc.params.projectId);
        return { files: photoList(rc.params.projectId, rc.user, rc) };
      },
    },
    {
      method: 'PUT',
      path: '/api/generate/photos/:projectId',
      auth: 'user',
      maxBytes: 4_000,
      handler: (rc) => {
        const project = ownProject(rc.user, rc.params.projectId);
        const ids = fileIdsOf(rc.body, { min: 0 });
        for (const id of ids) {
          const file = files.get(id);
          // Only your own uploads can be attached (no borrowing someone else's file id).
          if (!file || file.ownerUserId !== rc.user.id) throw new HttpError(404, 'Photo not found.', { fileId: id });
          if (!IMAGE_EXTS.has(file.ext)) throw new HttpError(400, 'That file isn’t a photo.', { fileId: id });
        }
        db.prepare(
          `INSERT INTO generate_photo_refs (project_id, user_id, file_ids, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(project_id) DO UPDATE SET file_ids = excluded.file_ids, updated_at = excluded.updated_at`,
        ).run(project.id, rc.user.id, JSON.stringify(ids), ctx.now());
        return { files: photoList(project.id, rc.user, rc) };
      },
    },
  ];
}
