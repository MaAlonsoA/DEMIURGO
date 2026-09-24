// Motor de conocimiento (§7 del plan), parte pura. El grafo es una proyección de la autoridad:
// la actualización incremental y la reconstrucción usan exactamente estas funciones, así que
// reconstruir con las clasificaciones guardadas da la misma huella (I10).

import { type EstadoEpistemico } from './registros.ts';
import { huella } from './huella.ts';
import { similitud } from './texto.ts';
import {
  type RespuestaChoice,
  type Umbrales,
  UMBRALES_POR_DEFECTO,
  VEREDICTOS,
  type Veredicto,
  enrutarPorConfianza,
} from './clasificador.ts';

export type OrigenNodo = { tipo: string; id: string | null; version: number | null };

/** Nodo derivado. `ref` es estable y lleva la versión de lo que representa (p. ej. DEC-PRO-001@2). */
export type Nodo = {
  ref: string;
  tipo: string;
  etiqueta: string;
  texto: string;
  categorias: Readonly<Record<string, string>>;
  epistemico: EstadoEpistemico;
  /** Si viene de algo con autoridad (registro o criterio), nunca se cambia sin la persona. */
  autoridad: boolean;
  origen: OrigenNodo;
  desde: number;
  hasta: number | null;
};

export type Arista = { tipo: string; desde: string; hacia: string; alta: number; baja: number | null };

export type Grafo = { version: number; nodos: Nodo[]; aristas: Arista[] };

export const grafoVacio = (): Grafo => ({ version: 0, nodos: [], aristas: [] });

export const nodosVigentes = (g: Grafo): Nodo[] => g.nodos.filter((n) => n.hasta === null);
export const aristasVigentes = (g: Grafo): Arista[] => g.aristas.filter((a) => a.baja === null);

/** Cambio de autoridad proyectado de forma determinista (sin clasificador). */
export type Cambio = {
  /** Nodo principal del cambio (el que se clasifica y se compara con los candidatos). */
  principal: Omit<Nodo, 'desde' | 'hasta' | 'categorias'>;
  /** Nodos que acompañan al principal (p. ej. sus criterios). */
  acompañantes: Omit<Nodo, 'desde' | 'hasta' | 'categorias'>[];
  /** Aristas nuevas por la estructura (contiene, enlaces de la autoridad). */
  aristas: { tipo: string; desde: string; hacia: string }[];
  /** Refs que la precedencia de versiones deja sustituidas (lo decide el código, no el modelo). */
  sustituye: string[];
};

export type Candidato = { ref: string; tipo: string; etiqueta: string; texto: string; motivo: string };

const MAX_CANDIDATOS = 12;

/**
 * Preselección determinista de candidatos (§7.3 paso 2): vecinos del registro en el grafo,
 * coincidencias de texto y nodos con las mismas categorías. Acotada y ordenada.
 */
export function seleccionarCandidatos(g: Grafo, cambio: Cambio, categorias: Readonly<Record<string, string>>): Candidato[] {
  // Fuera: el propio cambio, lo que sustituye (lo decide la precedencia) y lo que enlaza (esa
  // relación ya la declaró la persona en la autoridad).
  const propios = new Set([
    cambio.principal.ref,
    ...cambio.acompañantes.map((n) => n.ref),
    ...cambio.sustituye,
    ...cambio.aristas.map((a) => a.hacia),
  ]);
  const vigentes = nodosVigentes(g).filter((n) => !propios.has(n.ref) && n.tipo !== 'criterio');
  const porRef = new Map(vigentes.map((n) => [n.ref, n]));
  const elegidos = new Map<string, { nodo: Nodo; motivo: string; peso: number }>();
  const añadir = (n: Nodo | undefined, motivo: string, peso: number) => {
    if (!n) return;
    const previo = elegidos.get(n.ref);
    if (!previo || previo.peso < peso) elegidos.set(n.ref, { nodo: n, motivo, peso });
  };
  // Vecinos a distancia 1 de lo que el cambio sustituye o enlaza.
  const semillas = new Set([...cambio.sustituye, ...cambio.aristas.map((a) => a.hacia)]);
  for (const a of aristasVigentes(g)) {
    if (semillas.has(a.desde)) añadir(porRef.get(a.hacia), `vecino de ${a.desde} (${a.tipo})`, 3);
    if (semillas.has(a.hacia)) añadir(porRef.get(a.desde), `vecino de ${a.hacia} (${a.tipo})`, 3);
  }
  const texto = `${cambio.principal.etiqueta}. ${cambio.principal.texto}`;
  for (const n of vigentes) {
    const sim = similitud(texto, `${n.etiqueta}. ${n.texto}`);
    if (sim >= 0.08) añadir(n, `coincidencia de texto (${sim.toFixed(2)})`, 1 + sim);
    const comunes = Object.entries(categorias).filter(([eje, c]) => c !== 'otra' && n.categorias[eje] === c);
    if (comunes.length > 0)
      añadir(n, `misma categoría (${comunes.map(([e, c]) => `${e}=${c}`).join(', ')})`, 2 + comunes.length / 10);
  }
  return [...elegidos.values()]
    .sort((a, b) => b.peso - a.peso || (a.nodo.ref < b.nodo.ref ? -1 : 1))
    .slice(0, MAX_CANDIDATOS)
    .map(({ nodo, motivo }) => ({
      ref: nodo.ref,
      tipo: nodo.tipo,
      etiqueta: nodo.etiqueta,
      texto: nodo.texto.slice(0, 1500),
      motivo,
    }));
}

export function hashEntradaVeredictos(clasificador: string, cambio: Cambio, candidatos: readonly Candidato[]): string {
  return huella({
    clasificador,
    cambio: { ref: cambio.principal.ref, etiqueta: cambio.principal.etiqueta, texto: cambio.principal.texto },
    candidatos: candidatos.map((c) => ({ ref: c.ref, etiqueta: c.etiqueta, texto: c.texto })),
  });
}

export function hashEntradaCategorias(clasificador: string, taxonomia: string, cambio: Cambio): string {
  return huella({
    clasificador,
    taxonomia,
    ref: cambio.principal.ref,
    etiqueta: cambio.principal.etiqueta,
    texto: cambio.principal.texto,
  });
}

/** Verificación determinista (§7.3 paso 4): un veredicto por candidato y todas las referencias existen. */
export function verificarVeredictos(
  g: Grafo,
  candidatos: readonly Candidato[],
  respuestas: readonly RespuestaChoice[],
): { ok: true } | { ok: false; motivos: string[] } {
  const motivos: string[] = [];
  const esperados = new Set(candidatos.map((c) => c.ref));
  const existentes = new Set(nodosVigentes(g).map((n) => n.ref));
  const vistos = new Map<string, number>();
  for (const r of respuestas) {
    vistos.set(r.id, (vistos.get(r.id) ?? 0) + 1);
    if (!existentes.has(r.id)) motivos.push(`El veredicto cita un nodo inexistente: ${r.id}.`);
    else if (!esperados.has(r.id)) motivos.push(`El veredicto cita un nodo que no era candidato: ${r.id}.`);
    if (!(VEREDICTOS as readonly string[]).includes(r.eleccion))
      motivos.push(`Veredicto desconocido para ${r.id}: «${r.eleccion}».`);
    if (!(r.confianza >= 0 && r.confianza <= 1)) motivos.push(`Confianza fuera de rango para ${r.id}.`);
  }
  for (const c of candidatos) {
    const n = vistos.get(c.ref) ?? 0;
    if (n === 0) motivos.push(`El candidato ${c.ref} no tiene veredicto.`);
    if (n > 1) motivos.push(`El candidato ${c.ref} tiene ${n} veredictos.`);
  }
  return motivos.length === 0 ? { ok: true } : { ok: false, motivos };
}

export type PropuestaDeRevision = { ref: string; veredicto: Veredicto; confianza: number; motivo: string };

export type Plan = {
  proyectar: Nodo[];
  invalidar: string[];
  aristasNuevas: Arista[];
  aristasInvalidadas: { tipo: string; desde: string; hacia: string }[];
  revisiones: PropuestaDeRevision[];
};

/**
 * Plan de operaciones de una actualización verificada (§7.3 paso 5). Lo que toca la autoridad
 * nunca se cambia: sale como propuesta de revisión para la persona.
 */
export function planificar(
  g: Grafo,
  cambio: Cambio,
  categorias: Readonly<Record<string, string>>,
  respuestas: readonly RespuestaChoice[],
  nuevaVersion: number,
  umbrales: Umbrales = UMBRALES_POR_DEFECTO,
): Plan {
  const vigentes = new Map(nodosVigentes(g).map((n) => [n.ref, n]));
  const plan: Plan = { proyectar: [], invalidar: [], aristasNuevas: [], aristasInvalidadas: [], revisiones: [] };
  const invalidar = new Set<string>();
  // Precedencia de versiones, en código: lo sustituido se invalida con sus criterios.
  for (const ref of cambio.sustituye) {
    if (!vigentes.has(ref)) continue;
    invalidar.add(ref);
    for (const a of aristasVigentes(g)) if (a.desde === ref && a.tipo === 'contiene') invalidar.add(a.hacia);
  }
  // El mismo ref con otro estado epistémico (borrador que se aprueba) se sustituye.
  for (const n of [cambio.principal, ...cambio.acompañantes]) if (vigentes.has(n.ref)) invalidar.add(n.ref);
  const aplicable = (confianza: number) => enrutarPorConfianza(confianza, umbrales) === 'aplicar';
  for (const r of respuestas) {
    const nodo = vigentes.get(r.id);
    if (!nodo) continue;
    const veredicto = r.eleccion as Veredicto;
    if (veredicto === 'keep') continue;
    if (veredicto === 'relate') {
      if (aplicable(r.confianza))
        plan.aristasNuevas.push({
          tipo: 'relacionado',
          desde: cambio.principal.ref,
          hacia: r.id,
          alta: nuevaVersion,
          baja: null,
        });
      continue;
    }
    if (veredicto === 'invalidate' && !nodo.autoridad && aplicable(r.confianza)) {
      invalidar.add(r.id);
      continue;
    }
    // update, invalidate, add u other sobre algo con autoridad (o con poca confianza): a la persona.
    plan.revisiones.push({ ref: r.id, veredicto, confianza: r.confianza, motivo: r.justificacion });
  }
  plan.invalidar = [...invalidar].sort();
  for (const n of [cambio.principal, ...cambio.acompañantes]) {
    plan.proyectar.push({ ...n, categorias: n.ref === cambio.principal.ref ? categorias : {}, desde: nuevaVersion, hasta: null });
  }
  // Una arista de la estructura solo se proyecta si sus dos extremos quedan vigentes.
  const quedan = new Set([...[...vigentes.keys()].filter((r) => !invalidar.has(r)), ...plan.proyectar.map((n) => n.ref)]);
  for (const a of cambio.aristas) {
    if (quedan.has(a.desde) && quedan.has(a.hacia)) plan.aristasNuevas.push({ ...a, alta: nuevaVersion, baja: null });
  }
  // Las aristas vigentes que tocan un nodo invalidado se invalidan con él.
  for (const a of aristasVigentes(g)) {
    if (invalidar.has(a.desde) || invalidar.has(a.hacia))
      plan.aristasInvalidadas.push({ tipo: a.tipo, desde: a.desde, hacia: a.hacia });
  }
  return plan;
}

const clave = (a: { tipo: string; desde: string; hacia: string }): string => `${a.tipo}|${a.desde}|${a.hacia}`;

/** Aplica un plan al grafo en memoria (reconstrucción). */
export function aplicarPlan(g: Grafo, plan: Plan, nuevaVersion: number): Grafo {
  const invalidar = new Set(plan.invalidar);
  const aristasFuera = new Set(plan.aristasInvalidadas.map(clave));
  const nodos = g.nodos.map((n) => (n.hasta === null && invalidar.has(n.ref) ? { ...n, hasta: nuevaVersion } : n));
  const aristas = g.aristas.map((a) => (a.baja === null && aristasFuera.has(clave(a)) ? { ...a, baja: nuevaVersion } : a));
  return { version: nuevaVersion, nodos: [...nodos, ...plan.proyectar], aristas: [...aristas, ...plan.aristasNuevas] };
}

/** Un plan que no cambia nada no sube la versión del grafo. */
export function planVacio(p: Plan): boolean {
  return (
    p.proyectar.length === 0 && p.invalidar.length === 0 && p.aristasNuevas.length === 0 && p.aristasInvalidadas.length === 0
  );
}

/** Huella del grafo: nodos y aristas con su validez, sin ids ni fechas (AC-CON-001-06). */
export function huellaGrafo(g: Grafo): string {
  const nodos = [...g.nodos]
    .map((n) => ({
      ref: n.ref,
      tipo: n.tipo,
      categorias: n.categorias,
      epistemico: n.epistemico,
      desde: n.desde,
      hasta: n.hasta,
    }))
    .sort((a, b) => (a.ref === b.ref ? a.desde - b.desde : a.ref < b.ref ? -1 : 1));
  const aristas = [...g.aristas]
    .map((a) => ({ tipo: a.tipo, desde: a.desde, hacia: a.hacia, alta: a.alta, baja: a.baja }))
    .sort((a, b) => {
      const ka = `${a.tipo}|${a.desde}|${a.hacia}|${a.alta}`;
      const kb = `${b.tipo}|${b.desde}|${b.hacia}|${b.alta}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  return huella({ version: g.version, nodos, aristas });
}

/** Candidatos para evaluar una idea: los nodos vigentes más parecidos (§7.7). */
export function candidatosDeIdea(g: Grafo, idea: string, limite = 8): Candidato[] {
  return nodosVigentes(g)
    .filter((n) => n.tipo !== 'criterio')
    .map((n) => ({ n, sim: similitud(idea, `${n.etiqueta}. ${n.texto}`) }))
    .filter(({ sim }) => sim >= 0.05)
    .sort((a, b) => b.sim - a.sim || (a.n.ref < b.n.ref ? -1 : 1))
    .slice(0, limite)
    .map(({ n, sim }) => ({
      ref: n.ref,
      tipo: n.tipo,
      etiqueta: n.etiqueta,
      texto: n.texto.slice(0, 1500),
      motivo: `coincidencia de texto (${sim.toFixed(2)})`,
    }));
}

/** Selección de conocimiento para un context pack: relevancia léxica, con motivo y presupuesto. */
export function seleccionarParaContexto(g: Grafo, consulta: string, presupuesto: number): { nodo: Nodo; motivo: string }[] {
  const puntuados = nodosVigentes(g)
    .filter((n) => n.epistemico === 'confirmado' && n.tipo !== 'criterio')
    .map((n) => ({ nodo: n, sim: similitud(consulta, `${n.etiqueta}. ${n.texto}`) }))
    .filter(({ sim }) => sim > 0)
    .sort((a, b) => b.sim - a.sim || (a.nodo.ref < b.nodo.ref ? -1 : 1));
  const elegidos: { nodo: Nodo; motivo: string }[] = [];
  let usado = 0;
  for (const { nodo, sim } of puntuados) {
    const coste = nodo.etiqueta.length + Math.min(nodo.texto.length, 600);
    if (usado + coste > presupuesto) break;
    usado += coste;
    elegidos.push({ nodo, motivo: `relevancia por tema (${sim.toFixed(2)})` });
  }
  return elegidos;
}
