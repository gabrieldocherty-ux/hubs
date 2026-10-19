// SQLite through Node's built-in node:sqlite. Nothing to install.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Opens (creating the folder if needed) a database in WAL mode with foreign keys on.
 *   busy_timeout 5 s        a writer waits for another instead of failing at once
 *   synchronous NORMAL      safe with WAL (a power cut can lose the last commits, never corrupt)
 *                           and far fewer fsyncs than FULL
 *   journal_size_limit 64MB the WAL file is truncated back to this after a checkpoint
 */
export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL; PRAGMA journal_size_limit = 67108864;');
  return db;
}

/** Folds the WAL back into the database and truncates it (on shutdown). Never throws. */
export function checkpoint(db) {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return true;
  } catch {
    return false;
  }
}

const depth = new WeakMap();

/**
 * Runs `fn(db)` in one transaction: BEGIN IMMEDIATE / COMMIT, or ROLLBACK if it throws.
 * Nested calls become savepoints. `fn` must be synchronous (node:sqlite is), so nothing
 * else can interleave with it.
 */
export function tx(db, fn) {
  const d = depth.get(db) || 0;
  const sp = `sp_${d}`;
  db.exec(d === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth.set(db, d + 1);
  try {
    const out = fn(db);
    if (out && typeof out.then === 'function') throw new Error('tx(fn): fn must be synchronous.');
    db.exec(d === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return out;
  } catch (err) {
    try {
      db.exec(d === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    } catch {
      /* the original error matters more */
    }
    throw err;
  } finally {
    depth.set(db, d);
  }
}
