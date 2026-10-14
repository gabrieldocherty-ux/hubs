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
  const DB_PATH = env.DB_PATH || path.join(SERVER_DIR, 'data', 'mise.db');
  const UPLOAD_DIR = path.resolve(env.UPLOAD_DIR || path.join(DB_PATH === ':memory:' ? path.join(SERVER_DIR, 'data') : path.dirname(DB_PATH), 'uploads'));
  const DIST_DIR = path.resolve(env.DIST_DIR || path.join(SERVER_DIR, '..', 'dist'));
  const PUBLIC_URL = (env.PUBLIC_URL || `http://127.0.0.1:${PORT}`).replace(/\/+$/, '');
  // Number of trusted reverse proxies in front of the server (0 = none). Express-style:
  // with N proxies, the client address is the Nth X-Forwarded-For entry from the right.
  const tp = String(env.TRUST_PROXY ?? '').trim().toLowerCase();
  const TRUST_PROXY = /^\d+$/.test(tp) ? Math.min(10, Number(tp)) : bool(tp) ? 1 : 0;
  const ADMIN_EMAILS = String(env.ADMIN_EMAILS || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const MAX_GLB_MB = int(env.MAX_GLB_MB, 25, 1, 200);
  const MAX_IMAGE_MB = int(env.MAX_IMAGE_MB, 8, 1, 100);
  const BRAND_PRODUCT_LIMIT = int(env.BRAND_PRODUCT_LIMIT, 50, 0, 100_000);

  const STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY || '';
  const STRIPE_WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET || '';
  const PAYMENTS = (env.PAYMENTS || 'auto').trim().toLowerCase();
  if (!['auto', 'demo', 'stripe'].includes(PAYMENTS)) throw new Error(`PAYMENTS must be auto, demo or stripe (got "${PAYMENTS}").`);
  const stripeReady = !!(STRIPE_SECRET_KEY && STRIPE_WEBHOOK_SECRET);
  if (PAYMENTS === 'stripe' && !stripeReady) throw new Error('PAYMENTS=stripe needs both STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.');
  const paymentsProvider = PAYMENTS === 'demo' ? 'demo' : PAYMENTS === 'stripe' ? 'stripe' : stripeReady ? 'stripe' : 'demo';
  const DEMO_PAYMENTS = bool(env.DEMO_PAYMENTS);

  const ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY || '';
  const MISE_LLM_MODEL = env.MISE_LLM_MODEL || '';
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
    MISE_LLM_MODEL,
    SEED_PASSWORD,
    RATE_LIMITS,
    // derived
    paymentsProvider,
    llmEnabled: !!(ANTHROPIC_API_KEY && MISE_LLM_MODEL),
    demoPaymentsAllowed: !PROD || DEMO_PAYMENTS,
    version: readVersion(),
  });
}
