// HTTP client of the API: same origin, session cookie and the x-demiurgo-csrf header on every
// mutation. The CSRF token lives in memory only (never in localStorage): after a reload it comes
// back from GET /api/session.

export class ApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly reasons: string[];
  constructor(status: number, type: string, message: string, reasons: string[]) {
    super(message);
    this.status = status;
    this.type = type;
    this.reasons = reasons;
  }
}

export const CSRF_HEADER = 'x-demiurgo-csrf';

let csrf: string | null = null;
export function setCsrf(value: string | null): void {
  csrf = value;
}

type Listener = () => void;
const unauthorized = new Set<Listener>();
/** Called when any request (other than the session's own) answers 401. */
export function onUnauthorized(listener: Listener): () => void {
  unauthorized.add(listener);
  return () => unauthorized.delete(listener);
}

type ErrorBody = { error?: string; message?: string; reasons?: string[] };

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrf) headers[CSRF_HEADER] = csrf;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, 'network', "Can't reach DEMIURGO.", []);
  }
  const text = await response.text();
  const json = text ? parse(text) : null;
  if (!response.ok) {
    const e = (json ?? {}) as ErrorBody;
    const error = new ApiError(response.status, e.error ?? 'request', e.message ?? response.statusText, e.reasons ?? []);
    if (response.status === 401 && path !== '/api/session') for (const l of unauthorized) l();
    throw error;
  }
  return json as T;
}

export const get = <T>(path: string): Promise<T> => request<T>('GET', path);
