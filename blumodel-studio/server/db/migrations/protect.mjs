// The 2026-10 protection audit (docs/handoff/data-lifecycle.md). Append steps; never edit or reorder
// an applied one. Ids are "protect-NNN-name". This module runs last, so a step may reference any table.
//
//   protect-001  tenant_invites gains token_hash / expires_at: an invite held for an address that
//                already has an account on the showroom is accepted with a link EMAILED to that
//                address plus the account's own password. The link is never shown to whoever
//                invited, and accepting it never changes the account's password.
//   protect-002  two-factor sign-in (server/auth/mfa.mjs): user_mfa, user_mfa_recovery, mfa_tickets;
//                sessions gain mfa_at (when this session passed a code; NULL: password only) and
//                auth_at (when it last proved the password: sign-in or re-authentication), for
//                the admin gate and the 10-minute re-authentication on dangerous admin actions.

/** @type {{ id: string, foreignKeys?: 'off', up: (db: import('node:sqlite').DatabaseSync) => void }[]} */
export const steps = [
  {
    id: 'protect-001-invite-tokens',
    up(db) {
      db.exec(`
        ALTER TABLE tenant_invites ADD COLUMN token_hash TEXT;
        ALTER TABLE tenant_invites ADD COLUMN expires_at INTEGER;
        CREATE UNIQUE INDEX tenant_invites_token ON tenant_invites(token_hash) WHERE token_hash IS NOT NULL;
      `);
    },
  },
  {
    id: 'protect-002-two-factor',
    up(db) {
      db.exec(`
        CREATE TABLE user_mfa (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          secret TEXT,
          enabled_at INTEGER,
          pending_secret TEXT,
          pending_at INTEGER,
          last_step INTEGER NOT NULL DEFAULT -1,
          created_at INTEGER NOT NULL);
        CREATE TABLE user_mfa_recovery (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          code_hash TEXT NOT NULL,
          used_at INTEGER,
          PRIMARY KEY (user_id, code_hash));
        CREATE TABLE mfa_tickets (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          tenant_id TEXT,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX mfa_tickets_expires ON mfa_tickets(expires_at);
        ALTER TABLE sessions ADD COLUMN mfa_at INTEGER;
        ALTER TABLE sessions ADD COLUMN auth_at INTEGER;
      `);
    },
  },
];
