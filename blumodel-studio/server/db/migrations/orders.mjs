// Package C (orders) migrations: custom-model orders, their items, their timeline and the
// payment events seen for them (BUILD_PLAN §7 C-T1, §13.3).
// Append steps; never edit or reorder an applied one. Ids are "orders-001-name".
// A step may reference only foundation tables and this module's own tables.
//
// Notes on the shape:
// - An order holds its items (1–20 under the old tiers, 1–40 in Model packs since orders-002;
//   several products, one checkout). The
//   order's `tier`, `brief` and `deliverable_product_id` mirror its first item, so the
//   single-item wire (`Order` in src/types/platform.ts) still reads naturally.
// - `user_id` is SET NULL on delete so revenue history survives an account deletion.
// - The Stripe webhook route dedupes in the foundation's `webhook_events`; `payment_events`
//   is this package's audit of the payment events that touched an order (demo and Stripe).

/** @type {{ id: string, up: (db: import('node:sqlite').DatabaseSync) => void }[]} */
export const steps = [
  {
    id: 'orders-001-orders',
    up(db) {
      db.exec(`
        CREATE TABLE orders (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          target TEXT NOT NULL CHECK (target IN ('customer','brand','contractor')),
          brand_id TEXT REFERENCES brands(id) ON DELETE SET NULL,
          status TEXT NOT NULL CHECK (status IN ('draft','pending_payment','payment_failed','paid','in_progress','delivered',
                                                 'revision_requested','completed','cancelled','refunded','expired')),
          tier TEXT NOT NULL CHECK (tier IN ('simple','standard','complex')),
          extras TEXT NOT NULL DEFAULT '{}',
          amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
          currency TEXT NOT NULL DEFAULT 'usd',
          provider TEXT NOT NULL CHECK (provider IN ('demo','stripe')),
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
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX orders_user ON orders(user_id, created_at);
        CREATE INDEX orders_status ON orders(status, paid_at);
        CREATE INDEX orders_payment_intent ON orders(payment_intent);

        CREATE TABLE order_items (
          order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          idx INTEGER NOT NULL,
          brief TEXT NOT NULL,
          tier TEXT NOT NULL CHECK (tier IN ('simple','standard','complex')),
          extra_finishes INTEGER NOT NULL DEFAULT 0,
          amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
          deliverable_product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
          delivered_at INTEGER,
          PRIMARY KEY (order_id, idx)
        );

        CREATE TABLE order_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          from_status TEXT,
          to_status TEXT,
          by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          note TEXT NOT NULL DEFAULT '',
          data TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX order_events_order ON order_events(order_id, id);

        CREATE TABLE payment_events (
          provider TEXT NOT NULL,
          event_id TEXT NOT NULL,
          type TEXT NOT NULL,
          order_id TEXT,
          received_at INTEGER NOT NULL,
          payload TEXT,
          PRIMARY KEY (provider, event_id)
        );
        CREATE INDEX payment_events_order ON payment_events(order_id);
      `);
    },
  },
  {
    // The Model pack replaces the per-product tiers (2026-10-14): new orders and their items are
    // tier 'pack'. SQLite can't alter a CHECK, so `orders` and `order_items` are rebuilt (create,
    // copy every column by name, drop, rename) with foreign keys off: order_items and
    // order_events reference orders(id) ON DELETE CASCADE, and dropping the old table with
    // foreign keys on would delete them. Every existing row, price and status is copied as is.
    // The indexes go with the old tables, so they are made again, including ops' (IF NOT
    // EXISTS, so ops' own step is still a no-op on a fresh database).
    id: 'orders-002-model-pack',
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
          tier TEXT NOT NULL CHECK (tier IN ('pack','simple','standard','complex')),
          extras TEXT NOT NULL DEFAULT '{}',
          amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
          currency TEXT NOT NULL DEFAULT 'usd',
          provider TEXT NOT NULL CHECK (provider IN ('demo','stripe')),
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
          updated_at INTEGER NOT NULL
        );
        INSERT INTO orders_next (${orderCols}) SELECT ${orderCols} FROM orders;
        DROP TABLE orders;
        ALTER TABLE orders_next RENAME TO orders;
        CREATE INDEX orders_user ON orders(user_id, created_at);
        CREATE INDEX orders_status ON orders(status, paid_at);
        CREATE INDEX orders_payment_intent ON orders(payment_intent);
        CREATE INDEX IF NOT EXISTS orders_provider_paid ON orders(provider, paid_at);

        CREATE TABLE order_items_next (
          order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          idx INTEGER NOT NULL,
          brief TEXT NOT NULL,
          tier TEXT NOT NULL CHECK (tier IN ('pack','simple','standard','complex')),
          extra_finishes INTEGER NOT NULL DEFAULT 0,
          amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
          deliverable_product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
          delivered_at INTEGER,
          PRIMARY KEY (order_id, idx)
        );
        INSERT INTO order_items_next (${itemCols}) SELECT ${itemCols} FROM order_items;
        DROP TABLE order_items;
        ALTER TABLE order_items_next RENAME TO order_items;
      `);
    },
  },
];
