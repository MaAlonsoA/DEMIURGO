// Mapa AC → prueba: cada criterio automático de un incremento implementado tiene al menos
// una prueba cuyo nombre contiene su código. Es la versión provisional del mapa
// AC → comprobación → prueba del Pilar 2 (§6 del plan).

import type { DocumentoRegistro } from './tipos.ts';

const RE_AC = /AC-[A-Z]{3}-\d{3}-\d{2}/g;
// Primer argumento literal de it/test/describe (sin .skip ni .todo).
const RE_NOMBRE_PRUEBA =
  /\b(?:it|test|describe)(?:\.(?:each\([^)]*\)|only|concurrent|sequential))*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

export type MapaTrazabilidad = {
  /** Código de AC → archivos de prueba donde aparece en el nombre de una prueba. */
  pruebasPorAc: Map<string, Set<string>>;
  sinPrueba: { registro: string; ac: string }[];
  desconocidos: { archivo: string; ac: string }[];
};

export function codigosEnNombresDePrueba(fuente: string): string[] {
  const codigos: string[] = [];
  for (const m of fuente.matchAll(RE_NOMBRE_PRUEBA)) {
    const nombre = m[2] ?? '';
    for (const c of nombre.matchAll(RE_AC)) codigos.push(c[0]);
  }
  return codigos;
}

export function mapaTrazabilidad(
  registros: readonly DocumentoRegistro[],
  archivosDePrueba: ReadonlyMap<string, string>,
  incrementosImplementados: readonly string[],
): MapaTrazabilidad {
  const pruebasPorAc = new Map<string, Set<string>>();
  const conocidos = new Set(registros.flatMap((r) => r.criterios.map((c) => c.codigo)));
  const desconocidos: MapaTrazabilidad['desconocidos'] = [];
  for (const [archivo, fuente] of archivosDePrueba) {
    for (const ac of codigosEnNombresDePrueba(fuente)) {
      if (!conocidos.has(ac)) {
        desconocidos.push({ archivo, ac });
        continue;
      }
      const s = pruebasPorAc.get(ac) ?? new Set<string>();
      s.add(archivo);
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
