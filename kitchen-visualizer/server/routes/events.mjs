// Product analytics beacons. Anonymous allowed; built-in or unknown ids are a no-op.

import { HttpError } from '../http/respond.mjs';
import { EVENT_TYPES } from '../catalog/events.mjs';

/** @param {any} ctx */
export default function routes(ctx) {
  const { events } = ctx.services;
  return [
    {
      method: 'POST',
      path: '/api/events',
      auth: 'optional',
      maxBytes: 4_096,
      rateLimit: { name: 'events', max: 600, windowMs: 3_600_000, by: 'ip' },
      handler: (rc) => {
        const { productId, type } = rc.body;
        if (!EVENT_TYPES.includes(type)) throw new HttpError(400, 'Unknown event type.');
        if (typeof productId !== 'string' || productId.length > 80) throw new HttpError(400, 'Which product?');
        events.record({ productId, type, userId: rc.user?.id ?? null });
        rc.send(204);
      },
    },
  ];
}
