// Tipos del formato fijo de `design/`. El formato está descrito en `design/README.md`,
// que se genera desde `readme.ts`.

export const TIPOS_REGISTRO = ['decision', 'adr', 'fdr', 'bug'] as const;
export type TipoRegistro = (typeof TIPOS_REGISTRO)[number];

export const ESTADOS_DOCUMENTO = ['propuesto', 'aprobado', 'sustituido', 'descartado'] as const;
export type EstadoDocumento = (typeof ESTADOS_DOCUMENTO)[number];

export const VERIFICACIONES = ['automática', 'manual'] as const;
export type Verificacion = (typeof VERIFICACIONES)[number];

export const TIPOS_ENLACE = ['based_on', 'design_of', 'covers', 'origin', 'conflicts_with', 'derived_from'] as const;
export type TipoEnlace = (typeof TIPOS_ENLACE)[number];

export type Referencia = { codigo: string; version: number };

export type Enlace = { tipo: TipoEnlace; destino: Referencia };

export type Seccion = { titulo: string; contenido: string };

export type Criterio = {
  codigo: string;
  titulo: string;
  verificacion: Verificacion;
  comprobacion: string;
  enunciado: string;
  derivaDe?: string;
};

export type DocumentoRegistro = {
  clase: 'registro';
  tipo: TipoRegistro;
  codigo: string;
  titulo: string;
  version: number;
  estado: EstadoDocumento;
  dominio: string;
  incremento?: string;
  notaDeCambio?: string;
  enlaces: Enlace[];
  anexos: string[];
  secciones: Seccion[];
  criterios: Criterio[];
};

export type Categoria = { codigo: string; nombre: string; descripcion: string };
export type Eje = { codigo: string; nombre: string; categorias: Categoria[] };

export type DocumentoTaxonomia = {
  clase: 'taxonomia';
  codigo: string;
  titulo: string;
  version: number;
  estado: EstadoDocumento;
  ejes: Eje[];
  secciones: Seccion[];
};

export type Documento = DocumentoRegistro | DocumentoTaxonomia;

export type Problema = { ruta: string; mensaje: string };

export type Resultado<T> = { ok: true; valor: T } | { ok: false; problemas: Problema[] };

/** Plantilla por tipo: secciones obligatorias, en orden, antes de «Criterios de aceptación». */
export const PLANTILLAS: Record<TipoRegistro, { secciones: readonly string[]; exigeCriterios: boolean }> = {
  decision: { secciones: ['Contexto', 'Decisión', 'Consecuencias'], exigeCriterios: false },
  adr: { secciones: ['Contexto', 'Opciones', 'Decisión', 'Consecuencias'], exigeCriterios: true },
  fdr: { secciones: ['Objetivo', 'Alcance', 'Fuera de alcance', 'Comportamiento'], exigeCriterios: true },
  bug: { secciones: ['Reproducción', 'Esperado', 'Observado'], exigeCriterios: true },
};

export const SECCION_CRITERIOS = 'Criterios de aceptación';

export const PREFIJOS: Record<TipoRegistro | 'taxonomia', string> = {
  decision: 'DEC',
  adr: 'ADR',
  fdr: 'FDR',
  bug: 'BUG',
  taxonomia: 'TAX',
};

export const CARPETAS: Record<TipoRegistro | 'taxonomia', string> = {
  decision: 'decisiones',
  adr: 'adr',
  fdr: 'fdr',
  bug: 'bugs',
  taxonomia: 'taxonomia',
};
