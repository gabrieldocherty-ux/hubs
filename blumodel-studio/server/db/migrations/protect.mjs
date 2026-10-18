// The 2026-10 protection audit (docs/handoff/data-lifecycle.md). Append steps; never edit or reorder
// an applied one. Ids are "protect-NNN-name". This module runs last, so a step may reference any table.
//
//   protect-001  tenant_invites gains token_hash / expires_at: an invite held for an address that
//                already has an account on the showroom is accepted with a link EMAILED to that
//                address plus the account's own password. The link is never shown to whoever
//                invited, and accepting it never changes the account's password.

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
];
