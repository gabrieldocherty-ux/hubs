// The showroom pivot's schema (docs/SHOWROOM_PIVOT.md, docs/handoff/tenancy.md). Append steps;
// never edit or reorder an applied one. Ids are "tenancy-NNN-name".
//
//   tenancy-001  tenants (a company's showroom), tenant_hostnames (the addresses that reach it),
//                tenant_members (its staff: owner | staff)
//   tenancy-002  accounts and sessions belong to a site: users.tenant_id (NULL = the sales site; an
//                address is unique per site, not globally) and sessions.tenant_id (the site the
//                session was started on; it works nowhere else)
//   tenancy-003  tenant scoping: products (source may be 'tenant'), projects and files gain
//                tenant_id (NULL = the sales site / our shared library); every contractor company
//                becomes a tenant in 'setup' (its owner on the team, its private catalog and those
//                products' files moved into the showroom; nothing is deleted or changed for the
//                contractor on the sales site)
//   tenancy-004  the showroom's money: tenant_licenses (yearly, recorded by an admin),
//                tenant_subscriptions (the $50 monthly plan: stripe | demo | comp), tenant_checkouts
//                (the Checkout links an admin sends) and tenant_payments (receipts)
//   tenancy-005  the render credits ledger: tenant_credit_lots (what was granted, what is left of
//                it, when it expires), tenant_credit_holds (credits reserved for a render, then
//                charged, released or refunded) and tenant_credit_entries (every change, signed)

/**
 * Rebuilds `table` with SQLite's procedure (create new, copy, drop old, rename), for the changes
 * ALTER TABLE can't make (a CHECK list, a column's UNIQUE). `edit(sql)` returns the new CREATE
 * statement from the current one and must change it. Indexes are recreated from sqlite_master.
 * The step must run with `foreignKeys: 'off'` (see db/migrate.mjs).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} table
 * @param {(sql: string) => string} edit
 */
export function rebuildTable(db, table, edit) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!row) throw new Error(`rebuildTable: no table ${table}`);
  const next = edit(String(row.sql));
  if (next === row.sql) throw new Error(`rebuildTable(${table}): the edit changed nothing`);
  const indexes = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL")
    .all(table)
    .map((r) => String(r.sql));
  const triggers = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?")
    .all(table)
    .map((r) => String(r.sql));
  const cols = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => `"${c.name}"`)
    .join(', ');
  const tmp = `${table}__rebuild`;
  const create = next.replace(/^CREATE TABLE\s+("?)[A-Za-z_][A-Za-z0-9_]*\1/i, `CREATE TABLE ${tmp}`);
  if (create === next) throw new Error(`rebuildTable(${table}): unexpected CREATE statement`);
  db.exec(create);
  db.exec(`INSERT INTO ${tmp} (${cols}) SELECT ${cols} FROM ${table}`);
  db.exec(`DROP TABLE ${table}`);
  db.exec(`ALTER TABLE ${tmp} RENAME TO ${table}`);
  for (const s of indexes) db.exec(s);
  for (const s of triggers) db.exec(s);
}

/** @type {{ id: string, foreignKeys?: 'off', up: (db: import('node:sqlite').DatabaseSync) => void }[]} */
export const steps = [
  {
    id: 'tenancy-001-tenants-hostnames-members',
    up(db) {
      db.exec(`
        CREATE TABLE tenants (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          -- setup: being built (reachable, not launched); live / lapsed: launched, recomputed from the
          -- license and the monthly plan; suspended: switched off by an admin. Data is never deleted.
          status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup','live','lapsed','suspended')),
          status_note TEXT NOT NULL DEFAULT '',
          branding TEXT NOT NULL DEFAULT '{}',
          contact TEXT NOT NULL DEFAULT '{}',
          settings TEXT NOT NULL DEFAULT '{}',
          is_demo INTEGER NOT NULL DEFAULT 0,
          -- set when the tenant was made from a contractor company (tenancy-003)
          source_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL);

        CREATE TABLE tenant_hostnames (
          hostname TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('subdomain','custom')),
          verified INTEGER NOT NULL DEFAULT 0,
          is_primary INTEGER NOT NULL DEFAULT 0,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at INTEGER NOT NULL);
        CREATE INDEX tenant_hostnames_tenant ON tenant_hostnames(tenant_id);

        CREATE TABLE tenant_members (
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('owner','staff')),
          invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (tenant_id, user_id));
        CREATE INDEX tenant_members_user ON tenant_members(user_id);
      `);
    },
  },
  {
    id: 'tenancy-002-site-accounts-sessions',
    foreignKeys: 'off',
    up(db) {
      // The same person can have an account on two showrooms (and the sales site): the address is
      // unique per site. SQLite can't drop a column's UNIQUE in place, so users is rebuilt.
      rebuildTable(db, 'users', (sql) => sql.replace(/email\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i, 'email TEXT NOT NULL'));
      db.exec(`
        ALTER TABLE users ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
        CREATE UNIQUE INDEX users_site_email ON users(COALESCE(tenant_id, ''), email);
        CREATE INDEX users_tenant ON users(tenant_id);
        ALTER TABLE sessions ADD COLUMN tenant_id TEXT;
      `);
    },
  },
  {
    id: 'tenancy-003-scoping-contractor-tenants',
    foreignKeys: 'off',
    up(db) {
      rebuildTable(db, 'products', (sql) => sql.replace(/CHECK\s*\(\s*source\s+IN\s*\('brand','custom','contractor'\)\s*\)/i, "CHECK (source IN ('brand','custom','contractor','tenant'))"));
      db.exec(`
        ALTER TABLE products ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
        CREATE INDEX products_tenant ON products(tenant_id, status);
        ALTER TABLE projects ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
        CREATE INDEX projects_tenant_user ON projects(tenant_id, user_id, updated_at DESC);
        ALTER TABLE files ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
        CREATE INDEX files_tenant ON files(tenant_id);
      `);

      // Every contractor company becomes a showroom in setup. Slugs as services.tenants makes them.
      const reserved = new Set(['www', 'api', 'app', 'admin', 'administrator', 'mail', 'email', 'smtp', 'ftp', 'ns1', 'ns2', 'static', 'assets', 'files', 'cdn', 'blog', 'help', 'support', 'status', 'sales', 'billing', 'pay', 'payments', 'stripe', 'studio', 'blumodel', 'dashboard', 'login', 'signin', 'signup', 'account', 'docs', 'dev', 'test', 'staging', 'qa', 'localhost', 'webhooks', 'tunnel']);
      const slugOf = (name) => {
        let base =
          String(name ?? '')
            .normalize('NFKD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/&/g, ' ')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40)
            .replace(/-+$/g, '') || 'showroom';
        if (reserved.has(base)) base = `${base}-showroom`.slice(0, 40);
        let s = base;
        for (let i = 2; db.prepare('SELECT 1 FROM tenants WHERE slug = ?').get(s) || reserved.has(s); i++) s = `${base.slice(0, 36)}-${i}`;
        return s;
      };
      const parse = (x) => {
        try {
          return JSON.parse(x || 'null');
        } catch {
          return null;
        }
      };
      const fileIds = (spec) => {
        if (!spec) return [];
        const ids = [...(Array.isArray(spec.imageFileIds) ? spec.imageFileIds : [])];
        if (spec.modelFileId) ids.push(spec.modelFileId);
        if (Array.isArray(spec.finishes)) for (const f of spec.finishes) if (f?.swatchFileId) ids.push(f.swatchFileId);
        return ids.filter((x) => typeof x === 'string');
      };
      const now = Date.now();
      const profiles = db.prepare('SELECT p.* FROM contractor_profiles p JOIN users u ON u.id = p.user_id ORDER BY p.created_at, p.user_id').all();
      for (const p of profiles) {
        if (db.prepare('SELECT 1 FROM tenants WHERE source_user_id = ?').get(p.user_id)) continue;
        const id = `t_c${String(p.user_id).replace(/[^A-Za-z0-9]/g, '').slice(0, 20)}`;
        const slug = slugOf(p.company);
        const contact = { phone: p.phone || '', email: p.email || '', website: p.website || '', serviceArea: p.service_area || '' };
        const branding = p.logo_file_id ? { logoFileId: p.logo_file_id } : {};
        db.prepare(
          `INSERT INTO tenants (id, slug, name, status, status_note, branding, contact, settings, is_demo, source_user_id, created_by, created_at, updated_at)
           VALUES (?, ?, ?, 'setup', 'Made from a Contractor company when the showrooms began.', ?, ?, '{}', 0, ?, NULL, ?, ?)`,
        ).run(id, slug, String(p.company || 'Showroom').slice(0, 100), JSON.stringify(branding), JSON.stringify(contact), p.user_id, now, now);
        db.prepare("INSERT INTO tenant_hostnames (hostname, tenant_id, kind, verified, is_primary, created_by, created_at) VALUES (?, ?, 'subdomain', 1, 1, NULL, ?)").run(`${slug}.blumodel.studio`, id, now);
        db.prepare("INSERT OR IGNORE INTO tenant_members (tenant_id, user_id, role, invited_by, created_at) VALUES (?, ?, 'owner', NULL, ?)").run(id, p.user_id, now);
        const products = db.prepare("SELECT id, spec, live_spec FROM products WHERE source = 'contractor' AND owner_user_id = ?").all(p.user_id);
        const ids = new Set(p.logo_file_id ? [p.logo_file_id] : []);
        for (const r of products) {
          db.prepare('UPDATE products SET tenant_id = ? WHERE id = ?').run(id, r.id);
          for (const f of [...fileIds(parse(r.spec)), ...fileIds(parse(r.live_spec))]) ids.add(f);
        }
        for (const f of ids) db.prepare('UPDATE files SET tenant_id = ? WHERE id = ? AND owner_user_id = ? AND tenant_id IS NULL').run(id, f, p.user_id);
      }
    },
  },
  {
    id: 'tenancy-004-licenses-monthly',
    up(db) {
      db.exec(`
        CREATE TABLE tenant_licenses (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
          currency TEXT NOT NULL DEFAULT 'cad',
          -- calendar days (UTC), both included: current while starts_on <= today <= ends_on
          starts_on TEXT NOT NULL,
          ends_on TEXT NOT NULL,
          paid_how TEXT NOT NULL CHECK (paid_how IN ('invoice','etransfer','cheque','card','cash','comp','other')),
          note TEXT NOT NULL DEFAULT '',
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_by_email TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          voided_at INTEGER,
          voided_by TEXT REFERENCES users(id) ON DELETE SET NULL);
        CREATE INDEX tenant_licenses_tenant ON tenant_licenses(tenant_id, ends_on);

        CREATE TABLE tenant_subscriptions (
          tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
          provider TEXT NOT NULL CHECK (provider IN ('stripe','demo','comp')),
          status TEXT NOT NULL CHECK (status IN ('active','past_due','canceled','incomplete')),
          customer_ref TEXT,
          subscription_ref TEXT UNIQUE,
          current_period_end INTEGER,
          grace_until INTEGER,
          cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
          amount_cents INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'cad',
          note TEXT NOT NULL DEFAULT '',
          canceled_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL);

        CREATE TABLE tenant_checkouts (
          ref TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          provider TEXT NOT NULL CHECK (provider IN ('stripe','demo')),
          provider_ref TEXT,
          url TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','expired','canceled')),
          amount_cents INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'cad',
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at INTEGER NOT NULL,
          completed_at INTEGER);
        CREATE INDEX tenant_checkouts_tenant ON tenant_checkouts(tenant_id, created_at DESC);

        CREATE TABLE tenant_payments (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('monthly','license')),
          amount_cents INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'cad',
          provider TEXT NOT NULL,
          -- the Stripe invoice (or demo / license) reference: one receipt per payment
          ref TEXT NOT NULL UNIQUE,
          period_end INTEGER,
          created_at INTEGER NOT NULL);
        CREATE INDEX tenant_payments_tenant ON tenant_payments(tenant_id, created_at DESC);
      `);
    },
  },
  {
    id: 'tenancy-005-credits-ledger',
    up(db) {
      db.exec(`
        CREATE TABLE tenant_credit_lots (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          -- monthly: a paid month's credits (ref = the invoice); adjust: an admin added them
          source TEXT NOT NULL CHECK (source IN ('monthly','adjust')),
          cents INTEGER NOT NULL CHECK (cents > 0),
          remaining INTEGER NOT NULL CHECK (remaining >= 0),
          ref TEXT,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL);
        CREATE INDEX tenant_credit_lots_tenant ON tenant_credit_lots(tenant_id, expires_at);
        CREATE UNIQUE INDEX tenant_credit_lots_ref ON tenant_credit_lots(tenant_id, source, ref) WHERE ref IS NOT NULL;

        CREATE TABLE tenant_credit_holds (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          cents INTEGER NOT NULL CHECK (cents > 0),
          status TEXT NOT NULL CHECK (status IN ('held','charged','released','refunded')),
          -- [{ lotId, cents }]: which lots the reservation took from, oldest expiry first
          allocations TEXT NOT NULL,
          purpose TEXT NOT NULL DEFAULT 'render',
          ref TEXT,
          by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at INTEGER NOT NULL,
          settled_at INTEGER);
        CREATE INDEX tenant_credit_holds_tenant ON tenant_credit_holds(tenant_id, created_at DESC);

        CREATE TABLE tenant_credit_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('grant','expire','reserve','charge','release','refund','adjust')),
          -- the change to the balance (charge is 0: the reservation already took it)
          cents INTEGER NOT NULL,
          balance_after INTEGER NOT NULL,
          lot_id TEXT,
          hold_id TEXT,
          ref TEXT,
          note TEXT NOT NULL DEFAULT '',
          by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          by_email TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL);
        CREATE INDEX tenant_credit_entries_tenant ON tenant_credit_entries(tenant_id, id DESC);
      `);
    },
  },
];
