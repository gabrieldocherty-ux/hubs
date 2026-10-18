// Product analytics events (ctx.services.events). Stores the product, its brand, the
// type, the user id if signed in and the UTC day. Never an IP address.

import { PRODUCT_ID_RE } from '../lib/ids.mjs';

export const EVENT_TYPES = ['view', 'add', 'buy_click', 'render'];

export const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export function createEventService({ db, now = Date.now }) {
  return {
    /**
     * Records one event. A built-in or unknown product id is a no-op (returns false).
     */
    record({ productId, type, userId = null, tenantId = null }) {
      if (!EVENT_TYPES.includes(type)) throw new Error(`events.record: bad type ${type}`);
      if (typeof productId !== 'string' || !PRODUCT_ID_RE.test(productId)) return false;
      // Only a product of the site the event comes from (a showroom's own; a sales-site event about
      // a showroom's product is ignored too).
      const p = db.prepare('SELECT id, brand_id FROM products WHERE id = ? AND tenant_id IS ?').get(productId, tenantId ?? null);
      if (!p) return false;
      const t = now();
      db.prepare('INSERT INTO product_events (product_id, brand_id, type, user_id, day, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(p.id, p.brand_id ?? null, type, userId, utcDay(t), t);
      return true;
    },
  };
}
