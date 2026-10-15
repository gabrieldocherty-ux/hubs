// The 2026-10-15 pricing change (key 'pricing'): Canadian dollars, and custom models included
// in the Contractor plan instead of sold in packs. Append steps; never edit or reorder an applied
// one. Ids are "pricing-001-name".
//
// Unlike a package's own module, these steps touch other packages' tables (billing's and
// orders'), so this module runs after both, and after ops (whose index on orders it keeps).
//
//   pricing-001  Every new charge is in CAD. Rows stored before keep their currency: every
//                amount so far was charged in USD, so old rows are marked 'usd' explicitly.
//                - subscriptions.amount_cents / currency: what the subscription is billed at,
//                  so an existing subscription is never silently repriced (demo renewals and
//                  MRR read it). Backfilled with the old USD prices; complimentary plans have none.
//                - kitchen_unlocks.currency ('usd' for every existing unlock).
//                - billing_customers: the Stripe customer per user AND currency. A Stripe customer
//                  that has paid in USD can't be charged in CAD, so a CAD checkout starts a fresh
//                  customer and records it here. Backfilled with every stored customer as 'usd'.

/** @type {{ id: string, foreignKeys?: 'off', up: (db: import('node:sqlite').DatabaseSync) => void }[]} */
export const steps = [
  {
    id: 'pricing-001-cad',
    up(db) {
      db.exec(`
        ALTER TABLE subscriptions ADD COLUMN amount_cents INTEGER;
        ALTER TABLE subscriptions ADD COLUMN currency TEXT;
        UPDATE subscriptions
           SET amount_cents = CASE plan WHEN 'contractor' THEN 4000 ELSE 1500 END, currency = 'usd'
         WHERE provider IN ('demo', 'stripe');

        ALTER TABLE kitchen_unlocks ADD COLUMN currency TEXT NOT NULL DEFAULT 'usd';

        CREATE TABLE billing_customers (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          currency TEXT NOT NULL,
          customer_ref TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, currency));
        INSERT OR IGNORE INTO billing_customers (user_id, currency, customer_ref, created_at)
          SELECT user_id, 'usd', customer_ref, updated_at FROM subscriptions WHERE customer_ref IS NOT NULL AND customer_ref <> '';
      `);
    },
  },
];
