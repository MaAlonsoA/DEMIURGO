// Minimal HTTP client for the DEMIURGO API with an agent token. The MCP server never opens
// the database or imports the core: everything goes through the API, which fixes the actor
// from the token (`agent:<name>:<session>`). This way an MCP tool can never do more than the token.

/** Commands the agent channel can request: converse, register sources and propose. */
export const AGENT_COMMANDS = ['message.post', 'source.register', 'batch.submit'] as const;
export type AgentCommand = (typeof AGENT_COMMANDS)[number];

export type ApiError = {
  ok: false;
  /** HTTP status code; 0 if there was no response. */
  state: number;
  error: string;
  message: string;
  reasons: string[];
};

export type ApiResponse = { ok: true; state: number; data: unknown } | ApiError;

export type ApiClient = {
  /** GET on a project route (e.g. `/inbox`). */
  read(path: string, queryName?: Record<string, string>): Promise<ApiResponse>;
  /** POST of one of the commands allowed to the agent; the body never carries an actor. */
  command(command: AgentCommand, data: Record<string, unknown>): Promise<ApiResponse>;
};

export type ApiClientOptions = {
  urlApi: string;
  token: string;
  projectId: string;
  fetch?: typeof globalThis.fetch;
  maximumTimeMs?: number;
};

const MAXIMUM_TIME_MS = 30_000;

export function createApiClient(op: ApiClientOptions): ApiClient {
  const doFetch = op.fetch ?? globalThis.fetch;
  const base = `${op.urlApi.replace(/\/+$/, '')}/api/projects/${encodeURIComponent(op.projectId)}`;
  const time = op.maximumTimeMs ?? MAXIMUM_TIME_MS;

  async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResponse> {
    const headers: Record<string, string> = { authorization: `Bearer ${op.token}`, accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method: method,
        headers: headers,
        // A redirect could send the token to another destination: treat it as an error.
        redirect: 'error',
        signal: AbortSignal.timeout(time),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (e) {
      return {
        ok: false,
        state: 0,
        error: 'disconnected',
        message: `Could not reach the DEMIURGO API at ${op.urlApi}: ${e instanceof Error ? e.message : String(e)}`,
        reasons: [],
      };
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (response.ok) return { ok: true, state: response.status, data: json };
    return responseError(response.status, json);
  }

  return {
    read(path, queryName) {
      const qs = queryName && Object.keys(queryName).length > 0 ? `?${new URLSearchParams(queryName).toString()}` : '';
      return request('GET', `${path}${qs}`);
    },
    command(command, data) {
      return request('POST', `/commands/${command}`, { data });
    },
  };
}

/** Is the body an API domain error (`{ error, message, reasons }`)? */
function isDomainError(json: unknown): json is { error: string; message: string; reasons?: unknown } {
  if (typeof json !== 'object' || json === null) return false;
  const o = json as Record<string, unknown>;
  return typeof o.error === 'string' && typeof o.message === 'string';
}

function responseError(state: number, json: unknown): ApiError {
  if (isDomainError(json)) {
    const reasons = Array.isArray(json.reasons) ? json.reasons.filter((m): m is string => typeof m === 'string') : [];
    return { ok: false, state, error: json.error, message: json.message, reasons };
  }
  // Response that does not match the API's error format (e.g. a route that does not exist).
  return {
    ok: false,
    state,
    error: state === 404 ? 'nonexistent_path' : 'unexpected_response',
    message: `The DEMIURGO API responded ${state} with no recognizable error.`,
    reasons: [],
  };
}
