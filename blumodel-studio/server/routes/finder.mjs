// Package 'finder': choose your contractor. The quiet "Need a contractor?" link near the end of
// the journey (editor summary, after an export, the shared-kitchen page) and the #/contractors
// directory read one public, read-only endpoint:
//
//   GET /api/contractors?near=&limit=
//
// It lists contractor brand pages that are live (approved, plan active, not suspended) and
// verified, with public page fields only: what #/b/:slug already shows anyone. Never costs, the
// owner's account, or a phone number or email the contractor didn't choose to show.
//
// `near` is a city, region or postal code, matched against each contractor's free-text service
// area (see matchScore). Without it, the order rotates once a day so no contractor is always
// first: the groundwork for fair placement if listings are ever sold.

import crypto from 'node:crypto';

export const DEFAULT_LIMIT = 12;
export const MAX_LIMIT = 50;
export const FINDER_RATE = { name: 'contractor-finder', max: 120, windowMs: 600_000, by: 'ip' };

/** Canadian postal regions (the first letter of a postal code) and the names a service area may use for them. */
const POSTAL_REGIONS = {
  a: ['newfoundland', 'labrador', 'nl'],
  b: ['nova scotia', 'ns', 'halifax'],
  c: ['prince edward island', 'pei', 'pe'],
  e: ['new brunswick', 'nb'],
  g: ['quebec', 'qc'],
  h: ['quebec', 'qc', 'montreal'],
  j: ['quebec', 'qc'],
  k: ['ontario', 'on', 'eastern ontario', 'ottawa'],
  l: ['ontario', 'on', 'southern ontario', 'gta', 'greater toronto area', 'golden horseshoe'],
  m: ['ontario', 'on', 'toronto', 'gta', 'greater toronto area'],
  n: ['ontario', 'on', 'southwestern ontario', 'southern ontario'],
  p: ['ontario', 'on', 'northern ontario'],
  r: ['manitoba', 'mb', 'winnipeg'],
  s: ['saskatchewan', 'sk'],
  t: ['alberta', 'ab'],
  v: ['british columbia', 'bc', 'b.c.'],
  x: ['northwest territories', 'nunavut', 'nt', 'nu'],
  y: ['yukon', 'yt'],
};
const PROVINCE_WORDS = new Set(['ontario', 'on', 'quebec', 'qc', 'bc', 'b.c.', 'alberta', 'ab', 'manitoba', 'mb', 'saskatchewan', 'sk', 'ns', 'nb', 'pei', 'pe', 'nl', 'yt', 'nt', 'nu', 'canada']);
const EVERYWHERE = /\b(nationwide|canada[- ]wide|across canada|all of canada|anywhere in canada|everywhere)\b/;

/** Lower case, accents off (Montréal = Montreal), punctuation to spaces. */
export function fold(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `phrase` appears in `text` as whole words. */
const hasWords = (text, phrase) => !!phrase && new RegExp(`(^|[^a-z0-9])${escapeRe(phrase)}($|[^a-z0-9])`).test(text);

/** What a visitor typed, made safe and short: '' when there's nothing to search for. */
export function normaliseNear(raw) {
  if (typeof raw !== 'string') return '';
  return fold(raw.slice(0, 120)).slice(0, 60);
}

/**
 * How well a service area serves `near` (already normalised): 3 names the place, the postal
 * code's area (FSA, "L8P") or the ZIP; 1 covers its province or region, or says it works
 * everywhere; 0 no match.
 */
export function matchScore(serviceArea, near) {
  if (!near) return 0;
  const area = fold(serviceArea);
  if (!area) return 0;
  const compact = near.replace(/\s+/g, '');
  const postal = /^([a-z]\d[a-z])(\d[a-z]\d)?$/.exec(compact);
  if (postal) {
    const fsa = postal[1];
    if (hasWords(area, fsa) || (postal[2] && area.replace(/\s+/g, '').includes(compact))) return 3;
    const names = POSTAL_REGIONS[fsa[0]] ?? [];
    if (names.some((n) => hasWords(area, n))) return 1;
    return EVERYWHERE.test(area) ? 1 : 0;
  }
  const zip = /^(\d{5})(-\d{4})?$/.exec(compact);
  if (zip) {
    if (hasWords(area, zip[1])) return 3;
    return EVERYWHERE.test(area) ? 1 : 0;
  }
  if (near.length < 2) return 0;
  if (hasWords(area, near)) return 3;
  // "Hamilton ON" or "St. Catharines, Ontario": the place without its province still counts.
  const words = near.split(' ');
  if (words.length > 1 && PROVINCE_WORDS.has(words[words.length - 1]) && hasWords(area, words.slice(0, -1).join(' '))) return 3;
  // One telling word of a longer phrase ("downtown Toronto"): a weaker match.
  if (words.length > 1 && words.some((w) => w.length >= 4 && !PROVINCE_WORDS.has(w) && hasWords(area, w))) return 2;
  return EVERYWHERE.test(area) ? 1 : 0;
}

/** A stable per-day order: the same for everyone today, different tomorrow. */
const dailyKey = (slug, day) => crypto.createHash('sha256').update(`${day}|${slug}`).digest('hex');

/** Only what a directory card needs, picked from the brand page's own public header. */
function card(w) {
  return {
    slug: w.slug,
    name: w.name,
    tagline: w.tagline || '',
    logoUrl: w.logoUrl ?? null,
    serviceArea: w.serviceArea || '',
    website: w.website || '',
    verified: true,
    leadForm: !!w.leadForm,
    isDemo: !!w.isDemo,
    ...(w.phone ? { phone: w.phone } : {}),
    ...(w.email ? { email: w.email } : {}),
  };
}

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, services, config } = ctx;

  /** Every live, verified contractor page, as public cards. Demo pages never show in production. */
  const eligible = () => {
    const pages = services.brandPages;
    if (!pages) return [];
    // A plan lapses with time, not an event: hide lapsed pages before reading (cheap, throttled).
    pages.syncVisibilityDue?.();
    const rows = db
      .prepare(
        `SELECT id FROM brands
          WHERE kind = 'contractor' AND status = 'active' AND verified_at IS NOT NULL AND owner_user_id IS NOT NULL
            ${config.PROD ? 'AND is_demo = 0' : ''}`,
      )
      .all();
    const out = [];
    for (const r of rows) {
      const w = pages.publicWire(r.id);
      if (w && w.kind === 'contractor' && w.slug && w.name) out.push(card(w));
    }
    return out;
  };

  return [
    {
      method: 'GET',
      path: '/api/contractors',
      auth: 'none',
      rateLimit: FINDER_RATE,
      handler: (rc) => {
        const near = normaliseNear(rc.query.get('near'));
        const n = Number.parseInt(rc.query.get('limit') ?? '', 10);
        const limit = Number.isFinite(n) ? Math.min(MAX_LIMIT, Math.max(1, n)) : DEFAULT_LIMIT;
        const day = new Date(ctx.now()).toISOString().slice(0, 10);
        const all = eligible();
        let ranked = all.map((c) => ({ c, score: near ? matchScore(c.serviceArea, near) : 0, key: dailyKey(c.slug, day) }));
        if (near) ranked = ranked.filter((x) => x.score > 0);
        // Real pages before demo ones, then the best match, then today's rotation.
        ranked.sort((a, b) => Number(a.c.isDemo) - Number(b.c.isDemo) || b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        rc.res.setHeader('Cache-Control', 'no-store');
        return {
          contractors: ranked.slice(0, limit).map((x) => x.c),
          matched: ranked.length,
          total: all.length,
          near,
        };
      },
    },
  ];
}
