/**
 * Test tool: a reverse proxy that reproduces the Arena preview path as observed on 2026-10-30 —
 * every request is forwarded WITHOUT its Cookie and Referer headers, while responses (including
 * Set-Cookie) pass through unchanged. The browser stores cookies but never sends them back.
 * Used by the `preview-proxy` Playwright project (e2e/preview-proxy.spec.ts).
 *
 *   PROXY_PORT=3201 PROXY_TARGET=http://127.0.0.1:3200 npx tsx scripts/cookie-stripping-proxy.ts
 */
import http from 'node:http';

const port = Number(process.env.PROXY_PORT ?? 3201);
const target = new URL(process.env.PROXY_TARGET ?? 'http://127.0.0.1:3200');

const server = http.createServer((req, res) => {
  const headers = { ...req.headers };
  delete headers.cookie;
  delete headers.referer;
  const upstream = http.request(
    { host: target.hostname, port: target.port, method: req.method, path: req.url, headers },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('upstream unavailable');
  });
  req.pipe(upstream);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`cookie-stripping proxy on http://localhost:${port} → ${target.origin} (drops Cookie and Referer)`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => process.exit(0)));
