// AI renderings on a showroom (docs/SHOWROOM_PIVOT.md §7, docs/handoff/renders.md). Steps reference
// only foundation and tenancy tables and their own. Append steps; never edit or reorder an applied
// one. Ids are "renders-NNN-name".
//
//   renders-001  showroom_renders: one row per "Make it photoreal". The captured 3D view
//                (input_file_id) and the result (output_file_id) are private files of the
//                showroom; the credits it cost are a hold in tenant_credit_holds (hold_id),
//                charged when the render worked and released when it didn't.
//   renders-002  showroom_renders.free: one of the account's free renders (config FREE_RENDERS):
//                no credits held or charged (hold_id NULL, cost_cents 0). A failed one doesn't count.
//   renders-003  render_settings: the render service set in Admin > System (renders/settings.mjs).
//                One row. The key is sealed (AES-256-GCM, its key in render-settings.key next to the
//                database); key_last4 is all the panel ever shows of it.

/** @type {{ id: string, up: (db: import('node:sqlite').DatabaseSync) => void }[]} */
export const steps = [
  {
    id: 'renders-001-showroom-renders',
    up(db) {
      db.exec(`
        CREATE TABLE showroom_renders (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          -- who asked: a team member or a signed-in visitor of this showroom
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          by_role TEXT NOT NULL CHECK (by_role IN ('owner', 'staff', 'visitor')),
          project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
          design_name TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'failed', 'refunded')),
          provider TEXT NOT NULL,
          cost_cents INTEGER NOT NULL DEFAULT 0,
          hold_id TEXT,
          input_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
          output_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
          -- the structured description sent with the image (room, finishes, products), JSON
          scene TEXT NOT NULL DEFAULT '{}',
          error TEXT NOT NULL DEFAULT '',
          -- taken out of the gallery by the team or the visitor; the row and the ledger stay
          hidden_at INTEGER,
          created_at INTEGER NOT NULL,
          finished_at INTEGER
        );
        CREATE INDEX showroom_renders_tenant ON showroom_renders(tenant_id, created_at DESC);
        CREATE INDEX showroom_renders_project ON showroom_renders(project_id, created_at DESC);
        CREATE INDEX showroom_renders_user ON showroom_renders(user_id, created_at DESC);
      `);
    },
  },
  {
    id: 'renders-002-free',
    up(db) {
      db.exec(`
        ALTER TABLE showroom_renders ADD COLUMN free INTEGER NOT NULL DEFAULT 0;
        CREATE INDEX showroom_renders_free ON showroom_renders(user_id, free);
      `);
    },
  },
  {
    id: 'renders-003-settings',
    up(db) {
      db.exec(`
        CREATE TABLE render_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          url TEXT NOT NULL,
          key_sealed TEXT NOT NULL,
          key_last4 TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          updated_by TEXT);
      `);
    },
  },
];
