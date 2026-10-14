// BluModel Studio server bootstrap: settings → config → database (integrity check, migrations) →
// app → listen, plus the things a public server needs around that: request and header timeouts,
// daily backups, graceful shutdown and a log file that rotates. Zero dependencies: Node's http,
// crypto, zlib and built-in node:sqlite only.
//
//   npm run api                 # dev, pairs with `npm run dev` (Vite proxies /api and /files)
//   npm start                   # also how the home server runs it (--prod)
//
// Settings are environment variables; see server/config.mjs, docs/OPERATIONS.md and the README.
// A private KEY=VALUE settings file is read first (server/lib/envFile.mjs): BLUMODEL_ENV_FILE, or
// blumodel.env in the deployed home. Its values are never printed.
// Defaults: PORT 8790, HOST 127.0.0.1, DB_PATH server/data/blumodel.db, DIST_DIR ../dist.
//
// Stopping: SIGINT / SIGTERM / SIGBREAK (Ctrl+C, Ctrl+Break) or, on the home server, the file
// named by BLUMODEL_SHUTDOWN_FILE appearing (stop-server.cmd and the deploy create it): the server
// stops accepting, lets open requests finish for up to 10 s, checkpoints the WAL, closes the
// database and exits 0. An uncaught error is logged and exits 1 (the supervisor restarts it).

import fs from 'node:fs';
import http from 'node:http';
import { loadConfig } from './config.mjs';
import { checkpoint, openDb } from './db/index.mjs';
import { migrate } from './db/migrate.mjs';
import { createApp } from './app.mjs';
import { describeEnvFile, loadEnvFile } from './lib/envFile.mjs';
import { startupReport } from './ops/startup.mjs';
import { integrityCheck, scheduleBackups } from './ops/backup.mjs';
import { installLogFile } from './ops/logs.mjs';
import { warmDist } from './http/static.mjs';

/** How long open requests get to finish once shutdown starts. */
const DRAIN_MS = 10_000;

// The supervisor names a log file: from here on console output goes there, rotated by size.
if (process.env.BLUMODEL_LOG_FILE) installLogFile(process.env.BLUMODEL_LOG_FILE);

const fatal = (message) => {
  console.error(`BluModel Studio did not start: ${message}`);
  process.exit(1);
};

let settings = null;
try {
  settings = loadEnvFile(process.env);
} catch (err) {
  fatal(err.message);
}
const envLines = describeEnvFile(settings);
for (const l of envLines.info) console.log(l);
for (const l of envLines.warn) console.warn(l);

let config;
try {
  config = loadConfig();
} catch (err) {
  fatal(err.message);
}

const db = openDb(config.DB_PATH);
const integrity = config.DB_PATH === ':memory:' ? { ok: true, problems: [] } : integrityCheck(db);
if (!integrity.ok) {
  console.error(
    `DATABASE INTEGRITY CHECK FAILED for ${config.DB_PATH}: ${integrity.problems.join('; ')}. ` +
      'The server keeps running, /api/health answers 503 and daily backups are paused so the good ones are kept. ' +
      'Restore a backup (docs/OPERATIONS.md, "Backups and restore").',
  );
}
const applied = migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
const { handler, ctx } = createApp({ config, db });
ctx.health.integrity = integrity;

// Limits for the public internet. A client gets 20 s to send its headers (slowloris), 5 minutes
// for the whole request (a 25 MB model over a slow uplink), and an idle keep-alive connection is
// closed after 5 s. Bodies are capped per route (server/http/body.mjs).
const server = http.createServer(
  { maxHeaderSize: 16 * 1024, headersTimeout: 20_000, requestTimeout: 300_000, connectionsCheckingInterval: 5_000 },
  handler,
);
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;
server.maxRequestsPerSocket = 1_000;
server.maxConnections = 1_000;
server.on('error', (err) => {
  console.error(`BluModel Studio could not listen on ${config.HOST}:${config.PORT}: ${err.message}`);
  process.exit(1);
});
server.listen(config.PORT, config.HOST, () => {
  const where = config.HOST.includes(':') ? `[${config.HOST}]` : config.HOST;
  console.log(`BluModel Studio listening on http://${where}:${config.PORT} (payments: ${config.paymentsProvider}${config.PROD ? ', production' : ''})`);
  const report = startupReport(config);
  for (const l of report.info) console.log(l);
  for (const l of report.warn) console.warn(`Warning: ${l}`);
  if (config.BACKUPS === 'on') scheduleBackups({ db, config, log: console, paused: () => !integrity.ok });
  void warmDist(config.DIST_DIR);
});

setInterval(() => ctx.maintenance(), 10 * 60_000).unref();

// ── shutdown ────────────────────────────────────────────────────────────────

let stopping = false;
function shutdown(reason) {
  if (stopping) return;
  stopping = true;
  ctx.health.shuttingDown = true;
  console.log(`Shutting down (${reason}): finishing open requests (up to ${DRAIN_MS / 1000} s).`);
  let done = false;
  const finish = (how) => {
    if (done) return;
    done = true;
    clearTimeout(force);
    const ok = checkpoint(db);
    try {
      db.close();
    } catch {
      /* already closed */
    }
    console.log(`Stopped (${how}${ok ? ', database checkpointed' : ''}).`);
    process.exit(0);
  };
  const force = setTimeout(() => {
    server.closeAllConnections?.();
    finish('drain timed out');
  }, DRAIN_MS);
  server.close(() => finish('all requests finished'));
  server.closeIdleConnections?.();
}

for (const sig of ['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? ['SIGBREAK', 'SIGHUP'] : ['SIGHUP'])]) {
  process.on(sig, () => shutdown(sig));
}

// Windows can't send a hidden console process a signal it can catch (taskkill without /F
// refuses), so the supervisor's stop and the deploy ask through a file instead.
if (config.SHUTDOWN_FILE) {
  fs.rmSync(config.SHUTDOWN_FILE, { force: true }); // a stale request from before this start
  setInterval(() => {
    if (!fs.existsSync(config.SHUTDOWN_FILE)) return;
    fs.rmSync(config.SHUTDOWN_FILE, { force: true });
    shutdown('shutdown file');
  }, 1_000).unref();
}

// ── crashes ────────────────────────────────────────────────────────────────

const crash = (what, err) => {
  console.error(`${what}: ${err?.stack ?? err}`);
  checkpoint(db);
  try {
    db.close();
  } catch {
    /* already closed */
  }
  process.exit(1);
};
process.on('uncaughtException', (err) => crash('Uncaught exception', err));
process.on('unhandledRejection', (err) => crash('Unhandled promise rejection', err));
