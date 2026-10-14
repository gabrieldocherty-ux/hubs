// Seams between the foundation and the billing (G) and contractor (H) packages
// (BUILD_PLAN §13.2). Each service has a safe default so the app is correct before a
// package registers its implementation:
//
//   services.webhooks     on(kind, handler) / dispatch(event): Stripe events, routed by
//                         event type and by data.object.metadata.kind.
//   services.billing      planOf / canExport. Default: everyone is Free and nothing exports,
//                         so the paywall fails closed.
//   services.pricing      what other people see of a kitchen's prices. Default: list prices,
//                         and cost / margin fields are always stripped for non-owners.
//   services.contractors  "Prepared by" branding and a product label. Default: none.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Keys that hold a contractor's private numbers. Never sent to anyone but the contractor. */
export const COST_KEYS = Object.freeze(['cost', 'costCents', 'costByWidth', 'unitCost', 'costTotal', 'margin', 'marginPct', 'markupPct']);

/** A shallow copy of `obj` without any COST_KEYS. */
export function withoutCosts(obj) {
  if (!isObj(obj)) return obj;
  let out = null;
  for (const k of COST_KEYS) {
    if (k in obj) {
      out ??= { ...obj };
      delete out[k];
    }
  }
  return out ?? obj;
}

/** The doc with cost fields removed from extra lines and product snapshots. */
export function stripDocCosts(doc) {
  if (!isObj(doc)) return doc;
  const out = { ...doc };
  if (Array.isArray(doc.extras)) out.extras = doc.extras.map(withoutCosts);
  if (isObj(doc.products)) out.products = Object.fromEntries(Object.entries(doc.products).map(([k, p]) => [k, withoutCosts(p)]));
  return out;
}

export function createWebhookService() {
  /** @type {Map<string, ((event: any) => void)[]>} */
  const handlers = new Map();
  return {
    /**
     * Registers a handler for a Stripe event type (`invoice.paid`, contains a dot) or for a
     * `metadata.kind` set on the object at checkout (`order`, `kitchen_unlock`,
     * `subscription`). Handlers run synchronously inside the webhook's transaction: if one
     * throws, the event is not recorded and Stripe retries it.
     */
    on(kind, handler) {
      if (typeof kind !== 'string' || !kind) throw new Error('webhooks.on(kind, handler): kind must be a string.');
      if (typeof handler !== 'function') throw new Error('webhooks.on(kind, handler): handler must be a function.');
      handlers.set(kind, [...(handlers.get(kind) ?? []), handler]);
    },
    /** Runs every handler for the event's type and its object's metadata.kind. Returns how many ran. */
    dispatch(event) {
      const kinds = new Set([event?.type, event?.data?.object?.metadata?.kind].filter((k) => typeof k === 'string' && k));
      let ran = 0;
      for (const k of kinds) {
        for (const h of handlers.get(k) ?? []) {
          const out = h(event);
          if (out && typeof out.then === 'function') throw new Error(`Webhook handler for "${k}" must be synchronous.`);
          ran++;
        }
      }
      return ran;
    },
  };
}

const FREE = Object.freeze({ id: 'free', status: 'none', periodEnd: null, cancelAtPeriodEnd: false, graceUntil: null, provider: null });

export function createBillingHooks() {
  let impl = null;
  return {
    /** `{ id: 'free'|'unlimited'|'contractor', status, periodEnd, cancelAtPeriodEnd, graceUntil, provider }`. */
    planOf: (userId) => (impl && userId ? impl.planOf(userId) : FREE),
    /** True when `userId` may export `projectId` (they own it, and it is unlocked or they have a plan). */
    canExport: (userId, projectId) => (impl && userId && projectId ? !!impl.canExport(userId, projectId) : false),
    register(next) {
      if (!next || typeof next.planOf !== 'function' || typeof next.canExport !== 'function') throw new Error('billing.register needs planOf and canExport.');
      impl = next;
    },
  };
}

export function createPricingHooks() {
  let impl = null;
  return {
    /**
     * The products as `viewer` may see them in a kitchen owned by `ownerUserId`: a
     * contractor's sell prices once package H registers, list prices before. Cost and
     * margin never survive, whoever the viewer is.
     */
    applyForViewer(ownerUserId, products, { viewer = null } = {}) {
      const list = Array.isArray(products) ? products : [];
      const priced = impl ? impl.applyForViewer(ownerUserId, list, { viewer }) : list;
      return priced.map(withoutCosts);
    },
    /** The doc with cost fields stripped unless `viewer` is the owner. */
    stripDoc(doc, { viewer = null, ownerUserId = null } = {}) {
      if (viewer && ownerUserId && viewer.id === ownerUserId) return doc;
      return stripDocCosts(impl?.stripDoc ? impl.stripDoc(doc, { viewer, ownerUserId }) : doc);
    },
    /**
     * Sell prices for every product a doc uses, keyed by product id (built-ins included,
     * since they are priced in the browser): `{ [id]: { price, priceByWidth? } }`, or null
     * when the owner has no price book. Share pages pass this to the client.
     */
    sellPricesFor(ownerUserId, doc) {
      return impl?.sellPricesFor ? impl.sellPricesFor(ownerUserId, doc) : null;
    },
    /**
     * The owner's price book (`PriceBookData`, see src/types/platform.ts) for server-made
     * exports and quotes, or null to use list prices. Server-internal: it holds costs.
     */
    priceBookFor(ownerUserId) {
      return impl?.priceBookFor && ownerUserId ? impl.priceBookFor(ownerUserId) : null;
    },
    register(next) {
      if (!next || typeof next.applyForViewer !== 'function') throw new Error('pricing.register needs applyForViewer.');
      impl = next;
    },
  };
}

export function createContractorHooks() {
  let impl = null;
  return {
    /** `{ company, logoUrl?, phone?, email?, website? }` for a contractor's shares, or null. Share pages hide "Duplicate" when set. */
    brandingFor: (userId) => (impl && userId ? impl.brandingFor(userId) : null),
    /** `{ company, active }` for the session (`/api/auth/me`), or null when the user isn't a contractor. */
    summaryFor: (userId) => (impl?.summaryFor && userId ? impl.summaryFor(userId) : null),
    /** The display name on a contractor's own products (their company), or null. */
    labelFor: (userId) => (impl?.labelFor && userId ? impl.labelFor(userId) : null),
    register(next) {
      if (!next || typeof next.brandingFor !== 'function') throw new Error('contractors.register needs brandingFor.');
      impl = next;
    },
  };
}
