// Makes an existing account an admin. Roles are never granted through the API.
//
//   node server/scripts/make-admin.mjs <email>
//   node server/scripts/make-admin.mjs <email> --role studio
//   node server/scripts/make-admin.mjs <email> --db <file>
//   node server/scripts/make-admin.mjs <email> --reset-2fa   turns the account's two-factor sign-in off and
//                                                            signs it out everywhere (a lost phone AND lost
//                                                            recovery codes); an admin enrols again at once
//
// Two-factor sign-in (an authenticator app) is REQUIRED for admins (server/auth/mfa.mjs): an admin who
// hasn't set it up is asked to at their next sign-in, and the admin pages stay closed until they do.
//
// Which database, the same way restore.mjs finds it: --db, else DB_PATH, else, run from a deployed
// home (<home>pp), the home's datalumodel.db, else the checkout's server\datalumodel.db. It
// prints the one it used, and never creates one: a path with no database is an error.

import fs from 'node:fs';
import { loadConfig } from '../config.mjs';
import { scriptDbPath } from '../lib/envFile.mjs';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';

const args = process.argv.slice(2);
const flagValues = new Set([args.indexOf('--role'), args.indexOf('--db')].filter((i) => i >= 0).map((i) => i + 1));
const email = (args.find((a, i) => !a.startsWith('--') && !flagValues.has(i)) || '').trim().toLowerCase();
const reset2fa = args.includes('--reset-2fa');
const roleAt = args.indexOf('--role');
const role = roleAt >= 0 ? args[roleAt + 1] : 'admin';
const dbAt = args.indexOf('--db');
const dbFlag = dbAt >= 0 ? args[dbAt + 1] : undefined;

if (!email || !['customer', 'studio', 'admin'].includes(role)) {
  console.error('Usage: node server/scripts/make-admin.mjs <email> [--role customer|studio|admin] [--db <file>] [--reset-2fa]');
  process.exit(2);
}

const env = { ...process.env };
const { dbPath, source } = scriptDbPath({ env, dbFlag });
if (dbPath) env.DB_PATH = dbPath;
const config = loadConfig(env, []);
const why = { '--db': 'from --db', DB_PATH: 'from DB_PATH', home: 'the deployed home’s database', default: 'the checkout’s database' }[source];
console.log(`Database: ${config.DB_PATH} (${why})`);
if (config.DB_PATH !== ':memory:' && !fs.existsSync(config.DB_PATH)) {
  console.error(`There is no database at ${config.DB_PATH}. Run this on the server, or name it with --db <file> or DB_PATH.`);
  process.exit(1);
}
const db = openDb(config.DB_PATH);
migrate(db);
// A sales-site account: showroom accounts (users.tenant_id) are never BluModel's admins.
const user = db.prepare('SELECT id, email, role FROM users WHERE email = ? AND tenant_id IS NULL').get(email);
if (!user) {
  console.error(`No account with the email ${email} in ${config.DB_PATH}. Sign up first.`);
  db.close();
  process.exit(1);
}
db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
if (reset2fa) {
  db.prepare('DELETE FROM user_mfa_recovery WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM user_mfa WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
}
const enrolled = !!db.prepare('SELECT 1 FROM user_mfa WHERE user_id = ? AND enabled_at IS NOT NULL').get(user.id);
db.close();
console.log(role === 'admin' ? `${email} is now an admin.` : `${email} is now ${role}.`);
if (reset2fa) console.log('Two-factor sign-in was turned off for this account and it was signed out everywhere.');
if (role === 'admin' && !enrolled) {
  console.log('Two-factor sign-in is REQUIRED for admins. At the first sign-in the admin pages ask for it to be set up:');
  console.log('have an authenticator app ready (1Password, Google Authenticator, Microsoft Authenticator, Authy), add the key it');
  console.log('shows, enter a code, and keep the 10 recovery codes somewhere safe and offline. Nothing admin works until then.');
}
