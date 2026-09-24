// Cliente HTTP mínimo de la API de DEMIURGO con un token de agente. El servidor MCP no abre
// la base ni importa el núcleo: todo pasa por la API, que fija el actor a partir del token
// (`agent:<nombre>:<sesión>`). Así una herramienta MCP nunca puede hacer más que el token.

/** Comandos que el canal de agentes puede pedir: conversar, registrar fuentes y proponer. */
export const AGENT_COMMANDS = ['message.post', 'source.register', 'batch.submit'] as const;
export type AgentCommand = (typeof AGENT_COMMANDS)[number];

export type ApiError = {
  ok: false;
  /** Código HTTP; 0 si no hubo respuesta. */
  state: number;
  error: string;
  message: string;
  reasons: string[];
};

export type ApiResponse = { ok: true; state: number; data: unknown } | ApiError;

export type ApiClient = {
  /** GET sobre una ruta del proyecto (por ejemplo `/bandeja`). */
  read(path: string, queryName?: Record<string, string>): Promise<ApiResponse>;
  /** POST de uno de los comandos permitidos al agente; el cuerpo nunca lleva actor. */
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
        // Una redirección podría llevar el token a otro destino: se trata como error.
        redirect: 'error',
        signal: AbortSignal.timeout(time),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (e) {
      return {
        ok: false,
        state: 0,
        error: 'disconnected',
        message: `No se pudo contactar con la API de DEMIURGO en ${op.urlApi}: ${e instanceof Error ? e.message : String(e)}`,
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

/** ¿Es el cuerpo un error de dominio de la API (`{ error, mensaje, motivos }`)? */
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
  // Respuesta sin el formato de error de la API (por ejemplo, una ruta que no existe).
  return {
    ok: false,
    state,
    error: state === 404 ? 'nonexistent_path' : 'unexpected_response',
    message: `La API de DEMIURGO respondió ${state} sin un error reconocible.`,
    reasons: [],
  };
}
