/**
 * A real SMTP server (smtp-server package) for integration tests and the local mail catcher.
 * Messages are delivered over the SMTP protocol by nodemailer exactly as in production.
 */
import { SMTPServer } from 'smtp-server';

export type CapturedMail = { from: string; to: string[]; subject: string; text: string; html: string; raw: string };

function decodeQuotedPrintable(input: string): string {
  const bytes: number[] = [];
  const s = input.replace(/=\r?\n/g, '');
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(s[i]!, 'utf8'));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function decodeHeaderWord(value: string): string {
  return value.replace(/=\?utf-8\?([QB])\?([^?]*)\?=/gi, (_, enc: string, text: string) =>
    enc.toUpperCase() === 'B' ? Buffer.from(text, 'base64').toString('utf8') : decodeQuotedPrintable(text.replace(/_/g, ' ')),
  );
}

function splitHeaders(part: string): { headers: Record<string, string>; body: string } {
  const index = part.search(/\r?\n\r?\n/);
  const head = index === -1 ? part : part.slice(0, index);
  const body = index === -1 ? '' : part.slice(index).replace(/^\r?\n\r?\n/, '');
  const headers: Record<string, string> = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { headers, body };
}

function decodeBody(headers: Record<string, string>, body: string): string {
  const encoding = (headers['content-transfer-encoding'] ?? '').toLowerCase();
  if (encoding === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(body);
  return body;
}

export function parseMail(raw: string, envelope: { from: string; to: string[] }): CapturedMail {
  const { headers, body } = splitHeaders(raw);
  let text = '';
  let html = '';
  const collect = (h: Record<string, string>, b: string) => {
    const type = (h['content-type'] ?? 'text/plain').toLowerCase();
    const boundary = /boundary="?([^";]+)"?/i.exec(h['content-type'] ?? '')?.[1];
    if (type.startsWith('multipart/') && boundary) {
      for (const part of b.split(`--${boundary}`).slice(1)) {
        if (part.startsWith('--')) break;
        const parsed = splitHeaders(part.replace(/^\r?\n/, ''));
        collect(parsed.headers, parsed.body);
      }
    } else if (type.startsWith('text/html')) html += decodeBody(h, b);
    else if (type.startsWith('text/plain')) text += decodeBody(h, b);
  };
  collect(headers, body);
  return { from: envelope.from, to: envelope.to, subject: decodeHeaderWord(headers.subject ?? ''), text, html, raw };
}

export async function startMailServer(options: { rejectRecipients?: string[] } = {}) {
  const inbox: CapturedMail[] = [];
  const server = new SMTPServer({
    secure: false,
    authOptional: true,
    disabledCommands: ['STARTTLS', 'AUTH'],
    logger: false,
    onRcptTo(address, _session, callback) {
      if (options.rejectRecipients?.includes(address.address.toLowerCase())) {
        const error = new Error('Mailbox unavailable') as Error & { responseCode: number };
        error.responseCode = 550;
        return callback(error);
      }
      callback();
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const envelope = {
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map((r) => r.address),
        };
        inbox.push(parseMail(raw, envelope));
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    port,
    inbox,
    /** Configures the app's SMTP env vars to deliver to this server. */
    useForApp() {
      process.env.SMTP_HOST = '127.0.0.1';
      process.env.SMTP_PORT = String(port);
      process.env.SMTP_SECURE = 'false';
      process.env.SMTP_REQUIRE_TLS = 'false';
      process.env.SMTP_FROM = 'MKJ Store <orders@example.test>';
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
