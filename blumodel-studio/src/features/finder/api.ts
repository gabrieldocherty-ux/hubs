import { useEffect, useState } from 'react';
import { call } from '../../lib/api';

/** One contractor on GET /api/contractors: their brand page's public header, nothing more. */
export interface ContractorCard {
  slug: string;
  name: string;
  tagline: string;
  logoUrl: string | null;
  serviceArea: string;
  website: string;
  verified: true;
  /** Takes requests through the lead form ("Ask for a quote"). */
  leadForm: boolean;
  isDemo: boolean;
  /** Only when the contractor chose to show them on their page. */
  phone?: string;
  email?: string;
}

export interface ContractorList {
  contractors: ContractorCard[];
  /** How many matched `near` (all of them without it). */
  matched: number;
  /** Every listed contractor, matched or not. */
  total: number;
  /** The search as the server understood it ('' for none). */
  near: string;
}

export const finderApi = {
  list: ({ near = '', limit }: { near?: string; limit?: number } = {}, signal?: AbortSignal) => {
    const q = new URLSearchParams();
    if (near.trim()) q.set('near', near.trim());
    if (limit) q.set('limit', String(limit));
    const s = q.toString();
    return call<ContractorList>('GET', `/api/contractors${s ? `?${s}` : ''}`, undefined, { signal });
  },
};

// ── the place a visitor last searched, so the popover can show who serves it ──

const NEAR_KEY = 'blumodel-finder-near';

export function rememberedNear(): string {
  try {
    return (localStorage.getItem(NEAR_KEY) ?? '').slice(0, 60);
  } catch {
    return '';
  }
}

export function rememberNear(near: string) {
  try {
    if (near.trim()) localStorage.setItem(NEAR_KEY, near.trim().slice(0, 60));
    else localStorage.removeItem(NEAR_KEY);
  } catch {
    // Storage blocked: the popover just shows today's rotation.
  }
}

// ── the popover's short list, fetched once per few minutes per page ──

export const POPOVER_LIMIT = 3;
const TTL = 5 * 60_000;
let cached: { key: string; at: number; p: Promise<ContractorList | null> } | null = null;

/**
 * Up to three contractors for the popover: who serves the place the visitor last searched, or
 * today's rotation when nobody does (or nothing was searched). Null on any failure: the link
 * then doesn't render, like when there are no contractors.
 */
export function loadShortList(): Promise<ContractorList | null> {
  const near = rememberedNear();
  const now = Date.now();
  if (cached && cached.key === near && now - cached.at < TTL) return cached.p;
  const p = (async () => {
    try {
      if (near) {
        const r = await finderApi.list({ near, limit: POPOVER_LIMIT });
        if (r.contractors.length) return r;
      }
      return await finderApi.list({ limit: POPOVER_LIMIT });
    } catch {
      return null;
    }
  })();
  cached = { key: near, at: now, p };
  // A failure isn't kept: the next mount may try again.
  void p.then((r) => {
    if (!r && cached?.p === p) cached = null;
  });
  return p;
}

/** The popover's list; null while loading, on failure, or when `enabled` is false. */
export function useShortList(enabled: boolean): ContractorList | null {
  const [list, setList] = useState<ContractorList | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadShortList().then((r) => live && setList(r));
    return () => {
      live = false;
    };
  }, [enabled]);
  return enabled ? list : null;
}
