import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError, forbidden, isAppError, notFound, unauthorized, validationError } from '@/server/errors';
import {
  GUEST_CART_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions,
  validateSessionToken,
  type SessionUser,
  type ValidatedSession,
} from '@/server/auth/session';
import { can, isStaffRole, type Permission } from '@/lib/permissions';
import { zodFieldErrors } from '@/lib/validation/common';
import { log } from '@/server/logger';
import { clientIp, isSameOriginRequest, userAgent } from './request';

type CookieOp =
  | { kind: 'set'; name: string; value: string; options: Parameters<NextResponse['cookies']['set']>[2] }
  | { kind: 'delete'; name: string };

export type ApiContext<P> = {
  req: NextRequest;
  params: P;
  session: ValidatedSession | null;
  user: SessionUser | null;
  ip: string | null;
  userAgent: string | null;
  guestCartId: string | null;
  /** Throws 401 unless signed in. */
  requireUser(): SessionUser;
  /** Throws 401/403 unless the user is staff with the given permission. */
  requirePermission(permission: Permission): SessionUser;
  /** Parses and validates the JSON body; throws 422 with field errors. */
  body<S extends z.ZodType>(schema: S): Promise<z.output<S>>;
  /** Validates query-string parameters. */
  query<S extends z.ZodType>(schema: S): z.output<S>;
  setCookie(name: string, value: string, options: Parameters<NextResponse['cookies']['set']>[2]): void;
  deleteCookie(name: string): void;
};

type Handler<P> = (ctx: ApiContext<P>) => Promise<unknown>;

type RouteOptions = {
  /** Disable the same-origin check (only for third-party callbacks such as payment gateways). */
  csrf?: boolean;
};

const MAX_JSON_BYTES = 256 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function jsonError(status: number, code: string, message: string, extra: { fields?: Record<string, string>; details?: unknown } = {}) {
  return NextResponse.json(
    { error: { code, message, ...(extra.fields ? { fields: extra.fields } : {}), ...(extra.details !== undefined ? { details: extra.details } : {}) } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * Wraps a Route Handler with the platform's cross-cutting concerns:
 * CSRF protection, session resolution (with sliding refresh), validation, consistent JSON
 * envelopes (`{ data }` / `{ error }`), cookie management and error mapping.
 */
export function route<P extends Record<string, string> = Record<string, never>>(handler: Handler<P>, options: RouteOptions = {}) {
  return async (req: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    const cookieOps: CookieOp[] = [];
    try {
      const method = req.method.toUpperCase();
      const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      if (mutating && options.csrf !== false && !isSameOriginRequest(req.headers)) {
        throw new AppError(403, 'CSRF_REJECTED', 'Cross-site request blocked.');
      }

      const token = req.cookies.get(SESSION_COOKIE)?.value;
      const session = token ? await validateSessionToken(token, { slide: true }) : null;
      if (token && !session) cookieOps.push({ kind: 'delete', name: SESSION_COOKIE });
      if (session?.refreshed && token) {
        cookieOps.push({ kind: 'set', name: SESSION_COOKIE, value: token, options: sessionCookieOptions(session.expiresAt) });
      }

      const params = ((await context?.params) ?? {}) as P;
      // Convention: `id` / `*Id` path params are UUIDs. Reject malformed ones before they reach SQL.
      for (const [key, value] of Object.entries(params)) {
        if ((key === 'id' || key.endsWith('Id')) && !UUID_RE.test(String(value))) throw notFound();
      }
      const user = session?.user ?? null;

      const ctx: ApiContext<P> = {
        req,
        params,
        session,
        user,
        ip: clientIp(req.headers),
        userAgent: userAgent(req.headers),
        guestCartId: req.cookies.get(GUEST_CART_COOKIE)?.value ?? null,
        requireUser() {
          if (!user) throw unauthorized();
          return user;
        },
        requirePermission(permission) {
          if (!user) throw unauthorized('Please sign in to the admin panel.');
          if (!isStaffRole(user.role) || !can(user.role, permission)) throw forbidden();
          return user;
        },
        async body(schema) {
          const contentType = req.headers.get('content-type') ?? '';
          if (!contentType.includes('application/json')) {
            throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected a JSON request body.');
          }
          const text = await req.text();
          if (text.length > MAX_JSON_BYTES) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
          let json: unknown;
          try {
            json = text ? JSON.parse(text) : {};
          } catch {
            throw new AppError(400, 'INVALID_JSON', 'Malformed JSON body.');
          }
          const parsed = schema.safeParse(json);
          if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
          return parsed.data;
        },
        query(schema) {
          const raw: Record<string, string> = {};
          req.nextUrl.searchParams.forEach((value, key) => {
            raw[key] = value;
          });
          const parsed = schema.safeParse(raw);
          if (!parsed.success) throw validationError(zodFieldErrors(parsed.error), 'Invalid query parameters.');
          return parsed.data;
        },
        setCookie(name, value, cookieOptions) {
          cookieOps.push({ kind: 'set', name, value, options: cookieOptions });
        },
        deleteCookie(name) {
          cookieOps.push({ kind: 'delete', name });
        },
      };

      const result = await handler(ctx);
      const response =
        result instanceof Response
          ? result
          : NextResponse.json({ data: result ?? null }, { headers: { 'cache-control': 'no-store' } });
      return applyCookies(response, cookieOps);
    } catch (error) {
      return applyCookies(toErrorResponse(error, { method: req.method, path: req.nextUrl.pathname }), cookieOps);
    }
  };
}

function applyCookies(response: Response, ops: CookieOp[]): Response {
  if (ops.length === 0) return response;
  const res = response instanceof NextResponse ? response : new NextResponse(response.body, response);
  for (const op of ops) {
    if (op.kind === 'set') res.cookies.set(op.name, op.value, op.options);
    else res.cookies.set(op.name, '', { path: '/', maxAge: 0 });
  }
  return res;
}

export function toErrorResponse(error: unknown, request?: { method: string; path: string }): Response {
  if (isAppError(error)) {
    const res = jsonError(error.status, error.code, error.message, { fields: error.fields, details: error.details });
    if (error.status === 429) {
      const retry = (error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      if (retry) res.headers.set('retry-after', String(retry));
    }
    return res;
  }
  if (error instanceof z.ZodError) {
    return jsonError(422, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', { fields: zodFieldErrors(error) });
  }
  // Unexpected failure: log the full error server-side (secrets redacted) and give the client a
  // reference it can quote to support, without leaking internals.
  const errorId = crypto.randomUUID();
  log.error('api.unhandled_error', { errorId, ...request, error });
  return jsonError(500, 'INTERNAL_ERROR', `Something went wrong on our side. Please try again. (Ref ${errorId.slice(0, 8)})`, {
    details: { errorId },
  });
}
