import { call, upload } from '../../lib/api';
import type { FileWire } from '../../types/platform';

const enc = encodeURIComponent;

/** Package D's calls ("Start from a photo"). */
export const generateApi = {
  /** A reference photo: always private to the uploader (files API, `kind=reference`). */
  uploadPhoto: (blob: Blob, name: string) => upload<{ file: FileWire }>('/api/files', blob, { kind: 'reference', name }),
  /** Photos → a PhotoModel (503 when photo analysis isn't configured on this server). */
  analyze: (fileIds: string[], signal?: AbortSignal) => call<{ model: unknown; warnings: string[] }>('POST', '/api/generate/photo', { fileIds }, { signal }),
  /** The reference photos a kitchen was started from (owner only). */
  photosOf: (projectId: string) => call<{ files: FileWire[] }>('GET', `/api/generate/photos/${enc(projectId)}`),
  attachPhotos: (projectId: string, fileIds: string[]) => call<{ files: FileWire[] }>('PUT', `/api/generate/photos/${enc(projectId)}`, { fileIds }),
};
