// The showroom pivot's schema (docs/SHOWROOM_PIVOT.md, docs/handoff/tenancy.md). Append steps;
// never edit or reorder an applied one. Ids are "tenancy-NNN-name".
//
//   tenancy-001  tenants (a company's showroom), tenant_hostnames (the addresses that reach it),
//                tenant_members (its staff: owner | staff)
//   tenancy-002  accounts and sessions belong to a site: users.tenant_id (NULL = the sales site; an
//                address is unique per site, not globally) and sessions.tenant_id (the site the
//                session was started on; it works nowhere else)

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
];
