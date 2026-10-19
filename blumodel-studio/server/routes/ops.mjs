// Operations: the health check and robots.txt. Public, cheap, and nothing secret in either.
//
//   GET /api/health   { ok, version, uptimeSec, db, maintenance? }   503 when the database can't answer (or
//                     failed its startup integrity check, db: 'corrupt'), or while shutting down
//   GET /robots.txt   search engines may index the pages (the sales site, a showroom's pages), never
//                     /api or /files; the known AI-training and AI-answer crawlers may take nothing.
//                     It asks; it can't force. The real limits are server/http/readLimits.mjs, the
//                     X-Robots-Tag on every model and image, and the terms (docs/handoff/protect.md).

/** Crawlers that gather pages for AI training or AI answers, by their published user-agent tokens. */
export const AI_CRAWLERS = Object.freeze([
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'CCBot',
  'Google-Extended',
  'GoogleOther',
  'Applebot-Extended',
  'ClaudeBot',
  'Claude-Web',
  'Claude-User',
  'Claude-SearchBot',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Bytespider',
  'Amazonbot',
  'meta-externalagent',
  'Meta-ExternalFetcher',
  'FacebookBot',
  'cohere-ai',
  'cohere-training-data-crawler',
  'Diffbot',
  'ImagesiftBot',
  'Omgilibot',
  'Omgili',
  'Timpibot',
  'YouBot',
  'DuckAssistBot',
  'AI2Bot',
  'Ai2Bot-Dolma',
  'PanguBot',
  'Webzio-Extended',
  'img2dataset',
]);

export const ROBOTS = [
  ...AI_CRAWLERS.map((ua) => `User-agent: ${ua}`),
  'Disallow: /',
  '',
  'User-agent: *',
  'Content-Signal: search=yes, ai-input=no, ai-train=no',
  'Allow: /',
  'Disallow: /api',
  'Disallow: /files',
  '',
].join('\n');

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
          // Every site switched off (ops/sitesSwitch.mjs): the server itself is healthy, so still 200.
          ...(ctx.sitesSwitch && !ctx.sitesSwitch.isOn() ? { maintenance: true } : {}),
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
