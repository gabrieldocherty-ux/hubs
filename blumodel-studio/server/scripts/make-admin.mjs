// Makes an existing account an admin. Roles are never granted through the API.
//
//   node server/scripts/make-admin.mjs <email>        (DB_PATH as for the server)
//   node server/scripts/make-admin.mjs <email> --role studio

import { loadConfig } from '../config.mjs';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';

const args = process.argv.slice(2);
const email = (args.find((a) => !a.startsWith('--')) || '').trim().toLowerCase();
const roleAt = args.indexOf('--role');
const role = roleAt >= 0 ? args[roleAt + 1] : 'admin';

if (!email || !['customer', 'studio', 'admin'].includes(role)) {
  console.error('Usage: node server/scripts/make-admin.mjs <email> [--role customer|studio|admin]');
  process.exit(2);
}

const config = loadConfig(process.env, []);
const db = openDb(config.DB_PATH);
migrate(db);
const user = db.prepare('SELECT id, email, role FROM users WHERE email = ?').get(email);
if (!user) {
  console.error(`No account with the email ${email} in ${config.DB_PATH}. Sign up first.`);
  db.close();
  process.exit(1);
}
db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
db.close();
console.log(role === 'admin' ? `${email} is now an admin.` : `${email} is now ${role}.`);
