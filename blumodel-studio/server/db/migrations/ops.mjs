// Launch operations (docs/LAUNCH.md): the admin audit log and indexes for the hot queries. This
// module runs last, so a step may reference any table. Append steps; never edit or reorder an
// applied one. Ids are "ops-001-name".
//
//   admin_audit   every admin action that changes money or access: complimentary plan grants and
//                 revocations, and exports an admin made without paying. Kept when the people in
//                 it delete their accounts (emails are copied in at the time).

/** @type {{ id: string, up: (db: import('node:sqlite').DatabaseSync) => void }[]} */
export const steps = [
  {
    id: 'ops-001-admin-audit-hot-indexes',
    up(db) {
      db.exec(`
        CREATE TABLE admin_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at INTEGER NOT NULL,
          admin_user_id TEXT,
          admin_email TEXT NOT NULL DEFAULT '',
          action TEXT NOT NULL,
          target_user_id TEXT,
          target_email TEXT NOT NULL DEFAULT '',
          detail TEXT NOT NULL DEFAULT '{}');
        CREATE INDEX admin_audit_at ON admin_audit(at);
        CREATE INDEX admin_audit_target ON admin_audit(target_user_id, at);

        -- sessions: the 10-minute purge and "sign out other devices"
        CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
        -- share links by who made them (account export / delete)
        CREATE INDEX IF NOT EXISTS share_links_created_by ON share_links(created_by);
        -- Admin > Billing: subscriptions and receipts per provider
        CREATE INDEX IF NOT EXISTS subscriptions_provider ON subscriptions(provider, status);
        CREATE INDEX IF NOT EXISTS billing_payments_provider ON billing_payments(provider, created_at);
        CREATE INDEX IF NOT EXISTS kitchen_unlocks_provider ON kitchen_unlocks(provider);
        -- exports by user (account export / delete)
        CREATE INDEX IF NOT EXISTS export_events_user ON export_events(user_id, created_at);
        -- /files/<sha>.<ext>: the public row for a blob
        CREATE INDEX IF NOT EXISTS files_blob ON files(sha256, ext, visibility);
        -- a user's brands of any kind (account export / delete)
        CREATE INDEX IF NOT EXISTS brands_owner ON brands(owner_user_id);
        -- orders: the studio queue and paid revenue by provider
        CREATE INDEX IF NOT EXISTS orders_provider_paid ON orders(provider, paid_at);
      `);
    },
  },
];
