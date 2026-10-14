// Operations: the health check and robots.txt. Public, cheap, and nothing secret in either.
//
//   GET /api/health   { ok, version, uptimeSec, db }   503 when the database can't answer (or
//                     failed its startup integrity check, db: 'corrupt'), or while shutting down
//   GET /robots.txt   crawl the app, not /api or /files

export const ROBOTS = 'User-agent: *\nAllow: /\nDisallow: /api\nDisallow: /files\n';

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, config } = ctx;
  return [
    {
      method: 'GET',
      path: '/api/health',
      auth: 'none',
      handler: (rc) => {
        let state = 'ok';
        try {
          db.prepare('SELECT 1 AS one').get();
        } catch {
          state = 'error';
        }
        if (state === 'ok' && ctx.health.integrity && !ctx.health.integrity.ok) state = 'corrupt';
        const ok = state === 'ok' && !ctx.health.shuttingDown;
        rc.send(ok ? 200 : 503, {
          ok,
          version: config.version,
          uptimeSec: Math.max(0, Math.floor((ctx.now() - ctx.startedAt) / 1000)),
          db: state,
          ...(ctx.health.shuttingDown ? { shuttingDown: true } : {}),
        });
      },
    },
    {
      method: 'GET',
      path: '/robots.txt',
      auth: 'none',
      handler: (rc) => {
        rc.sent = true;
        rc.res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400', 'Content-Length': Buffer.byteLength(ROBOTS) });
        rc.res.end(rc.method === 'HEAD' ? undefined : ROBOTS);
      },
    },
  ];
}
