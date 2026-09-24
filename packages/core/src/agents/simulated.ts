// Agente simulado determinista: la misma acción con el mismo context pack da la misma salida
// (AC-ESQ-001-09). Se usa en la CI y en las pruebas; los guiones permiten forzar salidas
// inválidas, errores o demoras.

import type { AccionAgente, PeticionAgente, PuertoAgente, ResultadoAgente } from '@demiurgo/domain';

export type Guion = (p: PeticionAgente) => unknown;

export type OpcionesSimulado = {
  guiones?: Partial<Record<AccionAgente, Guion>>;
  demoraMs?: number;
  /** Se llama justo al empezar cada invocación (p. ej. para señalar a una prueba). */
  alInvocar?: (p: PeticionAgente) => void;
  /** Error forzado del agente, sin salida. */
  fallo?: { failureKind: 'agent_error' | 'infra' | 'timeout'; mensaje: string };
};

type Objeto = Record<string, unknown>;
const obj = (v: unknown): Objeto => (typeof v === 'object' && v !== null ? (v as Objeto) : {});
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown, def = ''): string => (typeof v === 'string' ? v : def);

function recortar(t: string, n: number): string {
  const limpio = t.replace(/\s+/g, ' ').trim();
  return limpio.length > n ? `${limpio.slice(0, n - 1)}…` : limpio;
}

export const GUIONES_POR_DEFECTO: Record<AccionAgente, Guion> = {
  eco(p) {
    const texto = txt(obj(obj(p.contexto.contenido).entrada).texto);
    return { reply: texto ? `Eco: ${recortar(texto, 1900)}` : 'Eco: (vacío)' };
  },

  exploration_chat(p) {
    const c = obj(p.contexto.contenido);
    const mensajes = lista(c.mensajes).map(obj);
    const ultimo = mensajes.toReversed().find((m) => txt(m.autor).startsWith('human:') || txt(m.autor).startsWith('agent:'));
    const texto = txt(ultimo?.texto, txt(c.proposito));
    const pendientes = lista(c.preguntas)
      .map(obj)
      .filter((q) => q.estado === 'pending');
    const quiereDecidir = /\b(decid|elegimos|elijo|quiero|vamos a|usaremos)/i.test(texto);
    const salida: Objeto = {
      reply: `Entendido: «${recortar(texto, 300)}». ${quiereDecidir ? 'Propongo registrarlo como decisión.' : 'Necesito concretar algo más.'}`,
      observaciones: [{ tipo: 'hypothesis', texto: `La intención principal es: ${recortar(texto, 200)}` }],
      preguntas: [],
      inferencias: [],
      propuestas: [],
    };
    if (quiereDecidir) {
      (salida.propuestas as unknown[]).push({
        tipo: 'decision',
        titulo: recortar(texto, 120),
        contexto: recortar(`Exploración: ${txt(c.proposito)}`, 2900),
        decision: recortar(texto, 2900),
        consecuencias: 'Hay que diseñar la funcionalidad con criterios de aceptación verificables.',
      });
      const primera = pendientes[0];
      if (primera && typeof primera.id === 'string') {
        (salida.inferencias as unknown[]).push({
          pregunta_id: primera.id,
          conclusion: recortar(texto, 1400),
          razonamiento: 'La persona lo ha expresado en su último mensaje.',
        });
      }
    } else if (pendientes.length === 0) {
      (salida.preguntas as unknown[]).push({
        pregunta: '¿Quién usará primero el producto y qué necesita hacer?',
        motivo: 'Define el alcance del primer diseño.',
        impacto: 'alto',
      });
    }
    return salida;
  },

  design_proposal(p) {
    const c = obj(p.contexto.contenido);
    const d = obj(c.decision);
    const titulo = recortar(txt(d.titulo, 'Funcionalidad'), 140);
    return {
      fdr: {
        titulo: `Diseño: ${titulo}`,
        objetivo: recortar(`Llevar a producto la decisión ${txt(d.codigo)}: ${txt(d.decision, titulo)}`, 2900),
        alcance: 'El recorrido principal de la decisión, de principio a fin, para una persona.',
        fuera_de_alcance: 'Integraciones externas y varios usuarios a la vez.',
        comportamiento: `La persona realiza el recorrido principal de «${titulo}» y ve el resultado confirmado.`,
        criterios: [
          {
            titulo: 'Recorrido principal',
            enunciado: `Dado un proyecto vacío, cuando la persona completa el recorrido de «${titulo}», entonces ve el resultado guardado.`,
            verificacion: 'automatic',
            comprobacion: 'Una prueba de extremo a extremo recorre el flujo y comprueba el resultado.',
          },
          {
            titulo: 'Error comprensible',
            enunciado:
              'Dado un dato inválido, cuando la persona lo envía, entonces ve un mensaje en español que explica qué corregir.',
            verificacion: 'automatic',
            comprobacion: 'Una prueba envía un dato inválido y comprueba el mensaje.',
          },
        ],
      },
    };
  },
};

export function crearAgenteSimulado(opciones: OpcionesSimulado = {}): PuertoAgente {
  return {
    proveedor: 'simulado',
    async ejecutar(p: PeticionAgente): Promise<ResultadoAgente> {
      opciones.alInvocar?.(p);
      const inicio = Date.now();
      if (opciones.demoraMs) {
        await new Promise<void>((resolver, rechazar) => {
          const t = setTimeout(resolver, opciones.demoraMs);
          p.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            rechazar(new Error('cancelada'));
          });
        }).catch(() => undefined);
        if (p.signal?.aborted) {
          return {
            estado: 'error',
            failureKind: 'cancelled',
            mensaje: 'Cancelada.',
            eventosCrudos: '',
            proveedor: 'simulado',
            modelo: 'simulado',
          };
        }
      }
      const uso = {
        tokensEntrada: JSON.stringify(p.contexto.contenido).length,
        tokensSalida: 0,
        duracionMs: Date.now() - inicio,
      };
      if (opciones.fallo) {
        return {
          estado: 'error',
          failureKind: opciones.fallo.failureKind,
          mensaje: opciones.fallo.mensaje,
          uso,
          eventosCrudos: '',
          proveedor: 'simulado',
          modelo: 'simulado',
        };
      }
      const guion = opciones.guiones?.[p.accion] ?? GUIONES_POR_DEFECTO[p.accion];
      const salida = guion(p);
      const cruda = JSON.stringify(salida);
      return {
        estado: 'ok',
        salidaCruda: salida,
        uso: { ...uso, tokensSalida: cruda.length },
        eventosCrudos: cruda,
        proveedor: 'simulado',
        modelo: 'simulado',
      };
    },
  };
}
