/** Browser-side client for the MKJ MART REST API (`/api/v1`). Never throws; returns a result union. */

export type ApiError = {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
  details?: unknown;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function api<T>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal; form?: FormData } = {},
): Promise<ApiResult<T>> {
  const method = init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET');
  try {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: init.body !== undefined ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      signal: init.signal,
    });
    const json = (await res.json().catch(() => null)) as { data?: T; error?: Omit<ApiError, 'status'> } | null;
    if (!res.ok || !json || json.error) {
      return {
        ok: false,
        error: {
          status: res.status,
          code: json?.error?.code ?? 'HTTP_ERROR',
          message: json?.error?.message ?? 'Something went wrong. Please try again.',
          fields: json?.error?.fields,
          details: json?.error?.details,
        },
      };
    }
    return { ok: true, data: json.data as T };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: { status: 0, code: 'ABORTED', message: 'Request cancelled.' } };
    }
    return {
      ok: false,
      error: { status: 0, code: 'NETWORK_ERROR', message: 'Network error — please check your connection and try again.' },
    };
  }
}

/** Random idempotency key for checkout submissions (stable across retries of the same attempt). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().replace(/-/g, '');
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}
