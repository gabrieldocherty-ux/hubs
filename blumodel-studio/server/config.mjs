// Every runtime setting, read once from the environment (and argv for --prod).
// Every package reads the result; only the foundation adds keys. See BUILD_PLAN §3.1.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

const int = (v, def, min = -Infinity, max = Infinity) => {
  if (v === undefined || v === null || String(v).trim() === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Expected a number, got "${v}".`);
  return Math.min(max, Math.max(min, Math.floor(n)));
};
const bool = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());

/**
 * The default database, server/data/blumodel.db. A checkout that still has the database from before
 * the rename (server/data/mise.db) and no blumodel.db keeps using the old file.
 */
function defaultDbPath() {
  const current = path.join(SERVER_DIR, 'data', 'blumodel.db');
  const legacy = path.join(SERVER_DIR, 'data', 'mise.db');
  return !fs.existsSync(current) && fs.existsSync(legacy) ? legacy : current;
}

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(SERVER_DIR, '..', 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string[]} argv
 */
export function loadConfig(env = process.env, argv = process.argv) {
  const PROD = env.NODE_ENV === 'production' || argv.includes('--prod');
  const PORT = int(env.PORT, 8790, 0, 65535);
  const HOST = (env.HOST || '').trim() || '127.0.0.1';
  const DB_PATH = env.DB_PATH || defaultDbPath();
  const UPLOAD_DIR = path.resolve(env.UPLOAD_DIR || path.join(DB_PATH === ':memory:' ? path.join(SERVER_DIR, 'data') : path.dirname(DB_PATH), 'uploads'));
  const DIST_DIR = path.resolve(env.DIST_DIR || path.join(SERVER_DIR, '..', 'dist'));
  const PUBLIC_URL = (String(env.PUBLIC_URL || '').trim() || `http://127.0.0.1:${PORT}`).replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/?#]+$/i.test(PUBLIC_URL)) throw new Error('PUBLIC_URL must be an http(s) origin with no path, e.g. https://blumodel.studio.');
  // TRUST_PROXY=1: a reverse proxy on THIS machine (cloudflared, tailscale serve) forwards the
  // requests. From a loopback peer only, the client address is CF-Connecting-IP, else the first
  // X-Forwarded-For hop. 0 (default): the socket address. See app.mjs clientIp().
  const tp = String(env.TRUST_PROXY ?? '').trim().toLowerCase();
  const TRUST_PROXY = /^\d+$/.test(tp) ? Math.min(1, Number(tp)) : bool(tp) ? 1 : 0;
  // Daily database backups (VACUUM INTO) and an uploads mirror, next to the database by default.
  const BACKUPS = (env.BACKUPS || 'on').trim().toLowerCase() === 'off' || DB_PATH === ':memory:' ? 'off' : 'on';
  const BACKUP_DIR = path.resolve(env.BACKUP_DIR || path.join(DB_PATH === ':memory:' ? path.join(SERVER_DIR, 'data') : path.dirname(path.resolve(DB_PATH)), 'backups'));
  const BACKUP_KEEP = int(env.BACKUP_KEEP, 14, 1, 365);
  // A file whose appearance asks the server to shut down gracefully (stop-server.cmd and the
  // deploy create it; Windows can't send a console-less process a catchable signal).
  const SHUTDOWN_FILE = String(env.BLUMODEL_SHUTDOWN_FILE || '').trim() || null;
  const ADMIN_EMAILS = String(env.ADMIN_EMAILS || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const MAX_GLB_MB = int(env.MAX_GLB_MB, 25, 1, 200);
  const MAX_IMAGE_MB = int(env.MAX_IMAGE_MB, 8, 1, 100);
  const BRAND_PRODUCT_LIMIT = int(env.BRAND_PRODUCT_LIMIT, 50, 0, 100_000);

  const STRIPE_SECRET_KEY = String(env.STRIPE_SECRET_KEY || '').trim();
  const STRIPE_WEBHOOK_SECRET = String(env.STRIPE_WEBHOOK_SECRET || '').trim();
  const PAYMENTS = (env.PAYMENTS || 'auto').trim().toLowerCase();
  if (!['auto', 'demo', 'stripe'].includes(PAYMENTS)) throw new Error(`PAYMENTS must be auto, demo or stripe (got "${PAYMENTS}").`);
  if (PAYMENTS === 'stripe' && !(STRIPE_SECRET_KEY && STRIPE_WEBHOOK_SECRET)) throw new Error('PAYMENTS=stripe needs both STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.');
  const DEMO_PAYMENTS = bool(env.DEMO_PAYMENTS);
  const posture = paymentsPosture({ PAYMENTS, PROD, PUBLIC_URL, DEMO_PAYMENTS, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET });
  const paymentsProvider = posture.provider;

  const LEGAL_NAME = String(env.LEGAL_NAME || '').trim();
  const SUPPORT_EMAIL = String(env.SUPPORT_EMAIL || '').trim();
  const LEGAL_JURISDICTION = String(env.LEGAL_JURISDICTION || '').trim();

  const ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY || '';
  // MISE_LLM_MODEL is the deprecated name from before the rename; still read.
  const BLUMODEL_LLM_MODEL = env.BLUMODEL_LLM_MODEL || env.MISE_LLM_MODEL || '';
  const SEED_PASSWORD = env.SEED_PASSWORD || '';

  const RATE_LIMITS = (env.RATE_LIMITS || 'on').trim().toLowerCase() === 'off' ? 'off' : 'on';
  if (RATE_LIMITS === 'off' && PROD) throw new Error('RATE_LIMITS=off is refused in production.');

  return Object.freeze({
    PORT,
    HOST,
    PROD,
    DB_PATH,
    UPLOAD_DIR,
    DIST_DIR,
    PUBLIC_URL,
    TRUST_PROXY,
    ADMIN_EMAILS: Object.freeze(ADMIN_EMAILS),
    MAX_GLB_MB,
    MAX_IMAGE_MB,
    BRAND_PRODUCT_LIMIT,
    PAYMENTS,
    DEMO_PAYMENTS,
    STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET,
    ANTHROPIC_API_KEY,
    BLUMODEL_LLM_MODEL,
    SEED_PASSWORD,
    RATE_LIMITS,
    LEGAL_NAME,
    SUPPORT_EMAIL,
    LEGAL_JURISDICTION,
    BACKUP_DIR,
    BACKUPS,
    BACKUP_KEEP,
    SHUTDOWN_FILE,
    // derived
    /** 'stripe' | 'demo' | 'none': see paymentsPosture(). */
    paymentsProvider,
    /** 'live' | 'test' | null: the Stripe key's mode (from its prefix), when Stripe is on. */
    stripeMode: posture.provider === 'stripe' ? posture.keyMode : null,
    /** Why payments are what they are: plain sentences for the log, never a key or any part of one. */
    paymentsNotes: Object.freeze(posture.notes),
    llmEnabled: !!(ANTHROPIC_API_KEY && BLUMODEL_LLM_MODEL),
    demoPaymentsAllowed: paymentsProvider === 'demo',
    legal: Object.freeze({
      ready: !!(LEGAL_NAME && SUPPORT_EMAIL && LEGAL_JURISDICTION),
      businessName: LEGAL_NAME || null,
      supportEmail: SUPPORT_EMAIL || null,
      jurisdiction: LEGAL_JURISDICTION || null,
    }),
    httpsPublicUrl: /^https:\/\//i.test(PUBLIC_URL),
    version: readVersion(),
  });
}

/**
 * The Stripe key's mode from its prefix alone: 'live' | 'test' | 'invalid' | 'none'. The key
 * itself never leaves this function.
 * @param {string} key
 */
export function stripeKeyMode(key) {
  const k = String(key || '');
  if (!k) return 'none';
  if (/^(sk|rk)_live_/.test(k)) return 'live';
  if (/^(sk|rk)_test_/.test(k)) return 'test';
  return 'invalid';
}

/**
 * How this server takes payments, and why (BUILD_PLAN: launch contract):
 *   'stripe'  both Stripe values are set and well formed, and a LIVE key (sk_live_/rk_live_) also
 *             has production mode and an https PUBLIC_URL;
 *   'demo'    otherwise, when demo payments are allowed (DEMO_PAYMENTS=1, or not production) and
 *             the key isn't a live one;
 *   'none'    otherwise: billing, checkout and order-payment endpoints answer 503.
 * `notes` says why in plain words for the startup log. It never contains a key or any part of one.
 */
export function paymentsPosture({ PAYMENTS = 'auto', PROD = false, PUBLIC_URL = '', DEMO_PAYMENTS = false, STRIPE_SECRET_KEY = '', STRIPE_WEBHOOK_SECRET = '' }) {
  const notes = [];
  const keyMode = stripeKeyMode(STRIPE_SECRET_KEY);
  const live = keyMode === 'live';
  const demoAllowed = (!PROD || DEMO_PAYMENTS) && !live;
  const fallback = () => {
    if (demoAllowed) return { provider: 'demo', keyMode, notes };
    if (live) notes.push('Demo payments are never used with a live Stripe key.');
    else if (PROD) notes.push('Demo payments are off in production (set DEMO_PAYMENTS=1 to allow the labelled demo).');
    return { provider: 'none', keyMode, notes };
  };
  if (PAYMENTS === 'demo') {
    notes.push('PAYMENTS=demo: Stripe is not used.');
    return fallback();
  }
  if (!STRIPE_SECRET_KEY && !STRIPE_WEBHOOK_SECRET) {
    notes.push('Stripe is not configured (STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are not set).');
    return fallback();
  }
  if (!STRIPE_SECRET_KEY) notes.push('STRIPE_SECRET_KEY is not set.');
  else if (keyMode === 'invalid') notes.push('STRIPE_SECRET_KEY is not a Stripe secret key (sk_live_/sk_test_) or restricted key (rk_live_/rk_test_). A publishable key does not work here.');
  if (!STRIPE_WEBHOOK_SECRET) notes.push('STRIPE_WEBHOOK_SECRET is not set (the signing secret of the webhook endpoint, whsec_...).');
  else if (!/^whsec_/.test(STRIPE_WEBHOOK_SECRET)) notes.push('STRIPE_WEBHOOK_SECRET is not a webhook signing secret (they start whsec_).');
  if (live && !PROD) notes.push('A live Stripe key needs production mode (npm start / --prod / NODE_ENV=production).');
  if (live && !/^https:\/\//i.test(PUBLIC_URL)) notes.push('A live Stripe key needs PUBLIC_URL to be the https address customers use (e.g. https://blumodel.studio).');
  if (notes.length) {
    notes.unshift('Stripe is NOT on:');
    return fallback();
  }
  return { provider: 'stripe', keyMode, notes };
}
