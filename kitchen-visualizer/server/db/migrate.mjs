// The migration runner. Steps run in module order, then array order, each in its own
// transaction, and are recorded by id in schema_migrations. Never edit or reorder an
// applied step: append a new one. See BUILD_PLAN §3.3.

import { tx } from './index.mjs';
import { MIGRATION_MODULES, MIGRATION_KEYS } from './migrations/index.mjs';

const ID_RE = /^[a-z]+-\d{3}-[a-z0-9-]+$/;

/** Checks every step id is well formed, prefixed with its module key and globally unique. */
export function listSteps(modules = MIGRATION_MODULES, keys = MIGRATION_KEYS) {
  const seen = new Set();
  const out = [];
  modules.forEach((mod, i) => {
    const key = keys[i];
    for (const step of mod.steps || []) {
      if (!step || typeof step.id !== 'string' || typeof step.up !== 'function') throw new Error(`Migration module "${key}" has a step without an id or up().`);
      if (!ID_RE.test(step.id)) throw new Error(`Migration id "${step.id}" must look like "${key}-001-name".`);
      if (!step.id.startsWith(`${key}-`)) throw new Error(`Migration id "${step.id}" must be prefixed with its module key "${key}-".`);
      if (seen.has(step.id)) throw new Error(`Duplicate migration id "${step.id}".`);
      seen.add(step.id);
      out.push(step);
    }
  });
  return out;
}

/**
 * Brings the database up to date. Returns the ids of the steps it applied (empty when
 * already current).
 */
export function migrate(db, { modules = MIGRATION_MODULES, keys = MIGRATION_KEYS, now = Date.now } = {}) {
  const steps = listSteps(modules, keys);
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id));
  const ran = [];
  for (const step of steps) {
    if (applied.has(step.id)) continue;
    tx(db, () => {
      step.up(db);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(step.id, now());
    });
    ran.push(step.id);
  }
  return ran;
}
