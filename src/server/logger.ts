import 'server-only';

/**
 * Minimal structured logger.
 * - Production: one JSON object per line on stdout/stderr (ready for `docker logs`, journald,
 *   Loki, CloudWatch, Better Stack…).
 * - Development: readable single-line output.
 * Field names that look like secrets are redacted, so credentials and tokens never reach logs.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const SECRET_KEY = /pass(word|wd)?|secret|token|authorization|cookie|api[-_]?key|store_passwd|verify_sign|signature/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, ...(process.env.NODE_ENV !== 'production' ? { stack: value.stack } : {}) };
  }
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) ? '[redacted]' : sanitize(v, depth + 1);
  }
  return out;
}

function write(level: Level, event: string, fields: Fields = {}) {
  if (level === 'debug' && process.env.NODE_ENV === 'production') return;
  if (process.env.NODE_ENV === 'test' && level !== 'error' && !process.env.LOG_IN_TESTS) return;
  const clean = sanitize(fields) as Fields;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  if (process.env.NODE_ENV === 'production' || process.env.LOG_FORMAT === 'json') {
    stream.write(`${JSON.stringify({ time: new Date().toISOString(), level, event, ...clean })}\n`);
  } else {
    const extra = Object.keys(clean).length ? ` ${JSON.stringify(clean)}` : '';
    stream.write(`[${level}] ${event}${extra}\n`);
  }
}

export const log = {
  debug: (event: string, fields?: Fields) => write('debug', event, fields),
  info: (event: string, fields?: Fields) => write('info', event, fields),
  warn: (event: string, fields?: Fields) => write('warn', event, fields),
  error: (event: string, fields?: Fields) => write('error', event, fields),
};

/** Exported for unit tests. */
export const __sanitizeForTests = sanitize;
