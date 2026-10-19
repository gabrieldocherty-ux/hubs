// The HTTP server with the limits a public server needs (index.mjs listens with it; tests check it).
//
//   headersTimeout 20 s       a client gets 20 s to send its request headers (slowloris)
//   requestTimeout 5 min      for the whole request, body included (a 25 MB model on a slow uplink)
//   keepAliveTimeout 5 s      an idle keep-alive connection is closed after 5 s
//   maxHeaderSize 16 KB       and at most 100 headers
//   maxRequestsPerSocket 1000 then the connection is closed and the client reconnects
//   maxConnections 1000       open sockets at once; past that new ones are dropped
// Request bodies are capped per route (server/http/body.mjs, the route's maxBytes).

import http from 'node:http';

export const HTTP_LIMITS = Object.freeze({
  headersTimeout: 20_000,
  requestTimeout: 300_000,
  keepAliveTimeout: 5_000,
  maxHeaderSize: 16 * 1024,
  maxHeadersCount: 100,
  maxRequestsPerSocket: 1_000,
  maxConnections: 1_000,
  connectionsCheckingInterval: 5_000,
});

/**
 * @param {import('node:http').RequestListener} handler
 * @param {Partial<typeof HTTP_LIMITS>} [over]  tests shorten the timeouts
 */
export function createHttpServer(handler, over = {}) {
  const l = { ...HTTP_LIMITS, ...over };
  const server = http.createServer(
    { maxHeaderSize: l.maxHeaderSize, headersTimeout: l.headersTimeout, requestTimeout: l.requestTimeout, connectionsCheckingInterval: l.connectionsCheckingInterval },
    handler,
  );
  server.keepAliveTimeout = l.keepAliveTimeout;
  server.maxHeadersCount = l.maxHeadersCount;
  server.maxRequestsPerSocket = l.maxRequestsPerSocket;
  server.maxConnections = l.maxConnections;
  return server;
}
