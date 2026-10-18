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
//   protect-003  a showroom monthly payment can be refunded or disputed (charged back): tenant_payments
//                gains the Stripe payment intent and charge it was paid with (to find it from a
//                charge.refunded / charge.dispute.created event), and what happened to it (status,
//                refunded_cents, reversed_at); tenants gain review_reason / review_at, a flag for
//                Admin > Companies ("needs review") until an admin clears it.

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
  {
    id: 'protect-003-payment-reversals',
    up(db) {
      db.exec(`
        ALTER TABLE tenant_payments ADD COLUMN payment_intent TEXT;
        ALTER TABLE tenant_payments ADD COLUMN charge_ref TEXT;
        ALTER TABLE tenant_payments ADD COLUMN status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','partially_refunded','refunded','disputed'));
        ALTER TABLE tenant_payments ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE tenant_payments ADD COLUMN reversed_at INTEGER;
        CREATE INDEX tenant_payments_intent ON tenant_payments(payment_intent) WHERE payment_intent IS NOT NULL;
        CREATE INDEX tenant_payments_charge ON tenant_payments(charge_ref) WHERE charge_ref IS NOT NULL;
        ALTER TABLE tenants ADD COLUMN review_reason TEXT;
        ALTER TABLE tenants ADD COLUMN review_at INTEGER;
      `);
    },
  },
];
