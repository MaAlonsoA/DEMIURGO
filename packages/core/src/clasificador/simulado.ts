// Clasificador simulado determinista (AC-CLA-001-02): reglas léxicas sobre el estado de cada
// ítem. Es la línea base de las pruebas y de la evaluación; no pretende ser bueno, sino
// reproducible. Cada ítem declara su tarea en `estado.tarea`.

import {
  type Clasificador,
  type ItemChoice,
  type ItemNoul,
  type ItemScore,
  type RespuestaChoice,
  avisosDeVerificabilidad,
  sinAcentos,
  similitud,
  solape,
} from '@demiurgo/domain';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null ? (v as Obj) : {});
const txt = (v: unknown): string => (typeof v === 'string' ? v : '');
const textoDe = (n: Obj): string => `${txt(n.titulo)}. ${txt(n.texto)}`;

const SUSTITUYE =
  /\b(sustitu\w*|reemplaz\w*|deja(n)? obsolet\w*|anula\w*|revoca\w*|en lugar de|ya no|deja(n)? de|elimina\w*|suprim\w*|desaparece\w*)\b/;
const NIEGA = /\b(no|nunca|sin|ningun\w*|prohib\w*|impide\w*)\b/;
const AÑADE = /\b(anad\w*|nuev[oa]s?|ademas|tambien|incluye\w*|amplia\w*|agrega\w*)\b/;

function normal(t: string): string {
  return sinAcentos(t.toLowerCase());
}

function elegir(item: ItemChoice, eleccion: string, confianza: number, justificacion: string): RespuestaChoice {
  let final = eleccion;
  if (!item.opciones.includes(eleccion)) final = item.opciones.includes('other') ? 'other' : (item.opciones[0] ?? eleccion);
  const resto = (1 - confianza) / Math.max(1, item.opciones.length - 1);
  const distribucion = Object.fromEntries(item.opciones.map((o) => [o, o === final ? confianza : resto]));
  return { id: item.id, eleccion: final, distribucion, confianza, justificacion };
}

function veredicto(item: ItemChoice): RespuestaChoice {
  const e = obj(item.estado);
  const cambio = obj(e.cambio);
  const cand = obj(e.candidato);
  const tc = normal(textoDe(cambio));
  const sim = similitud(textoDe(cambio), textoDe(cand));
  const refCand = txt(cand.ref).split('@')[0] ?? '';
  const citaCandidato = refCand !== '' && tc.includes(normal(refCand));
  if (citaCandidato && SUSTITUYE.test(tc))
    return elegir(item, 'invalidate', 0.9, `El cambio sustituye explícitamente a ${refCand}.`);
  if (sim >= 0.3 && SUSTITUYE.test(tc)) return elegir(item, 'invalidate', 0.7, 'Mismo tema y el cambio sustituye lo anterior.');
  if (sim >= 0.3 && NIEGA.test(tc) !== NIEGA.test(normal(textoDe(cand)))) {
    return elegir(item, 'update', 0.6, 'Mismo tema con una condición distinta.');
  }
  if (sim >= 0.2 && AÑADE.test(tc)) return elegir(item, 'add', 0.6, 'El cambio añade algo al mismo tema.');
  if (sim >= 0.2 || citaCandidato) return elegir(item, 'relate', 0.8, 'Comparten tema.');
  if (sim >= 0.1) return elegir(item, 'relate', 0.6, 'Relación débil por vocabulario compartido.');
  return elegir(item, 'keep', 0.85, 'Sin relación apreciable.');
}

function hallazgoIdea(item: ItemChoice): RespuestaChoice {
  const e = obj(item.estado);
  const idea = txt(obj(e.idea).texto);
  const nodo = textoDe(obj(e.nodo));
  const sim = similitud(idea, nodo);
  const cobertura = Math.min(solape(idea, nodo), solape(nodo, idea));
  if (sim >= 0.45 || cobertura >= 0.6) return elegir(item, 'duplicates', 0.85, 'La idea dice lo mismo que el nodo.');
  const niegaIdea = NIEGA.test(normal(idea));
  const niegaNodo = NIEGA.test(normal(nodo));
  if (sim >= 0.2 && niegaIdea !== niegaNodo) return elegir(item, 'conflicts', 0.65, 'Mismo tema con sentido contrario.');
  if (sim >= 0.12) return elegir(item, 'relates', 0.7, 'Comparten tema.');
  return elegir(item, 'none', 0.8, 'Sin relación apreciable.');
}

function categoria(item: ItemChoice): RespuestaChoice {
  const e = obj(item.estado);
  const artefacto = textoDe(obj(e.artefacto));
  const categorias = Array.isArray(e.categorias) ? e.categorias.map(obj) : [];
  let mejor = { codigo: 'otra', valor: 0 };
  for (const c of categorias) {
    const codigo = txt(c.codigo);
    if (codigo === 'otra') continue;
    const valor = solape(`${txt(c.nombre)} ${txt(c.descripcion)} ${codigo}`, artefacto);
    if (valor > mejor.valor) mejor = { codigo, valor };
  }
  if (mejor.valor === 0) return elegir(item, 'otra', 0.5, 'Ninguna categoría encaja.');
  const confianza = Math.min(0.95, 0.55 + mejor.valor);
  return elegir(item, mejor.codigo, confianza, `Coincide con la descripción de «${mejor.codigo}».`);
}

export function crearClasificadorSimulado(): Clasificador {
  return {
    id: 'simulado@1',
    async choice(items) {
      return items.map((item) => {
        const tarea = obj(item.estado).tarea;
        if (tarea === 'veredicto') return veredicto(item);
        if (tarea === 'idea') return hallazgoIdea(item);
        if (tarea === 'categoria') return categoria(item);
        return elegir(item, item.opciones[0] ?? 'other', 0.3, 'Tarea desconocida para el simulador.');
      });
    },
    async score(items: readonly ItemScore[]) {
      return items.map((item) => {
        const e = obj(item.estado);
        const sim = similitud(txt(e.consulta), txt(e.texto));
        const niveles = item.niveles.length;
        const nivel = Math.min(niveles - 1, Math.floor(sim * niveles * 2));
        const distribucion = item.niveles.map((_, i) => (i === nivel ? 0.7 : 0.3 / Math.max(1, niveles - 1)));
        return { id: item.id, nivel, distribucion, confianza: 0.7 };
      });
    },
    async noul(items: readonly ItemNoul[]) {
      return items.map((item) => {
        const avisos = avisosDeVerificabilidad('AC', txt(obj(item.estado).texto));
        return { id: item.id, probabilidad: avisos.length === 0 ? 0.85 : 0.25, confianza: 0.7 };
      });
    },
  };
}
