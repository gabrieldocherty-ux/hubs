// tenancy-002 and tenancy-003 on a database with data in it: accounts and products survive the
// rebuilds, and a contractor company becomes a showroom in setup with its catalog moved in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';
import { MIGRATION_KEYS, MIGRATION_MODULES } from '../db/migrations/index.mjs';
import { defaultSpec } from './helpers.mjs';

test('contractor companies become tenants in setup; their catalog and its files move in; nothing is lost', () => {
  const db = openDb(':memory:');
  const i = MIGRATION_KEYS.indexOf('tenancy');
  // Everything before the pivot.
  migrate(db, { modules: MIGRATION_MODULES.slice(0, i), keys: MIGRATION_KEYS.slice(0, i) });
  const t = 1_760_000_000_000;
  db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1', 'pro@acme.test', 'Pro', 'h', ?), ('u2', 'home@x.test', 'Home', 'h', ?)").run(t, t);
  db.prepare("INSERT INTO files (id, sha256, ext, mime, size_bytes, kind, visibility, owner_user_id, created_at) VALUES ('f_logo', 'a', 'png', 'image/png', 1, 'image', 'public', 'u1', ?), ('f_img', 'b', 'png', 'image/png', 1, 'image', 'private', 'u1', ?), ('f_other', 'c', 'png', 'image/png', 1, 'image', 'private', 'u1', ?)").run(t, t, t);
  db.prepare("INSERT INTO contractor_profiles (user_id, company, logo_file_id, phone, email, website, service_area, created_at, updated_at) VALUES ('u1', 'Acme Kitchens & Bath', 'f_logo', '519-555-0100', 'info@acme.test', 'https://acme.test', 'Guelph', ?, ?)").run(t, t);
  const spec = JSON.stringify({ ...defaultSpec(), imageFileIds: ['f_img'] });
  db.prepare(
    "INSERT INTO products (id, source, owner_user_id, status, visibility, spec, live_spec, kind, category, name, created_at, updated_at) VALUES ('p_aaaaaaaaaaaaaaaaaaaaaaaa', 'contractor', 'u1', 'published', 'private', ?, ?, 'range', 'appliances', 'R', ?, ?)",
  ).run(spec, spec, t, t);
  db.prepare("INSERT INTO product_events (product_id, type, day, created_at) VALUES ('p_aaaaaaaaaaaaaaaaaaaaaaaa', 'view', '2026-10-01', ?)").run(t);
  db.prepare("INSERT INTO projects (id, user_id, name, doc, created_at, updated_at) VALUES ('k1', 'u2', 'K', '{}', ?, ?)").run(t, t);
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('h1', 'u2', ?)").run(t * 2);

  const ran = migrate(db);
  assert.deepEqual(ran.filter((id) => id.startsWith('tenancy-')).slice(0, 3), ['tenancy-001-tenants-hostnames-members', 'tenancy-002-site-accounts-sessions', 'tenancy-003-scoping-contractor-tenants']);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM product_events').get().n, 1, 'the products rebuild did not cascade');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1, 'the users rebuild did not cascade');
  assert.equal(db.prepare("SELECT tenant_id FROM projects WHERE id = 'k1'").get().tenant_id, null);

  const tn = db.prepare('SELECT * FROM tenants').all();
  assert.equal(tn.length, 1);
  assert.equal(tn[0].slug, 'acme-kitchens-bath');
  assert.equal(tn[0].status, 'setup');
  assert.equal(tn[0].source_user_id, 'u1');
  assert.deepEqual(JSON.parse(tn[0].contact), { phone: '519-555-0100', email: 'info@acme.test', website: 'https://acme.test', serviceArea: 'Guelph' });
  assert.deepEqual(JSON.parse(tn[0].branding), { logoFileId: 'f_logo' });
  assert.deepEqual(db.prepare('SELECT user_id, role FROM tenant_members').all().map((r) => ({ ...r })), [{ user_id: 'u1', role: 'owner' }]);
  assert.equal(db.prepare("SELECT tenant_id FROM products WHERE id = 'p_aaaaaaaaaaaaaaaaaaaaaaaa'").get().tenant_id, tn[0].id);
  assert.deepEqual(
    db.prepare('SELECT id, tenant_id FROM files ORDER BY id').all().map((r) => [r.id, r.tenant_id]),
    [
      ['f_img', tn[0].id],
      ['f_logo', tn[0].id],
      ['f_other', null],
    ],
  );
  // The new source is allowed now, and the address is unique per site.
  db.prepare(
    "INSERT INTO products (id, source, tenant_id, status, visibility, spec, kind, category, name, created_at, updated_at) VALUES ('p_bbbbbbbbbbbbbbbbbbbbbbbb', 'tenant', ?, 'draft', 'public', '{}', 'range', 'appliances', 'T', ?, ?)",
  ).run(tn[0].id, t, t);
  db.prepare("INSERT INTO users (id, email, name, password_hash, created_at, tenant_id) VALUES ('u3', 'pro@acme.test', 'Pro on the showroom', 'h', ?, ?)").run(t, tn[0].id);
  assert.throws(() => db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u4', 'pro@acme.test', 'Dup', 'h', ?)").run(t), /UNIQUE/);
  // Running again changes nothing.
  assert.deepEqual(migrate(db), []);
  db.close();
});
