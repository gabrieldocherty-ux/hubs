// The platform schema: roles, uploads, brands, products and analytics events.
// DDL is BUILD_PLAN §3.3, verbatim.

export const steps = [
  {
    id: 'platform-001-roles-files-brands-products',
    up(db) {
      db.exec(`
        ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','studio','admin'));
        CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

        CREATE TABLE files (
          id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, ext TEXT NOT NULL CHECK (ext IN ('glb','png','jpg','webp')),
          mime TEXT NOT NULL, size_bytes INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('model','image','reference')),
          visibility TEXT NOT NULL CHECK (visibility IN ('public','private')),
          owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, brand_id TEXT REFERENCES brands(id) ON DELETE SET NULL,
          original_name TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
        CREATE INDEX files_sha ON files(sha256);
        CREATE INDEX files_owner ON files(owner_user_id);
        CREATE TABLE file_grants (file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, PRIMARY KEY (file_id, user_id));

        CREATE TABLE brands (
          id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, tagline TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', logo_file_id TEXT REFERENCES files(id),
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','suspended')),
          status_note TEXT NOT NULL DEFAULT '', verified_at INTEGER, is_demo INTEGER NOT NULL DEFAULT 0,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE brand_members (brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, member_role TEXT NOT NULL CHECK (member_role IN ('owner','editor')),
          created_at INTEGER NOT NULL, PRIMARY KEY (brand_id, user_id));
        CREATE INDEX brand_members_user ON brand_members(user_id);

        CREATE TABLE products (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL CHECK (source IN ('brand','custom')),
          brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE, owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','published','rejected','archived')),
          visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
          spec TEXT NOT NULL, live_spec TEXT,
          kind TEXT NOT NULL, category TEXT NOT NULL, name TEXT NOT NULL, price_cents INTEGER NOT NULL DEFAULT 0,
          revision INTEGER NOT NULL DEFAULT 1, review_note TEXT NOT NULL DEFAULT '',
          submitted_at INTEGER, published_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE INDEX products_brand ON products(brand_id);
        CREATE INDEX products_owner ON products(owner_user_id);
        CREATE INDEX products_status ON products(status, visibility);

        CREATE TABLE product_events (id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, brand_id TEXT,
          type TEXT NOT NULL CHECK (type IN ('view','add','buy_click','render')), user_id TEXT, day TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE INDEX product_events_brand_day ON product_events(brand_id, day);
        CREATE INDEX product_events_product_day ON product_events(product_id, day);
      `);
    },
  },
];
