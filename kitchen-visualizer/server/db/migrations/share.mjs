// Package share's migrations (BUILD_PLAN §9 E-T1). Append steps; never edit or reorder an
// applied one. Ids are "share-NNN-name". A step may reference only foundation tables and
// this module's own tables.
//
// share_links: view-only links to a saved kitchen (`#/s/:token`). The token is 24 random
// bytes, base64url (192 bits), stored so the owner can copy a link again; revoking sets
// revoked_at rather than deleting, so the shared page can say the link was turned off.

/** @type {{ id: string, up: (db: import('node:sqlite').DatabaseSync) => void }[]} */
export const steps = [
  {
    id: 'share-001-share-links',
    up(db) {
      db.exec(`
        CREATE TABLE share_links (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          token TEXT NOT NULL UNIQUE,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          label TEXT NOT NULL DEFAULT '',
          show_prices INTEGER NOT NULL DEFAULT 1,
          expires_at INTEGER,
          revoked_at INTEGER,
          view_count INTEGER NOT NULL DEFAULT 0,
          last_viewed_at INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX share_links_project ON share_links(project_id, created_at DESC);
      `);
    },
  },
];
