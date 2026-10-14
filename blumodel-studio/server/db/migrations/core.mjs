// core-001 is the schema the single-file server created with CREATE IF NOT EXISTS,
// unchanged. Because it is idempotent, an existing mise.db (user_version 0) upgrades
// cleanly: the step is a no-op there and is simply recorded.

export const steps = [
  {
    id: 'core-001-initial',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          client TEXT NOT NULL DEFAULT '',
          doc TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS projects_user ON projects(user_id, updated_at DESC);
      `);
    },
  },
];
