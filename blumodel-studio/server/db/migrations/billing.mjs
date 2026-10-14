// Package billing's migrations (BUILD_PLAN §13.1, §14 G-T1). Append steps; never edit or
// reorder an applied one. A step may reference only foundation tables and its own.
//
//   subscriptions      one row per user: Unlimited or Contractor, its status and period
//   kitchen_unlocks    kitchens unlocked with a one-time $5 payment (forever)
//   billing_checkouts  every checkout we started, demo or Stripe, and how it ended
//   billing_payments   receipts: unlocks, first payments and renewals
//   export_events      who exported what, when (never the file itself)
//   billing_stripe_products  the Stripe Product per plan, created on first plan change

/** @type {{ id: string, up: (db: import('node:sqlite').DatabaseSync) => void }[]} */
export const steps = [
  {
    id: 'billing-001-plans-unlocks-exports',
    up(db) {
      db.exec(`
        CREATE TABLE subscriptions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          plan TEXT NOT NULL CHECK (plan IN ('unlimited','contractor')),
          status TEXT NOT NULL CHECK (status IN ('active','past_due','canceled','incomplete')),
          provider TEXT NOT NULL CHECK (provider IN ('demo','stripe')),
          customer_ref TEXT,
          subscription_ref TEXT UNIQUE,
          current_period_end INTEGER,
          cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
          grace_until INTEGER,
          canceled_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL);

        CREATE TABLE kitchen_unlocks (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider TEXT NOT NULL CHECK (provider IN ('demo','stripe')),
          payment_ref TEXT UNIQUE,
          amount_cents INTEGER NOT NULL,
          created_at INTEGER NOT NULL);
        CREATE INDEX kitchen_unlocks_user ON kitchen_unlocks(user_id);

        CREATE TABLE billing_checkouts (
          ref TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('kitchen_unlock','subscription')),
          project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
          project_name TEXT NOT NULL DEFAULT '',
          plan TEXT CHECK (plan IN ('unlimited','contractor')),
          amount_cents INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'usd',
          status TEXT NOT NULL CHECK (status IN ('pending','completed','failed','canceled','expired')),
          provider TEXT NOT NULL CHECK (provider IN ('demo','stripe')),
          provider_ref TEXT UNIQUE,
          return_to TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          completed_at INTEGER);
        CREATE INDEX billing_checkouts_user ON billing_checkouts(user_id, created_at);

        CREATE TABLE billing_payments (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('kitchen_unlock','subscription','renewal')),
          plan TEXT,
          project_id TEXT,
          project_name TEXT NOT NULL DEFAULT '',
          amount_cents INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'usd',
          provider TEXT NOT NULL CHECK (provider IN ('demo','stripe')),
          ref TEXT UNIQUE,
          created_at INTEGER NOT NULL);
        CREATE INDEX billing_payments_user ON billing_payments(user_id, created_at);

        CREATE TABLE export_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('plan_png','scene_png','csv','json','render','quote')),
          created_at INTEGER NOT NULL);
        CREATE INDEX export_events_project ON export_events(project_id, created_at);

        CREATE TABLE billing_stripe_products (
          plan TEXT PRIMARY KEY CHECK (plan IN ('unlimited','contractor')),
          product_id TEXT NOT NULL,
          created_at INTEGER NOT NULL);
      `);
    },
  },
];
