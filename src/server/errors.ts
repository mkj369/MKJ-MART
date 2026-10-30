/**
 * Domain errors. Services throw these; the API layer maps them to HTTP responses with a stable
 * machine-readable `code`, so clients (web UI, future MKJ apps) can react programmatically.
 */
export type FieldErrors = Record<string, string>;

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: FieldErrors;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: { fields?: FieldErrors; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = extra.fields;
    this.details = extra.details;
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST', details?: unknown) =>
  new AppError(400, code, message, { details });

export const unauthorized = (message = 'Please sign in to continue.') =>
  new AppError(401, 'UNAUTHENTICATED', message);

export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Not found.') => new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string, code = 'CONFLICT', details?: unknown) =>
  new AppError(409, code, message, { details });

export const validationError = (fields: FieldErrors, message = 'Please correct the highlighted fields.') =>
  new AppError(422, 'VALIDATION_ERROR', message, { fields });

export const tooManyRequests = (retryAfterSeconds: number) =>
  new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a moment and try again.', {
    details: { retryAfterSeconds },
  });

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Postgres unique-violation detection (code 23505), optionally for a specific constraint. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const err = findPgError(error);
  return !!err && err.code === '23505' && (!constraint || err.constraint === constraint);
}

export function isCheckViolation(error: unknown, constraint?: string): boolean {
  const err = findPgError(error);
  return !!err && err.code === '23514' && (!constraint || err.constraint === constraint);
}

export function isForeignKeyViolation(error: unknown): boolean {
  return findPgError(error)?.code === '23503';
}

type PgError = { code?: string; constraint?: string };

/** Drizzle wraps driver errors; walk the `cause` chain to find the pg error. */
function findPgError(error: unknown): PgError | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const candidate = current as PgError & { cause?: unknown };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) return candidate;
    current = candidate.cause;
  }
  return null;
}
