// Registros con versiones (decisión, FDR, ADR, bug): plantillas, readiness, estado
// epistémico y aviso de verificabilidad. Todo puro.

export const TIPOS_REGISTRO = ['decision', 'fdr', 'adr', 'bug'] as const;
export type TipoRegistro = (typeof TIPOS_REGISTRO)[number];

export const PREFIJO_REGISTRO: Record<TipoRegistro, string> = { decision: 'DEC', fdr: 'FDR', adr: 'ADR', bug: 'BUG' };

export const PLANTILLAS_REGISTRO: Record<TipoRegistro, { secciones: readonly string[]; exigeCriterios: boolean }> = {
  decision: { secciones: ['Contexto', 'Decisión', 'Consecuencias'], exigeCriterios: false },
  adr: { secciones: ['Contexto', 'Opciones', 'Decisión', 'Consecuencias'], exigeCriterios: true },
  fdr: { secciones: ['Objetivo', 'Alcance', 'Fuera de alcance', 'Comportamiento'], exigeCriterios: true },
  bug: { secciones: ['Reproducción', 'Esperado', 'Observado'], exigeCriterios: true },
};

export type Seccion = { titulo: string; contenido: string };

/** Límites del contenido de una versión: los comparten la validación de los comandos y el validador de design/. */
export const LIMITES_VERSION = {
  titulo: 200,
  tituloSeccion: 120,
  seccion: 50_000,
  secciones: 40,
  criterios: 60,
  enlaces: 40,
  notaDeCambio: 2000,
  tituloCriterio: 200,
  enunciado: 3000,
  comprobacion: 1000,
} as const;

/** Motivos por los que unas secciones no cumplen la plantilla de su tipo (vacío si la cumplen). */
export function faltasDePlantilla(tipo: TipoRegistro, secciones: readonly Seccion[]): string[] {
  const faltas: string[] = [];
  const plantilla = PLANTILLAS_REGISTRO[tipo];
  let i = 0;
  for (const s of secciones) if (s.titulo === plantilla.secciones[i]) i++;
  if (i < plantilla.secciones.length)
    faltas.push(`Faltan secciones de la plantilla: ${plantilla.secciones.slice(i).join(', ')}.`);
  for (const s of secciones) if (s.contenido.trim() === '') faltas.push(`La sección «${s.titulo}» está vacía.`);
  const titulos = secciones.map((s) => s.titulo);
  if (new Set(titulos).size !== titulos.length) faltas.push('Hay secciones repetidas.');
  return faltas;
}

// Estado epistémico (visión original): confirmado, propuesto, pendiente o desconocido.
export type EstadoEpistemico = 'confirmado' | 'propuesto' | 'pendiente' | 'desconocido';

export function epistemicoDeVersion(estado: string): EstadoEpistemico {
  if (estado === 'approved') return 'confirmado';
  if (estado === 'draft') return 'propuesto';
  return 'desconocido';
}

export function epistemicoDePregunta(estado: string): EstadoEpistemico {
  if (estado === 'confirmed') return 'confirmado';
  if (estado === 'inferred') return 'propuesto';
  if (estado === 'pending' || estado === 'postponed') return 'pendiente';
  return 'desconocido';
}

export function epistemicoDePropuesta(estado: string): EstadoEpistemico {
  if (estado === 'accepted' || estado === 'accepted_edited') return 'confirmado';
  if (estado === 'pending') return 'propuesto';
  return 'desconocido';
}

export function epistemicoDeObservacion(tipo: string | null): EstadoEpistemico {
  if (tipo === 'claim') return 'propuesto';
  if (tipo === 'hypothesis') return 'propuesto';
  if (tipo === 'unknown') return 'desconocido';
  return 'propuesto';
}

// Readiness: «Listo para construir». Devuelve lo que falta en lenguaje de producto.

export type VersionResumen = { n: number; estado: string };

export type EntradaReadiness = {
  codigo: string;
  tipo: TipoRegistro;
  version: VersionResumen;
  /** Última versión aprobada del registro (la vigente), si existe. */
  vigente: number | null;
  criterios: { codigo: string; verificacion: string; comprobacion: string; enunciado: string }[];
  /** Enlaces «based_on» a decisiones: versión enlazada, vigente de esa decisión y estado del enlace. */
  basadoEn: { codigo: string; version: number; estadoVersion: string; vigente: number | null; estadoEnlace: string }[];
  /** Otros enlaces de esta versión que están pendientes de revisión. */
  enlacesEnRevision: string[];
  /** Preguntas pendientes o pospuestas en la exploración de origen. */
  preguntasAbiertas: { pregunta: string; estado: string }[];
  /** Propuestas pendientes que dependen de este registro. */
  propuestasPendientes: number;
};

export type Readiness = { listo: boolean; motivos: string[]; avisos: string[] };

export function readiness(e: EntradaReadiness): Readiness {
  const motivos: string[] = [];
  if (e.version.estado === 'superseded') {
    motivos.push(`La versión ${e.version.n} está sustituida: la vigente es la ${e.vigente ?? '—'}.`);
  } else if (e.version.estado === 'draft' && e.vigente !== null && e.vigente > e.version.n) {
    motivos.push(`La versión ${e.version.n} es un borrador anterior a la vigente (v${e.vigente}): solo se puede descartar.`);
  } else if (e.version.estado !== 'approved') motivos.push(`La versión ${e.version.n} no está aprobada.`);
  else if (e.vigente !== e.version.n) motivos.push(`No es la versión vigente: la vigente es la ${e.vigente ?? '—'}.`);
  if (PLANTILLAS_REGISTRO[e.tipo].exigeCriterios && e.criterios.length === 0) motivos.push('No tiene criterios de aceptación.');
  for (const c of e.criterios) {
    if (!['automatic', 'manual'].includes(c.verificacion) || c.comprobacion.trim() === '') {
      motivos.push(`El criterio ${c.codigo} no indica cómo se comprueba.`);
    }
  }
  if (e.tipo === 'fdr' || e.tipo === 'adr') {
    const decisiones = e.basadoEn;
    if (decisiones.length === 0) motivos.push('No se basa en ninguna decisión.');
    for (const d of decisiones) {
      if (d.vigente === null) {
        motivos.push(`La decisión ${d.codigo} en la que se basa no está aprobada.`);
      } else if (d.vigente !== d.version) {
        motivos.push(`Se basa en ${d.codigo} v${d.version}, pero la vigente es la v${d.vigente}.`);
      }
      if (d.estadoEnlace === 'needs_review') motivos.push(`El enlace con ${d.codigo} está pendiente de revisión.`);
    }
  }
  for (const en of e.enlacesEnRevision) motivos.push(`El enlace con ${en} está pendiente de revisión.`);
  const pendientes = e.preguntasAbiertas.filter((p) => p.estado === 'pending').length;
  const pospuestas = e.preguntasAbiertas.filter((p) => p.estado === 'postponed').length;
  if (pendientes > 0) motivos.push(`Hay ${pendientes} pregunta(s) pendiente(s) en la exploración de origen.`);
  if (pospuestas > 0) motivos.push(`Hay ${pospuestas} pregunta(s) pospuesta(s) en la exploración de origen.`);
  if (e.propuestasPendientes > 0) motivos.push(`Hay ${e.propuestasPendientes} propuesta(s) pendiente(s) que la afectan.`);
  const avisos = e.criterios.flatMap((c) => avisosDeVerificabilidad(c.codigo, c.enunciado));
  return { listo: motivos.length === 0, motivos, avisos };
}

const VAGOS =
  /\b(r[aá]pid[oa]s?|f[aá]cil(es|mente)?|intuitiv[oa]s?|adecuad[oa]s?|correctamente|bien|amigable|robust[oa]s?|eficiente(s|mente)?|mejor(es)?|user[- ]friendly)\b/i;
const OBSERVABLE = /\b(cuando|entonces|ve|recibe|muestra|devuelve|aparece|queda|rechaza|falla|contiene|guarda|responde)\b/i;

/**
 * Chequeo de verificabilidad determinista (el Noul de §7.5 lo sustituirá): solo avisa, nunca
 * bloquea (AC-DIS-001-14).
 */
export function avisosDeVerificabilidad(codigo: string, enunciado: string): string[] {
  const avisos: string[] = [];
  if (!OBSERVABLE.test(enunciado))
    avisos.push(`${codigo}: el enunciado no describe un resultado observable (Dado…, cuando…, entonces…).`);
  const vago = VAGOS.exec(enunciado);
  if (vago) avisos.push(`${codigo}: «${vago[0]}» es vago; indica una medida o un resultado comprobable.`);
  return avisos;
}
