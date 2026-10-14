// Package contractors' migrations (BUILD_PLAN §13.1, §15 H-T1). Append steps; never edit
// or reorder an applied one. A step may reference only foundation tables and its own.
//
//   contractor_profiles  the company: branding, default markup, tax
//   carried_brands       which public brands (and Mise's built-ins) they carry, their
//                        discount off list and markup; also per-line ('line:<name>') and
//                        own-catalog ('own') markups
//   price_book           per-product cost (one, or per width) and markup override
//   contractor_quotes    per-kitchen quote settings: valid-until date and notes

/** @type {{ id: string, up: (db: import('node:sqlite').DatabaseSync) => void }[]} */
export const steps = [
  {
    id: 'contractors-001-profiles-brands-price-book',
    up(db) {
      db.exec(`
        CREATE TABLE contractor_profiles (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          company TEXT NOT NULL,
          logo_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
          phone TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          website TEXT NOT NULL DEFAULT '',
          service_area TEXT NOT NULL DEFAULT '',
          default_markup_pct REAL NOT NULL DEFAULT 30,
          tax_pct REAL NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL);

        CREATE TABLE carried_brands (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          brand_key TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          pct_off_list REAL,
          markup_pct REAL,
          PRIMARY KEY (user_id, brand_key));

        CREATE TABLE price_book (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          product_id TEXT NOT NULL,
          cost_cents INTEGER,
          cost_by_width TEXT,
          markup_pct REAL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, product_id));

        CREATE TABLE contractor_quotes (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          valid_until INTEGER,
          notes TEXT NOT NULL DEFAULT '',
          updated_at INTEGER NOT NULL);
      `);
    },
  },
];
