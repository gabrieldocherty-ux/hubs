// Account settings (the 'account' package): preferences, signed-in devices, a phone number, and
// password-reset links. Steps reference only the foundation's users and sessions tables. Append
// steps; never edit or reorder an applied one. Ids are "account-001-name".
//
//   users.phone        an optional contact number (Account settings > Profile), normalised
//   user_prefs         one JSON object per user: appearance, the cost estimator switch, sign-in
//                      alerts (server/account/prefs.mjs validates every key)
//   sessions.id        a public id for one signed-in device (the token's hash stays the key and is
//                      never sent anywhere); created_at / last_seen_at and the browser and system
//                      names (never the User-Agent string or an address) for Account > Security
//   password_resets    single-use reset links: only the SHA-256 of the token is stored, with a
//                      60-minute expiry; created_by is the admin who made the link, or NULL when
//                      the person asked for it by email

/** @type {{ id: string, up: (db: import('node:sqlite').DatabaseSync) => void }[]} */
export const steps = [
  {
    id: 'account-001-prefs-devices-resets',
    up(db) {
      db.exec(`
        ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT '';

        CREATE TABLE user_prefs (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          prefs TEXT NOT NULL DEFAULT '{}',
          updated_at INTEGER NOT NULL);

        ALTER TABLE sessions ADD COLUMN id TEXT;
        ALTER TABLE sessions ADD COLUMN created_at INTEGER;
        ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER;
        ALTER TABLE sessions ADD COLUMN browser TEXT NOT NULL DEFAULT '';
        ALTER TABLE sessions ADD COLUMN os TEXT NOT NULL DEFAULT '';
        UPDATE sessions SET id = lower(hex(randomblob(12))) WHERE id IS NULL;
        CREATE UNIQUE INDEX sessions_public_id ON sessions(id);

        CREATE TABLE password_resets (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          used_at INTEGER,
          created_by TEXT);
        CREATE INDEX password_resets_user ON password_resets(user_id, created_at);
      `);
    },
  },
];
