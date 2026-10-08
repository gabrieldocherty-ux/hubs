// Package B2's migrations: the brand page inside the Contractor account (BRAND_PAGE.md §10).
// Append steps; never edit or reorder an applied one. Ids are "brands-001-name". A step may
// reference only foundation tables and this module's own tables.
//
//   brands (foundation)   gains kind, owner, cover, price display, contact toggles, the
//                         review timestamps and hidden_reason ('lapsed' while the owner's
//                         Contractor plan has lapsed). `description` is the page's "About".
//   brand_listings        a contractor's My-catalog product → its public copy (a normal
//                         'brand' product row the catalog serves). The private product keeps
//                         working exactly as before; only the copy is moderated and public.
//   leads                 contact requests from homeowners. Only the brand's owner reads them.
//   brand_events          brand_view, quote_click and lead (no IPs, like product_events).
//   brand_moderation_log  every submit / approve / reject / suspend … with who and the note.

/** @type {{ id: string, up: (db: import('node:sqlite').DatabaseSync) => void }[]} */
export const steps = [
  {
    id: 'brands-001-brand-pages-leads',
    up(db) {
      db.exec(`
        ALTER TABLE brands ADD COLUMN kind TEXT NOT NULL DEFAULT 'partner' CHECK (kind IN ('contractor','partner'));
        ALTER TABLE brands ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
        ALTER TABLE brands ADD COLUMN cover_file_id TEXT REFERENCES files(id) ON DELETE SET NULL;
        ALTER TABLE brands ADD COLUMN price_display TEXT NOT NULL DEFAULT 'from' CHECK (price_display IN ('from','show','on_request'));
        ALTER TABLE brands ADD COLUMN lead_form INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE brands ADD COLUMN show_phone INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE brands ADD COLUMN show_email INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE brands ADD COLUMN submitted_at INTEGER;
        ALTER TABLE brands ADD COLUMN live_at INTEGER;
        ALTER TABLE brands ADD COLUMN hidden_reason TEXT CHECK (hidden_reason IN ('lapsed'));
        CREATE UNIQUE INDEX brands_contractor_owner ON brands(owner_user_id) WHERE kind = 'contractor';

        CREATE TABLE brand_listings (
          source_product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
          brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
          product_id TEXT NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL);
        CREATE INDEX brand_listings_brand ON brand_listings(brand_id);

        CREATE TABLE leads (
          id TEXT PRIMARY KEY,
          brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
          product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
          product_name TEXT NOT NULL DEFAULT '',
          project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
          project_name TEXT NOT NULL DEFAULT '',
          share_token TEXT,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT NOT NULL DEFAULT '',
          location TEXT NOT NULL DEFAULT '',
          message TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','won','lost')),
          notes TEXT NOT NULL DEFAULT '',
          read_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL);
        CREATE INDEX leads_brand ON leads(brand_id, created_at DESC);

        CREATE TABLE brand_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
          product_id TEXT,
          type TEXT NOT NULL CHECK (type IN ('brand_view','quote_click','lead')),
          user_id TEXT,
          day TEXT NOT NULL,
          created_at INTEGER NOT NULL);
        CREATE INDEX brand_events_brand_day ON brand_events(brand_id, day);

        CREATE TABLE brand_moderation_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE,
          product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
          action TEXT NOT NULL,
          by_user_id TEXT,
          note TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL);
        CREATE INDEX brand_moderation_log_brand ON brand_moderation_log(brand_id, created_at);
      `);
    },
  },
];
