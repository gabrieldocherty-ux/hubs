// BluModel Studio server bootstrap: config → database → migrations → app → listen.
// Zero dependencies: Node's http, crypto and built-in node:sqlite only.
//
//   npm run api                 # dev, pairs with `npm run dev` (Vite proxies /api and /files)
//   npm start                   # also how the home server runs it (--prod)
//
// Settings are environment variables; see server/config.mjs and the README. BLUMODEL_ENV_FILE names a
// private KEY=VALUE settings file read first (server/lib/envFile.mjs); its values are never printed.
// Defaults: PORT 8790, HOST 127.0.0.1, DB_PATH server/data/blumodel.db, DIST_DIR ../dist.

import http from 'node:http';
import { loadConfig } from './config.mjs';
import { openDb } from './db/index.mjs';
import { migrate } from './db/migrate.mjs';
import { createApp } from './app.mjs';
import { loadEnvFile } from './lib/envFile.mjs';

try {
  const settings = loadEnvFile(process.env);
  if (settings) console.log(`Read ${settings.total} settings from ${settings.path} (${settings.set} applied; the environment wins over the file).`);
} catch (err) {
  console.error(`BluModel Studio did not start: ${err.message}`);
  process.exit(1);
}

const config = loadConfig();
const db = openDb(config.DB_PATH);
const applied = migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
const { handler, ctx } = createApp({ config, db });

const server = http.createServer(handler);
server.on('error', (err) => {
  console.error(`BluModel Studio could not listen on ${config.HOST}:${config.PORT}: ${err.message}`);
  process.exit(1);
});
server.listen(config.PORT, config.HOST, () => {
  const where = config.HOST.includes(':') ? `[${config.HOST}]` : config.HOST;
  console.log(`BluModel Studio listening on http://${where}:${config.PORT} (payments: ${config.paymentsProvider}${config.PROD ? ', production' : ''})`);
});

setInterval(() => ctx.maintenance(), 10 * 60_000).unref();

const shutdown = () => {
  server.close();
  server.closeIdleConnections?.();
  setTimeout(() => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  }, 500).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
