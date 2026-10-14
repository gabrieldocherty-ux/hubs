import { useEffect } from 'react';
import { create } from 'zustand';
import type { AppConfig, LegalConfig } from '../types/platform';
import { call } from './api';
import { QA } from './qa';

/**
 * What this server is set up for (`GET /api/config`), loaded once and shared by every screen:
 * whether payments are real (Stripe), the labelled demo, or not open yet, and who runs the site
 * (for the legal pages). Older servers send neither `publicUrl` nor `legal`, and say `demo` with
 * `demoPayments: false` when the demo is refused: that is "payments not open yet" too.
 */
export type PaymentsMode = 'stripe' | 'demo' | 'none';

export interface ClientConfig {
  payments: PaymentsMode;
  publicUrl: string;
  legal: LegalConfig;
  llm: boolean;
}

export const PUBLIC_URL = 'https://blumodel.studio';
export const NO_LEGAL: LegalConfig = Object.freeze({ ready: false, businessName: null, supportEmail: null, jurisdiction: null });

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s && s.length <= max ? s : null;
};
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

/** The legal block, trimmed and checked: a value that isn't usable is treated as not set. */
export function normalizeLegal(raw: unknown): LegalConfig {
  const l = (raw ?? {}) as Partial<Record<keyof LegalConfig, unknown>>;
  const businessName = text(l.businessName, 120);
  const email = text(l.supportEmail, 200);
  const supportEmail = email && EMAIL.test(email) ? email : null;
  const jurisdiction = text(l.jurisdiction, 120);
  return { ready: l.ready === true && !!businessName && !!supportEmail, businessName, supportEmail, jurisdiction };
}

export function normalizeConfig(raw: Partial<AppConfig> | null | undefined): ClientConfig {
  const r = raw ?? {};
  const payments: PaymentsMode = r.payments === 'stripe' ? 'stripe' : r.payments === 'demo' && r.demoPayments !== false ? 'demo' : 'none';
  const url = typeof r.publicUrl === 'string' && /^https?:\/\/[^\s]+$/.test(r.publicUrl) ? r.publicUrl.replace(/\/+$/, '') : PUBLIC_URL;
  return { payments, publicUrl: url, legal: normalizeLegal(r.legal), llm: r.llm === true };
}

// ── QA-only override ─────────────────────────────────────────────────────────
// Under `?qa` (never otherwise), `#/<route>?qa-payments=none|demo|stripe&qa-legal=ready|unset`
// replaces those two answers for the rest of the tab's session, so QA can show every payment
// state against its one demo server. Nothing reads it without the flag.

const QA_KEY = 'blumodel.qa.config';
export const QA_LEGAL: LegalConfig = Object.freeze({ ready: true, businessName: 'Sample Kitchen Co. (QA)', supportEmail: 'help@example.test', jurisdiction: 'Ontario, Canada' });

interface QaOverride {
  payments?: PaymentsMode;
  legal?: 'ready' | 'unset';
}

export function readQaOverride(hash: string, saved: string | null): QaOverride {
  const q = new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '');
  let base: QaOverride = {};
  try {
    base = saved ? (JSON.parse(saved) as QaOverride) : {};
  } catch {
    base = {};
  }
  const p = q.get('qa-payments');
  const l = q.get('qa-legal');
  return {
    ...base,
    ...(p === 'none' || p === 'demo' || p === 'stripe' ? { payments: p } : {}),
    ...(l === 'ready' || l === 'unset' ? { legal: l } : {}),
  };
}

export function applyQaOverride(c: ClientConfig, o: QaOverride): ClientConfig {
  return {
    ...c,
    ...(o.payments ? { payments: o.payments } : {}),
    ...(o.legal === 'ready' ? { legal: QA_LEGAL } : o.legal === 'unset' ? { legal: NO_LEGAL } : {}),
  };
}

function qaOverride(): QaOverride {
  if (!QA) return {};
  try {
    const o = readQaOverride(location.hash, sessionStorage.getItem(QA_KEY));
    sessionStorage.setItem(QA_KEY, JSON.stringify(o));
    return o;
  } catch {
    return readQaOverride(location.hash, null);
  }
}

// ── the store ────────────────────────────────────────────────────────────────

interface ConfigState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  config: ClientConfig | null;
}

export const useConfig = create<ConfigState>()(() => ({ status: 'idle', config: null }));

let inflight: Promise<ClientConfig | null> | null = null;

/** Loads `/api/config` once (again with `force`, e.g. the connection banner's Retry). Never throws. */
export function loadConfig(force = false): Promise<ClientConfig | null> {
  const s = useConfig.getState();
  if (!force && s.status === 'ready') return Promise.resolve(s.config);
  if (inflight) return inflight;
  if (s.status !== 'ready') useConfig.setState({ status: 'loading' });
  const p = call<AppConfig>('GET', '/api/config')
    .then((raw) => {
      const config = applyQaOverride(normalizeConfig(raw), qaOverride());
      useConfig.setState({ status: 'ready', config });
      return config;
    })
    .catch(() => {
      // Keep a config we already had; without one, screens show their "can't tell yet" state.
      if (useConfig.getState().status !== 'ready') useConfig.setState({ status: 'error' });
      return useConfig.getState().config;
    })
    .finally(() => {
      inflight = null;
    });
  inflight = p;
  return p;
}

/** This server's config, loading it on first use; null until it has answered. */
export function useAppConfig(): ClientConfig | null {
  const config = useConfig((s) => s.config);
  const status = useConfig((s) => s.status);
  useEffect(() => {
    if (status === 'idle') void loadConfig();
  }, [status]);
  return config;
}

/** `stripe`, `demo` or `none`; null while unknown (loading, or the server can't be reached). */
export function usePayments(): PaymentsMode | null {
  return useAppConfig()?.payments ?? null;
}

/** Who runs the site; "not set" until the config has loaded. */
export function useLegal(): LegalConfig {
  return useAppConfig()?.legal ?? NO_LEGAL;
}
