// Admin > System (GET /api/admin/system): how the server is doing and how it is set up.
//
// SECRETS NEVER LEAVE THIS FILE. Every key and secret is reported as a yes/no ("is it set", "does
// it look like the right kind of value"), never its value, length or any part of it. The payments
// notes come from config.paymentsNotes, which are written to be safe to log. Log lines are
// redacted (server/admin/redact.mjs) before they are returned. Keys live in blumodel.env and are
// edited there by hand: nothing here can change one.

import fs from 'node:fs';
import path from 'node:path';
import { SERVER_DIR } from '../config.mjs';
import { listDaily } from '../ops/backup.mjs';
import { emailSettings } from '../email/index.mjs';
import { redact } from './redact.mjs';
import { recentWebhookFailures } from './webhookFailures.mjs';
import { serverHome, updateStatus } from './updates.mjs';

const TAIL_BYTES = 256 * 1024;
const LINE_RE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) (ERROR|WARN) {0,2}(.*)$/;

const sizeOf = (file) => {
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
};

/** `{ commit, deployedAt }` from the DEPLOYED.txt the deploy writes next to server/, or nulls. */
export function deployedInfo(appDir = path.join(SERVER_DIR, '..')) {
  try {
    const text = fs.readFileSync(path.join(appDir, 'DEPLOYED.txt'), 'utf8');
    const commit = /^commit ([0-9a-f]{7,40})\s*$/m.exec(text)?.[1] ?? null;
    const deployed = /^deployed (\S+)\s*$/m.exec(text)?.[1] ?? null;
    const at = deployed ? Date.parse(deployed) : NaN;
    return { commit, deployedAt: Number.isFinite(at) ? at : null };
  } catch {
    return { commit: null, deployedAt: null };
  }
}

/** The newest ERROR / WARN lines of the server's own log (first line of each entry), redacted. */
export function recentLogProblems(file, limit = 25) {
  if (!file) return { available: false, entries: [] };
  let text = '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, TAIL_BYTES);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      text = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { available: false, entries: [] };
  }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const at = Date.parse(m[1]);
    out.push({ at: Number.isFinite(at) ? at : null, level: m[2] === 'ERROR' ? 'error' : 'warn', text: redact(m[3], 400) });
  }
  return { available: true, entries: out.slice(-limit).reverse() };
}

function disk(dir) {
  try {
    const s = fs.statfsSync(dir);
    return { freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) };
  } catch {
    return null;
  }
}

/**
 * @param {{ db: any, config: any, now: () => number, startedAt: number, health: any,
 *   logFile?: string | null, appDir?: string, home?: string | null }} deps
 */
export function systemStatus({ db, config, now, startedAt, health, logFile = process.env.BLUMODEL_LOG_FILE || null, appDir, home = serverHome() }) {
  const t = now();
  const memory = config.DB_PATH === ':memory:';
  const dbFile = memory ? null : path.resolve(config.DB_PATH);
  const backups = config.BACKUPS === 'on' ? listDaily(config.BACKUP_DIR) : [];
  const newest = backups[0] ?? null;
  let newestAt = null;
  if (newest) {
    try {
      newestAt = fs.statSync(newest.file).mtimeMs;
    } catch {
      newestAt = null;
    }
  }
  const email = emailSettings(config);
  const lastWebhook = db.prepare("SELECT MAX(received_at) AS at, COUNT(*) AS n FROM webhook_events WHERE provider = 'stripe' AND received_at >= ?").get(t - 30 * 86_400_000);
  const lastEver = db.prepare("SELECT MAX(received_at) AS at FROM webhook_events WHERE provider = 'stripe'").get().at ?? null;
  const failures = recentWebhookFailures(db, 20);
  const deployed = deployedInfo(appDir);

  return {
    generatedAt: t,
    server: {
      version: config.version,
      commit: deployed.commit,
      deployedAt: deployed.deployedAt,
      startedAt,
      uptimeSec: Math.max(0, Math.floor((t - startedAt) / 1000)),
      node: process.version,
      production: !!config.PROD,
      publicUrl: config.PUBLIC_URL,
      httpsPublicUrl: !!config.httpsPublicUrl,
      shuttingDown: !!health?.shuttingDown,
    },
    database: {
      inMemory: memory,
      sizeBytes: dbFile ? sizeOf(dbFile) : null,
      walBytes: dbFile ? sizeOf(dbFile + '-wal') : null,
      integrity: health?.integrity ? (health.integrity.ok ? 'ok' : 'problems') : 'not checked',
    },
    backups: {
      enabled: config.BACKUPS === 'on',
      count: backups.length,
      keep: config.BACKUP_KEEP,
      lastDay: newest?.day ?? null,
      lastAt: newestAt,
    },
    disk: dbFile ? disk(path.dirname(dbFile)) : null,
    payments: {
      provider: config.paymentsProvider,
      stripeMode: config.stripeMode ?? null,
      secretKeySet: !!config.STRIPE_SECRET_KEY,
      webhookSecretSet: !!config.STRIPE_WEBHOOK_SECRET,
      webhookSecretWellFormed: !!config.STRIPE_WEBHOOK_SECRET && /^whsec_/.test(config.STRIPE_WEBHOOK_SECRET),
      notes: [...(config.paymentsNotes ?? [])].map((n) => redact(n, 300)),
      lastWebhookAt: lastEver,
      webhooks30d: lastWebhook.n,
      failures,
      failures24h: failures.filter((f) => f.at >= t - 86_400_000).length,
    },
    email: {
      provider: email.provider,
      configured: email.provider !== 'none',
      keySet: !!(config.RESEND_API_KEY || config.POSTMARK_TOKEN),
      fromSet: !!config.EMAIL_FROM,
    },
    legal: {
      supportEmailSet: !!config.SUPPORT_EMAIL,
      legalNameSet: !!config.LEGAL_NAME,
      jurisdictionSet: !!config.LEGAL_JURISDICTION,
      ready: !!config.legal?.ready,
    },
    llm: { configured: !!config.llmEnabled },
    log: recentLogProblems(logFile),
    updates: updateStatus({ home }),
  };
}
