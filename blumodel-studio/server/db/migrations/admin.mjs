// The owner's admin panel (Admin > Users, Contractors, System, Audit). Steps reference only their
// own tables and foundation tables. Append steps; never edit or reorder an applied one. Ids are
// "admin-001-name".
//
//   account_status     one row per DISABLED account: it can't sign in and its sessions were ended
//                      when it was disabled. Enabling the account deletes the row. Kept out of the
//                      users table so nothing else that reads users has to know about it.
//   webhook_failures   Stripe webhook deliveries this server refused or failed (bad signature,
//                      malformed body, Stripe not on, a handler that threw): when, why and the
//                      event type if it could be read. Never the body, the signature header or any
//                      secret. The newest 200 are kept.
//   indexes            admin_audit by action and by admin (the audit viewer's filters); users by
//                      created_at (sign-ups this week / month).
//   prospects          (admin-002) the companies we reach out to: the outreach list imported from its
//                      spreadsheet (Admin > Prospects), with where each one stands. Business contact
//                      details only (the company's published phone, email and web address). `key` is
//                      what makes a re-import update a row instead of adding it twice.

/** @type {{ id: string, up: (db: import('node:sqlite').DatabaseSync) => void }[]} */
export const steps = [
  {
    id: 'admin-001-status-webhook-failures',
    up(db) {
      db.exec(`
        CREATE TABLE account_status (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          disabled_at INTEGER NOT NULL,
          disabled_by TEXT,
          reason TEXT NOT NULL DEFAULT '');

        CREATE TABLE webhook_failures (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at INTEGER NOT NULL,
          provider TEXT NOT NULL,
          reason TEXT NOT NULL,
          event_type TEXT NOT NULL DEFAULT '',
          status INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX webhook_failures_at ON webhook_failures(at);

        CREATE INDEX IF NOT EXISTS admin_audit_action ON admin_audit(action, at);
        CREATE INDEX IF NOT EXISTS admin_audit_admin ON admin_audit(admin_user_id, at);
        CREATE INDEX IF NOT EXISTS users_created ON users(created_at);
      `);
    },
  },
  {
    id: 'admin-002-prospects',
    up(db) {
      db.exec(`
        CREATE TABLE prospects (
          id TEXT PRIMARY KEY,
          key TEXT NOT NULL UNIQUE,
          company TEXT NOT NULL,
          city TEXT NOT NULL DEFAULT '',
          province TEXT NOT NULL DEFAULT '',
          type TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          website TEXT NOT NULL DEFAULT '',
          address TEXT NOT NULL DEFAULT '',
          contact_name TEXT NOT NULL DEFAULT '',
          contact_role TEXT NOT NULL DEFAULT '',
          fit INTEGER,
          pitch TEXT NOT NULL DEFAULT '',
          outreach TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          stage TEXT NOT NULL DEFAULT 'new',
          admin_notes TEXT NOT NULL DEFAULT '',
          emailed_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL);
        CREATE INDEX prospects_stage ON prospects(stage, emailed_at);
        CREATE INDEX prospects_company ON prospects(company);
      `);
    },
  },
];
