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
//   pricing-002  Custom models come with the Contractor plan: orders may be tier/provider 'plan'
//                (amount 0, straight to the studio), remember the allowance period they counted
//                against, and admins can grant extra models for a period (model_grants).

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
  {
    // Custom models are included in the Contractor plan (3 a month), not sold. A request made
    // against that allowance is an order with tier 'plan', provider 'plan' and amount 0; it goes
    // straight to the studio's queue. SQLite can't alter a CHECK, so `orders` and `order_items`
    // are rebuilt (create, copy every column by name, drop, rename) with foreign keys off, exactly
    // as orders-002 did: every existing row, price, currency and status is copied as it is, and
    // order_events keeps pointing at `orders`. The indexes go with the old tables, so they are made
    // again (including ops' orders_provider_paid).
    //   orders.plan_period_start / plan_period_end   the allowance period a request counted against
    //   model_grants   extra models an admin gave a contractor for one period (audit-logged too)
    id: 'pricing-002-included-models',
    foreignKeys: 'off',
    up(db) {
      const orderCols = `id, user_id, target, brand_id, status, tier, extras, amount_cents, currency, provider, provider_ref,
          payment_intent, checkout_attempts, brief, line, ref_product_id, deliverable_product_id, assigned_to, revisions_used,
          pending_since, due_at, paid_at, delivered_at, completed_at, refunded_at, refund_ref, created_at, updated_at`;
      const itemCols = 'order_id, idx, brief, tier, extra_finishes, amount_cents, deliverable_product_id, delivered_at';
      db.exec(`
        CREATE TABLE orders_next (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          target TEXT NOT NULL CHECK (target IN ('customer','brand','contractor')),
          brand_id TEXT REFERENCES brands(id) ON DELETE SET NULL,
          status TEXT NOT NULL CHECK (status IN ('draft','pending_payment','payment_failed','paid','in_progress','delivered',
                                                 'revision_requested','completed','cancelled','refunded','expired')),
          tier TEXT NOT NULL CHECK (tier IN ('plan','pack','simple','standard','complex')),
          extras TEXT NOT NULL DEFAULT '{}',
          amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
          currency TEXT NOT NULL DEFAULT 'usd',
          provider TEXT NOT NULL CHECK (provider IN ('demo','stripe','plan')),
          provider_ref TEXT UNIQUE,
          payment_intent TEXT,
          checkout_attempts INTEGER NOT NULL DEFAULT 0,
          brief TEXT NOT NULL,
          line TEXT NOT NULL DEFAULT '',
          ref_product_id TEXT,
          deliverable_product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
          assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
          revisions_used INTEGER NOT NULL DEFAULT 0,
          pending_since INTEGER NOT NULL,
          due_at INTEGER,
          paid_at INTEGER,
          delivered_at INTEGER,
          completed_at INTEGER,
          refunded_at INTEGER,
          refund_ref TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          plan_period_start INTEGER,
          plan_period_end INTEGER
        );
        INSERT INTO orders_next (${orderCols}) SELECT ${orderCols} FROM orders;
        DROP TABLE orders;
        ALTER TABLE orders_next RENAME TO orders;
        CREATE INDEX orders_user ON orders(user_id, created_at);
        CREATE INDEX orders_status ON orders(status, paid_at);
        CREATE INDEX orders_payment_intent ON orders(payment_intent);
        CREATE INDEX IF NOT EXISTS orders_provider_paid ON orders(provider, paid_at);
        CREATE INDEX orders_plan_user ON orders(user_id, tier, created_at);

        CREATE TABLE order_items_next (
          order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          idx INTEGER NOT NULL,
          brief TEXT NOT NULL,
          tier TEXT NOT NULL CHECK (tier IN ('plan','pack','simple','standard','complex')),
          extra_finishes INTEGER NOT NULL DEFAULT 0,
          amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
          deliverable_product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
          delivered_at INTEGER,
          PRIMARY KEY (order_id, idx)
        );
        INSERT INTO order_items_next (${itemCols}) SELECT ${itemCols} FROM order_items;
        DROP TABLE order_items;
        ALTER TABLE order_items_next RENAME TO order_items;

        CREATE TABLE model_grants (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          models INTEGER NOT NULL CHECK (models BETWEEN 1 AND 50),
          period_start INTEGER NOT NULL,
          period_end INTEGER NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX model_grants_user ON model_grants(user_id, period_end);
      `);
    },
  },
];
