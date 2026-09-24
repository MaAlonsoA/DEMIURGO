// Mapa AC → prueba a partir de los informes JUnit de Vitest: cada criterio automático de un
// incremento implementado tiene al menos una prueba que pasó y cuyo título empieza por su
// código. Se basa en lo que se ejecutó, no en el texto de las pruebas: un comentario, una
// cadena, un `describe` o una prueba saltada o fallida no cuentan. Es la versión provisional
// del mapa AC → comprobación → prueba del Pilar 2 (§6 del plan).

import type { DocumentoRegistro } from './tipos.ts';

export type ResultadoCaso = 'pasada' | 'fallida' | 'saltada';

/** Un `testcase` de un informe JUnit: archivo (classname), nombre completo y resultado. */
export type CasoJUnit = { archivo: string; nombre: string; resultado: ResultadoCaso };

export type MapaTrazabilidad = {
  /** Código de AC → pruebas que pasaron y lo citan, como «archivo > nombre». */
  pruebasPorAc: Map<string, Set<string>>;
  sinPrueba: { registro: string; ac: string }[];
  desconocidos: { archivo: string; prueba: string; ac: string }[];
};

const ENTIDADES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodifica las entidades de XML en una sola pasada (así «&amp;lt;» queda «&lt;»). */
export function decodificarEntidades(texto: string): string {
  return texto.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (entera, nombre: string) => {
    if (nombre.startsWith('#x')) return String.fromCodePoint(Number.parseInt(nombre.slice(2), 16));
    if (nombre.startsWith('#')) return String.fromCodePoint(Number(nombre.slice(1)));
    return ENTIDADES[nombre] ?? entera;
  });
}

const RE_TESTCASE = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
const RE_ATRIBUTO = /([\w:.-]+)\s*=\s*"([^"]*)"/g;

function atributos(texto: string): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const m of texto.matchAll(RE_ATRIBUTO)) mapa.set(m[1] ?? '', decodificarEntidades(m[2] ?? ''));
  return mapa;
}

/**
 * Un informe está completo si cierra `<testsuites>`: Vitest abre el archivo al empezar y solo
 * escribe el informe al terminar, así que una ejecución cortada deja un archivo vacío.
 */
export function informeCompleto(xml: string): boolean {
  return /<testsuites\b[\s\S]*<\/testsuites>\s*$/.test(xml);
}

/** Lee los `testcase` de un informe JUnit como el que escribe Vitest (XML simple, sin CDATA). */
export function casosDeJUnit(xml: string): CasoJUnit[] {
  const casos: CasoJUnit[] = [];
  for (const m of xml.matchAll(RE_TESTCASE)) {
    const attrs = atributos(m[1] ?? '');
    const cuerpo = m[2] ?? '';
    let resultado: ResultadoCaso = 'pasada';
    if (/<(?:failure|error)\b/.test(cuerpo)) resultado = 'fallida';
    else if (/<skipped\b/.test(cuerpo)) resultado = 'saltada';
    casos.push({ archivo: attrs.get('classname') ?? attrs.get('file') ?? '', nombre: attrs.get('name') ?? '', resultado });
  }
  return casos;
}

/** Título propio de una prueba: Vitest antepone los `describe` separados por « > ». */
export function tituloPropio(nombre: string): string {
  const i = nombre.lastIndexOf(' > ');
  return i < 0 ? nombre : nombre.slice(i + 3);
}

const RE_CODIGOS_INICIALES = /^AC-[A-Z]{3}-\d{3}-\d{2}(?:\s+AC-[A-Z]{3}-\d{3}-\d{2})*(?=\s|$)/;

/** Códigos de AC con los que empieza el título propio de una prueba (uno o varios seguidos). */
export function codigosCitados(nombre: string): string[] {
  const m = RE_CODIGOS_INICIALES.exec(tituloPropio(nombre).trimStart());
  return m ? m[0].split(/\s+/) : [];
}

export function mapaTrazabilidad(
  registros: readonly DocumentoRegistro[],
  casos: readonly CasoJUnit[],
  incrementosImplementados: readonly string[],
): MapaTrazabilidad {
  const pruebasPorAc = new Map<string, Set<string>>();
  const conocidos = new Set(registros.flatMap((r) => r.criterios.map((c) => c.codigo)));
  const desconocidos: MapaTrazabilidad['desconocidos'] = [];
  for (const caso of casos) {
    if (caso.resultado !== 'pasada') continue;
    for (const ac of codigosCitados(caso.nombre)) {
      if (!conocidos.has(ac)) {
        desconocidos.push({ archivo: caso.archivo, prueba: caso.nombre, ac });
        continue;
      }
      const s = pruebasPorAc.get(ac) ?? new Set<string>();
      s.add(`${caso.archivo} > ${caso.nombre}`);
      pruebasPorAc.set(ac, s);
    }
  }
  const sinPrueba: MapaTrazabilidad['sinPrueba'] = [];
  for (const r of registros) {
    if (!r.incremento || !incrementosImplementados.includes(r.incremento)) continue;
    if (r.estado === 'descartado' || r.estado === 'sustituido') continue;
    for (const c of r.criterios) {
      if (c.verificacion === 'automática' && !pruebasPorAc.has(c.codigo)) sinPrueba.push({ registro: r.codigo, ac: c.codigo });
    }
  }
  return { pruebasPorAc, sinPrueba, desconocidos };
}
