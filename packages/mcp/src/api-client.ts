// Cliente HTTP mínimo de la API de DEMIURGO con un token de agente. El servidor MCP no abre
// la base ni importa el núcleo: todo pasa por la API, que fija el actor a partir del token
// (`agent:<nombre>:<sesión>`). Así una herramienta MCP nunca puede hacer más que el token.

/** Comandos que el canal de agentes puede pedir: conversar, registrar fuentes y proponer. */
export const COMANDOS_AGENTE = ['message.post', 'source.register', 'batch.submit'] as const;
export type ComandoAgente = (typeof COMANDOS_AGENTE)[number];

export type ErrorApi = {
  ok: false;
  /** Código HTTP; 0 si no hubo respuesta. */
  estado: number;
  error: string;
  mensaje: string;
  motivos: string[];
};

export type RespuestaApi = { ok: true; estado: number; datos: unknown } | ErrorApi;

export type ClienteApi = {
  /** GET sobre una ruta del proyecto (por ejemplo `/bandeja`). */
  leer(ruta: string, consulta?: Record<string, string>): Promise<RespuestaApi>;
  /** POST de uno de los comandos permitidos al agente; el cuerpo nunca lleva actor. */
  comando(comando: ComandoAgente, datos: Record<string, unknown>): Promise<RespuestaApi>;
};

export type OpcionesClienteApi = {
  urlApi: string;
  token: string;
  proyectoId: string;
  fetch?: typeof globalThis.fetch;
  tiempoMaximoMs?: number;
};

const TIEMPO_MAXIMO_MS = 30_000;

export function crearClienteApi(op: OpcionesClienteApi): ClienteApi {
  const hacerFetch = op.fetch ?? globalThis.fetch;
  const base = `${op.urlApi.replace(/\/+$/, '')}/api/proyectos/${encodeURIComponent(op.proyectoId)}`;
  const tiempo = op.tiempoMaximoMs ?? TIEMPO_MAXIMO_MS;

  async function pedir(metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown): Promise<RespuestaApi> {
    const cabeceras: Record<string, string> = { authorization: `Bearer ${op.token}`, accept: 'application/json' };
    if (cuerpo !== undefined) cabeceras['content-type'] = 'application/json';
    let respuesta: Response;
    try {
      respuesta = await hacerFetch(`${base}${ruta}`, {
        method: metodo,
        headers: cabeceras,
        // Una redirección podría llevar el token a otro destino: se trata como error.
        redirect: 'error',
        signal: AbortSignal.timeout(tiempo),
        ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
      });
    } catch (e) {
      return {
        ok: false,
        estado: 0,
        error: 'sin_conexion',
        mensaje: `No se pudo contactar con la API de DEMIURGO en ${op.urlApi}: ${e instanceof Error ? e.message : String(e)}`,
        motivos: [],
      };
    }
    const texto = await respuesta.text();
    let json: unknown = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    if (respuesta.ok) return { ok: true, estado: respuesta.status, datos: json };
    return errorDeRespuesta(respuesta.status, json);
  }

  return {
    leer(ruta, consulta) {
      const qs = consulta && Object.keys(consulta).length > 0 ? `?${new URLSearchParams(consulta).toString()}` : '';
      return pedir('GET', `${ruta}${qs}`);
    },
    comando(comando, datos) {
      return pedir('POST', `/comandos/${comando}`, { datos });
    },
  };
}

/** ¿Es el cuerpo un error de dominio de la API (`{ error, mensaje, motivos }`)? */
function esErrorDeDominio(json: unknown): json is { error: string; mensaje: string; motivos?: unknown } {
  if (typeof json !== 'object' || json === null) return false;
  const o = json as Record<string, unknown>;
  return typeof o.error === 'string' && typeof o.mensaje === 'string';
}

function errorDeRespuesta(estado: number, json: unknown): ErrorApi {
  if (esErrorDeDominio(json)) {
    const motivos = Array.isArray(json.motivos) ? json.motivos.filter((m): m is string => typeof m === 'string') : [];
    return { ok: false, estado, error: json.error, mensaje: json.mensaje, motivos };
  }
  // Respuesta sin el formato de error de la API (por ejemplo, una ruta que no existe).
  return {
    ok: false,
    estado,
    error: estado === 404 ? 'ruta_inexistente' : 'respuesta_inesperada',
    mensaje: `La API de DEMIURGO respondió ${estado} sin un error reconocible.`,
    motivos: [],
  };
}
