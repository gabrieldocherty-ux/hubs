// Package generate's migrations. Owned by package generate once the foundation lands.
// Append steps; never edit or reorder an applied one. Ids are "generate-001-name".
// A step may reference only foundation tables and this module's own tables.
//
//   generate_photo_refs   the reference photos a kitchen was started from (file ids, in order)

/** @type {{ id: string, up: (db: import('node:sqlite').DatabaseSync) => void }[]} */
export const steps = [
  {
    id: 'generate-001-photo-refs',
    up(db) {
      db.exec(`
        CREATE TABLE generate_photo_refs (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          file_ids TEXT NOT NULL DEFAULT '[]',
          updated_at INTEGER NOT NULL
        );
      `);
    },
  },
];
