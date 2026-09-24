// Acceso tipado a las tablas generadas desde design/datos/.

import type { TipoActorConDesconocido } from './actores.ts';
import { CAPACIDADES, TRANSICIONES } from './generado/tablas.ts';

export { CAPACIDADES, TRANSICIONES };

export type NombreComando = keyof typeof CAPACIDADES.comandos;
export type NombreConsulta = keyof typeof CAPACIDADES.consultas;
export type NombreEntidad = keyof typeof TRANSICIONES.entidades;

type DefComando = { entidad: string; permitido: readonly string[]; decisivo: boolean; descripcion: string };
type DefTransicion = { comando: string; desde: 'nuevo' | readonly string[]; hacia: string; guardas?: readonly string[] };
type DefEntidad = {
  etiqueta: string;
  implementado_en: string;
  estados: Readonly<Record<string, string>>;
  autoridad: readonly string[];
  transiciones: readonly DefTransicion[];
};

const comandos = CAPACIDADES.comandos as Readonly<Record<string, DefComando>>;
const consultas = CAPACIDADES.consultas as Readonly<Record<string, { permitido: readonly string[]; descripcion: string }>>;
const entidades = TRANSICIONES.entidades as Readonly<Record<string, DefEntidad>>;

export const NOMBRES_COMANDO = Object.keys(comandos) as NombreComando[];
export const NOMBRES_CONSULTA = Object.keys(consultas) as NombreConsulta[];
export const NOMBRES_ENTIDAD = Object.keys(entidades) as NombreEntidad[];

export function esComando(nombre: string): nombre is NombreComando {
  return Object.hasOwn(comandos, nombre);
}

export function definicionComando(c: NombreComando): DefComando {
  return comandos[c] as DefComando;
}

export function definicionEntidad(e: NombreEntidad): DefEntidad {
  return entidades[e] as DefEntidad;
}

export function entidadDe(c: NombreComando): NombreEntidad {
  return definicionComando(c).entidad as NombreEntidad;
}

export function permitidoComando(c: NombreComando, tipo: TipoActorConDesconocido): boolean {
  return tipo !== 'unknown' && definicionComando(c).permitido.includes(tipo);
}

/**
 * Invariante en código (I10): el componente de sistema del conocimiento solo escribe
 * conocimiento derivado, clasificaciones, evaluaciones de ideas y propuestas. Aunque la matriz
 * permita un comando a `system`, este componente no puede ejecutar otro (no se relaja editando
 * los datos).
 */
export const COMANDOS_POR_COMPONENTE: Readonly<Record<string, readonly string[]>> = {
  conocimiento: [
    'knowledge_update.enqueue',
    'knowledge_update.classify',
    'knowledge_update.verify',
    'knowledge_update.apply',
    'knowledge_update.reject',
    'knowledge_node.project',
    'knowledge_node.invalidate',
    'knowledge_edge.project',
    'knowledge_edge.invalidate',
    'classification.record',
    'classification.hold',
    'idea_assessment.record',
    'batch.submit',
    'proposal.create',
  ],
};

/** Si el actor es un componente de sistema con lista cerrada, ¿puede ejecutar el comando? */
export function permitidoAlComponente(c: NombreComando, actor: { tipo: string; componente?: string }): boolean {
  if (actor.tipo !== 'system' || !actor.componente) return true;
  const lista = COMANDOS_POR_COMPONENTE[actor.componente];
  return !lista || lista.includes(c);
}

export function permitidoConsulta(q: NombreConsulta, tipo: TipoActorConDesconocido): boolean {
  return tipo !== 'unknown' && (consultas[q]?.permitido.includes(tipo) ?? false);
}

export function esDecisivo(c: NombreComando): boolean {
  return definicionComando(c).decisivo;
}

export function esCreacion(c: NombreComando): boolean {
  const def = definicionEntidad(entidadDe(c));
  return def.transiciones.some((t) => t.comando === c && t.desde === 'nuevo');
}

export type Transicion = { hacia: string; guardas: readonly string[] };

/** Busca la transición (entidad, estado, comando). `estado` null significa «nuevo». */
export function buscarTransicion(entidad: NombreEntidad, estado: string | null, comando: NombreComando): Transicion | null {
  for (const t of definicionEntidad(entidad).transiciones) {
    if (t.comando !== comando) continue;
    const coincide = estado === null ? t.desde === 'nuevo' : t.desde !== 'nuevo' && t.desde.includes(estado);
    if (coincide) return { hacia: t.hacia, guardas: t.guardas ?? [] };
  }
  return null;
}

export function etiquetaEstado(entidad: NombreEntidad, estado: string): string {
  return definicionEntidad(entidad).estados[estado] ?? estado;
}

export function etiquetaEntidad(entidad: NombreEntidad): string {
  return definicionEntidad(entidad).etiqueta;
}

export function esEstadoDeAutoridad(entidad: NombreEntidad, estado: string): boolean {
  return definicionEntidad(entidad).autoridad.includes(estado);
}

/** Incrementos en orden, para saber qué entidades están implementadas. */
const ORDEN_INCREMENTOS = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];

export function implementadaEn(entidad: NombreEntidad, incrementoActual: string): boolean {
  return ORDEN_INCREMENTOS.indexOf(definicionEntidad(entidad).implementado_en) <= ORDEN_INCREMENTOS.indexOf(incrementoActual);
}

export function todasLasGuardas(): string[] {
  const s = new Set<string>();
  for (const e of Object.values(entidades)) for (const t of e.transiciones) for (const g of t.guardas ?? []) s.add(g);
  return [...s].sort();
}
