// The company workspace's schema (docs/SHOWROOM_PIVOT.md §5 "Products"; server/routes/workspace.mjs).
// Append steps; never edit or reorder an applied one. Ids are "workspace-NNN-name".
//
//   workspace-001  tenant_pricing (a showroom's default markup), tenant_product_prices (what the
//                  company pays for one of its products and its markup: private to the team; the
//                  price visitors see stays the product's own `price`), tenant_product_requests
//                  ("Request more products": the products a company wants us to model, quoted by
//                  our studio, never paid in the app) and tenant_product_request_events (each
//                  request's timeline)

export const steps = [
  {
    id: 'workspace-001-pricing-requests',
    up(db) {
      db.exec(`
        CREATE TABLE tenant_pricing (
          tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
          default_markup_pct REAL NOT NULL DEFAULT 0 CHECK (default_markup_pct >= 0 AND default_markup_pct <= 1000),
          updated_at INTEGER NOT NULL,
          updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE tenant_product_prices (
          product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          cost_cents INTEGER CHECK (cost_cents IS NULL OR cost_cents >= 0),
          cost_by_width TEXT,
          markup_pct REAL CHECK (markup_pct IS NULL OR (markup_pct >= 0 AND markup_pct <= 1000)),
          updated_at INTEGER NOT NULL,
          updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX tenant_product_prices_tenant ON tenant_product_prices(tenant_id);

        CREATE TABLE tenant_product_requests (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          status TEXT NOT NULL CHECK (status IN ('requested','quoted','approved','in_progress','delivered','declined','cancelled')),
          items TEXT NOT NULL,
          item_count INTEGER NOT NULL CHECK (item_count >= 1),
          note TEXT NOT NULL DEFAULT '',
          quote_cents INTEGER CHECK (quote_cents IS NULL OR quote_cents >= 0),
          quote_currency TEXT NOT NULL DEFAULT 'cad',
          quote_note TEXT NOT NULL DEFAULT '',
          quote_days INTEGER,
          quote_included INTEGER NOT NULL DEFAULT 0,
          quoted_at INTEGER,
          quoted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          approved_at INTEGER,
          approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
          delivered_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX tenant_product_requests_tenant ON tenant_product_requests(tenant_id, created_at);
        CREATE INDEX tenant_product_requests_status ON tenant_product_requests(status, created_at);

        CREATE TABLE tenant_product_request_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id TEXT NOT NULL REFERENCES tenant_product_requests(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          from_status TEXT,
          to_status TEXT,
          by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          by_side TEXT NOT NULL CHECK (by_side IN ('company','studio','system')),
          note TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL
        );
        CREATE INDEX tenant_product_request_events_request ON tenant_product_request_events(request_id, id);
      `);
    },
  },
];
