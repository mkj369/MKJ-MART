/**
 * Local mail catcher for development and E2E tests — a real SMTP server that keeps messages in
 * memory and shows them over HTTP (like MailHog / Mailpit). Never use it in production.
 *
 *   npm run mail:dev            # SMTP on 127.0.0.1:1025, inbox at http://127.0.0.1:1080
 *   then in .env.local:  SMTP_HOST=127.0.0.1  SMTP_PORT=1025  SMTP_REQUIRE_TLS=false  SMTP_FROM="MKJ Store <dev@localhost>"
 *
 * HTTP API:  GET /messages[?to=address]  → JSON list (newest last)   ·   DELETE /messages → clear
 */
import { createServer } from 'node:http';
import { startMailServer } from '../tests/support/mail-server';

const SMTP_PORT = Number(process.env.MAIL_CATCHER_SMTP_PORT ?? 1025);
const HTTP_PORT = Number(process.env.MAIL_CATCHER_HTTP_PORT ?? 1080);

async function main() {
  const mail = await startMailServer({ port: SMTP_PORT });
  const http = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${HTTP_PORT}`);
    if (url.pathname === '/messages' && req.method === 'DELETE') {
      mail.inbox.length = 0;
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === '/messages') {
      const to = url.searchParams.get('to')?.toLowerCase();
      const list = mail.inbox.filter((m) => !to || m.to.some((t) => t.toLowerCase() === to)).map(({ raw: _raw, ...m }) => m);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(list));
      return;
    }
    const rows = mail.inbox
      .map((m, i) => `<li><b>${i + 1}.</b> ${escape(m.subject)} → ${escape(m.to.join(', '))}<pre>${escape(m.text)}</pre></li>`)
      .reverse()
      .join('');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><title>Mail catcher</title><h1>${mail.inbox.length} message(s)</h1><ol>${rows}</ol>`);
  });
  await new Promise<void>((resolve) => http.listen(HTTP_PORT, '127.0.0.1', resolve));
  console.log(`✉  Mail catcher: SMTP 127.0.0.1:${mail.port} · inbox http://127.0.0.1:${HTTP_PORT}`);
}

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

main().catch((err) => {
  console.error('✖ mail catcher failed:', err);
  process.exit(1);
});
