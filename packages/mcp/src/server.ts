// Servidor MCP del canal de agentes (S1, AC-DIS-001-03). Expone como herramientas las mismas
// operaciones que la API permite a un token de agente: leer, conversar con su nombre,
// registrar fuentes y proponer. Ninguna herramienta resuelve propuestas ni ejecuta comandos
// arbitrarios: eso queda para la persona, con su sesión.
//
// Este módulo no lee variables de entorno: la configuración llega como argumentos. Solo
// `main.ts` la lee al arrancar por stdio.

import {
  MAX_PROPUESTAS_AGENTE_EXTERNO,
  cargaDecision,
  cargaExploracion,
  cargaFdr,
  esquemaDependencia,
  referenciaRegistro,
} from '@demiurgo/domain';
import { type CallToolResult, McpServer, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { type ClienteApi, type ErrorApi, type RespuestaApi, crearClienteApi } from './cliente-api.ts';

export type OpcionesServidorMcp = {
  /** URL base de la API HTTP de DEMIURGO, por ejemplo `http://127.0.0.1:8100`. */
  urlApi: string;
  /** Token de agente (`dmg_agente_…`); la API fija con él el actor `agent:<nombre>:<sesión>`. */
  token: string;
  /** Proyecto al que da acceso el token. */
  proyectoId: string;
  /** Sustituto de `fetch` para pruebas. */
  fetch?: typeof globalThis.fetch;
};

export const NOMBRES_HERRAMIENTAS = [
  'leer_estado_producto',
  'leer_bandeja',
  'leer_exploraciones',
  'leer_exploracion',
  'leer_registro',
  'leer_lote',
  'leer_fuentes',
  'buscar_conocimiento',
  'conversar',
  'registrar_fuente',
  'proponer',
] as const;
export type NombreHerramienta = (typeof NOMBRES_HERRAMIENTAS)[number];

const PREFIJO_TOKEN_AGENTE = 'dmg_agente_';
const VERSION = '0.1.0';

const INSTRUCCIONES = [
  'Canal de agentes de DEMIURGO para un proyecto.',
  'Con este token puedes leer el estado del producto, la bandeja, las exploraciones, los registros, los lotes y las fuentes;',
  'conversar en una exploración con tu nombre; registrar fuentes; y enviar propuestas.',
  'Las propuestas quedan pendientes en la bandeja hasta que una persona las resuelva: el modelo propone y la persona decide.',
].join(' ');

// Esquemas de entrada. Las cargas de las propuestas son las del dominio: las mismas que valida la API.

const uuid = z.uuid();
const sinArgumentos = z.object({}).strict();

const entradaLeerExploracion = z.object({ exploracion_id: uuid.describe('Id de la exploración.') }).strict();
const entradaLeerRegistro = z
  .object({ codigo: referenciaRegistro.shape.codigo.describe('Código del registro, por ejemplo DEC-PLN-001 o FDR-DIS-001.') })
  .strict();
const entradaLeerLote = z.object({ lote_id: uuid.describe('Id del lote de propuestas.') }).strict();
const entradaBuscar = z
  .object({ consulta: z.string().trim().min(1).max(500).describe('Texto que se busca en el conocimiento del proyecto.') })
  .strict();

const entradaConversar = z
  .object({
    exploracion_id: uuid.describe('Id de la exploración donde se publica el mensaje.'),
    pregunta_id: uuid.optional().describe('Id de la pregunta, si el mensaje va en su hilo.'),
    texto: z.string().trim().min(1).max(20_000).describe('Texto del mensaje.'),
  })
  .strict();

const entradaRegistrarFuente = z
  .object({
    nombre: z.string().trim().min(1).max(200).describe('Nombre de la fuente, por ejemplo VISION.md.'),
    contenido: z.string().min(1).max(200_000).describe('Contenido completo de la fuente.'),
  })
  .strict();

const dependencias = z
  .array(esquemaDependencia)
  .optional()
  .describe('Registros de los que depende la propuesta (id, código y versión vigente); si cambian, la propuesta queda obsoleta.');

const propuesta = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('decision'), carga: cargaDecision, dependencias }).strict(),
  z.object({ tipo: z.literal('exploracion'), carga: cargaExploracion, dependencias }).strict(),
  z.object({ tipo: z.literal('fdr'), carga: cargaFdr, dependencias }).strict(),
]);

// El máximo por lote lo aplica la API (con su motivo); aquí solo se documenta.
const entradaProponer = z
  .object({
    resumen: z.string().trim().max(2000).optional().describe('Resumen del lote para quien lo revise.'),
    propuestas: z.array(propuesta).min(1).describe(`Propuestas del lote: como máximo ${MAX_PROPUESTAS_AGENTE_EXTERNO}.`),
  })
  .strict();

// Validación con mensajes en español. El SDK valida la entrada con mensajes en inglés; para
// evitarlo recibe un esquema que anuncia el JSON Schema de Zod pero deja pasar el valor, y la
// herramienta valida después con la configuración regional española de Zod.
const errorEnEspanol = z.locales.es().localeError;

function anunciar(esquema: z.ZodType): StandardSchemaWithJSON<unknown, unknown> {
  return {
    '~standard': {
      version: 1,
      vendor: 'demiurgo',
      validate: (valor: unknown) => ({ value: valor }),
      jsonSchema: esquema['~standard'].jsonSchema,
    },
  };
}

function resultado(datos: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(datos, null, 2) }], structuredContent: datos };
}

const CATEGORIAS: Record<string, string> = {
  no_autenticado: 'Error de autenticación',
  prohibido: 'Operación no permitida',
  no_encontrado: 'No encontrado',
  transicion_invalida: 'Transición no válida',
  guarda: 'No se cumplen las condiciones',
  conflicto: 'Conflicto',
  validacion: 'Datos no válidos',
  peticion: 'Petición no válida',
  no_implementado: 'Aún no implementado',
  no_disponible: 'No disponible',
  sin_conexion: 'Sin conexión con la API',
  argumentos: 'Argumentos no válidos',
};

function errorHerramienta(e: Omit<ErrorApi, 'ok'>): CallToolResult {
  const categoria = CATEGORIAS[e.error] ?? 'Error de la API';
  const http = e.estado > 0 ? ` (HTTP ${e.estado})` : '';
  const lineas = [`${categoria}${http}: ${e.mensaje}`];
  if (e.motivos.length > 0) lineas.push('Motivos:', ...e.motivos.map((m) => `- ${m}`));
  return {
    content: [{ type: 'text', text: lineas.join('\n') }],
    structuredContent: { error: e.error, mensaje: e.mensaje, motivos: e.motivos, estado_http: e.estado },
    isError: true,
  };
}

function objeto(datos: unknown, clave: string): Record<string, unknown> {
  return typeof datos === 'object' && datos !== null && !Array.isArray(datos)
    ? (datos as Record<string, unknown>)
    : { [clave]: datos };
}

type Definicion<E extends z.ZodType> = {
  titulo: string;
  descripcion: string;
  entrada: E;
  soloLectura: boolean;
  ejecutar(args: z.output<E>, api: ClienteApi): Promise<CallToolResult>;
};

function registrar<E extends z.ZodType>(servidor: McpServer, api: ClienteApi, nombre: NombreHerramienta, d: Definicion<E>): void {
  servidor.registerTool(
    nombre,
    {
      title: d.titulo,
      description: d.descripcion,
      inputSchema: anunciar(d.entrada),
      annotations: {
        title: d.titulo,
        readOnlyHint: d.soloLectura,
        destructiveHint: false,
        idempotentHint: d.soloLectura,
        openWorldHint: false,
      },
    },
    async (args: unknown) => {
      const r = d.entrada.safeParse(args ?? {}, { error: errorEnEspanol });
      if (!r.success) {
        return errorHerramienta({
          estado: 0,
          error: 'argumentos',
          mensaje: `La herramienta «${nombre}» recibió argumentos no válidos.`,
          motivos: r.error.issues.map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message)),
        });
      }
      return d.ejecutar(r.data, api);
    },
  );
}

/** Convierte una respuesta de la API en el resultado de la herramienta. */
function responder(r: RespuestaApi, clave = 'datos'): CallToolResult {
  return r.ok ? resultado(objeto(r.datos, clave)) : errorHerramienta(r);
}

/** Comprueba la configuración antes de crear el servidor; lanza un error en español si no es válida. */
export function comprobarOpcionesMcp(op: OpcionesServidorMcp): void {
  let url: URL;
  try {
    url = new URL(op.urlApi);
  } catch {
    throw new Error(`La URL de la API de DEMIURGO no es válida: «${op.urlApi}».`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`La URL de la API de DEMIURGO debe ser http o https: «${op.urlApi}».`);
  }
  if (!op.token.startsWith(PREFIJO_TOKEN_AGENTE)) {
    throw new Error(`El token de agente debe empezar por «${PREFIJO_TOKEN_AGENTE}».`);
  }
  if (!uuid.safeParse(op.proyectoId).success) {
    throw new Error(`El id de proyecto no es válido: «${op.proyectoId}».`);
  }
}

/** Crea el servidor MCP del canal de agentes sobre la API HTTP de DEMIURGO. */
export function crearServidorMcp(op: OpcionesServidorMcp): McpServer {
  comprobarOpcionesMcp(op);
  const api = crearClienteApi(op);
  const servidor = new McpServer(
    { name: 'demiurgo', title: 'DEMIURGO', version: VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCCIONES },
  );

  registrar(servidor, api, 'leer_estado_producto', {
    titulo: 'Leer el estado del producto',
    descripcion:
      'Devuelve el estado del producto: decisiones y diseños con su versión vigente, su estado epistémico y su readiness, las exploraciones y el recuento de la bandeja.',
    entrada: sinArgumentos,
    soloLectura: true,
    ejecutar: async (_a, c) => responder(await c.leer('/estado')),
  });

  registrar(servidor, api, 'leer_bandeja', {
    titulo: 'Leer la bandeja',
    descripcion:
      'Devuelve la bandeja del proyecto: lotes pendientes con sus propuestas y su productor, preguntas por revisar y enlaces en revisión, cada elemento con su estado epistémico.',
    entrada: sinArgumentos,
    soloLectura: true,
    ejecutar: async (_a, c) => responder(await c.leer('/bandeja')),
  });

  registrar(servidor, api, 'leer_exploraciones', {
    titulo: 'Listar las exploraciones',
    descripcion: 'Lista las exploraciones del proyecto con su propósito, su estado y su origen.',
    entrada: sinArgumentos,
    soloLectura: true,
    ejecutar: async (_a, c) => responder(await c.leer('/exploraciones'), 'exploraciones'),
  });

  registrar(servidor, api, 'leer_exploracion', {
    titulo: 'Leer una exploración',
    descripcion:
      'Devuelve una exploración con su hilo de mensajes (cada uno con su autor), sus preguntas y sus exploraciones hijas.',
    entrada: entradaLeerExploracion,
    soloLectura: true,
    ejecutar: async (a, c) => responder(await c.leer(`/exploraciones/${encodeURIComponent(a.exploracion_id)}`)),
  });

  registrar(servidor, api, 'leer_registro', {
    titulo: 'Leer un registro',
    descripcion:
      'Devuelve un registro (decisión, FDR, ADR o bug) por su código: sus versiones, secciones, criterios (AC) con su verificación, enlaces y readiness.',
    entrada: entradaLeerRegistro,
    soloLectura: true,
    ejecutar: async (a, c) => responder(await c.leer(`/registros/${encodeURIComponent(a.codigo)}`)),
  });

  registrar(servidor, api, 'leer_lote', {
    titulo: 'Leer un lote de propuestas',
    descripcion: 'Devuelve un lote de propuestas con su productor, su modo de resolución y el estado de cada propuesta.',
    entrada: entradaLeerLote,
    soloLectura: true,
    ejecutar: async (a, c) => responder(await c.leer(`/lotes/${encodeURIComponent(a.lote_id)}`)),
  });

  registrar(servidor, api, 'leer_fuentes', {
    titulo: 'Listar las fuentes',
    descripcion: 'Lista las fuentes registradas en el proyecto con su nombre, su huella de contenido y quién las registró.',
    entrada: sinArgumentos,
    soloLectura: true,
    ejecutar: async (_a, c) => responder(await c.leer('/fuentes'), 'fuentes'),
  });

  registrar(servidor, api, 'buscar_conocimiento', {
    titulo: 'Buscar en el conocimiento',
    descripcion:
      'Busca en el conocimiento del proyecto (registros, exploraciones y fuentes) y devuelve los resultados más relevantes.',
    entrada: entradaBuscar,
    soloLectura: true,
    async ejecutar(a, c) {
      const r = await c.leer('/conocimiento/buscar', { q: a.consulta });
      if (!r.ok && r.error === 'ruta_inexistente') {
        return errorHerramienta({
          estado: r.estado,
          error: 'no_disponible',
          mensaje: 'La búsqueda de conocimiento aún no está disponible.',
          motivos: [],
        });
      }
      return responder(r, 'resultados');
    },
  });

  registrar(servidor, api, 'conversar', {
    titulo: 'Conversar en una exploración',
    descripcion:
      'Publica un mensaje en el hilo de una exploración (o de una de sus preguntas) con el nombre de este agente como autor.',
    entrada: entradaConversar,
    soloLectura: false,
    ejecutar: async (a, c) =>
      responder(
        await c.comando('message.post', {
          exploracion_id: a.exploracion_id,
          ...(a.pregunta_id ? { pregunta_id: a.pregunta_id } : {}),
          texto: a.texto,
        }),
      ),
  });

  registrar(servidor, api, 'registrar_fuente', {
    titulo: 'Registrar una fuente',
    descripcion:
      'Registra un documento como fuente del proyecto (por ejemplo VISION.md). Una fuente es una entrada no confiable: informa, pero no cambia ningún registro.',
    entrada: entradaRegistrarFuente,
    soloLectura: false,
    ejecutar: async (a, c) => responder(await c.comando('source.register', { nombre: a.nombre, contenido: a.contenido })),
  });

  registrar(servidor, api, 'proponer', {
    titulo: 'Proponer',
    descripcion: `Envía un lote de propuestas (decisión, exploración o FDR con sus criterios) a la bandeja del proyecto. Como máximo ${MAX_PROPUESTAS_AGENTE_EXTERNO} propuestas por lote. Las propuestas quedan pendientes y una persona las resuelve una a una; este agente no puede resolverlas.`,
    entrada: entradaProponer,
    soloLectura: false,
    ejecutar: async (a, c) =>
      responder(
        await c.comando('batch.submit', {
          ...(a.resumen ? { resumen: a.resumen } : {}),
          propuestas: a.propuestas.map((p) => ({
            tipo: p.tipo,
            carga: p.carga,
            ...(p.dependencias ? { dependencias: p.dependencias } : {}),
          })),
        }),
      ),
  });

  return servidor;
}
