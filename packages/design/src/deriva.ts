// Genera el módulo de tablas del dominio desde `design/datos/`. La deriva (tablas en el
// dominio distintas de las de design/) hace fallar `pnpm gate:deriva`.

import { esquemaCapacidades, esquemaTransiciones, incoherenciasTablas } from '@demiurgo/domain/tablas/esquemas';
import { parse as parsearYaml } from 'yaml';

export const RUTA_MODULO_TABLAS = 'packages/domain/src/generado/tablas.ts';

export function generarModuloTablas(capacidadesYaml: string, transicionesYaml: string): string {
  const cap = esquemaCapacidades.parse(parsearYaml(capacidadesYaml));
  const tra = esquemaTransiciones.parse(parsearYaml(transicionesYaml));
  const errores = incoherenciasTablas(cap, tra);
  if (errores.length > 0) throw new Error(`Tablas incoherentes:\n- ${errores.join('\n- ')}`);
  return [
    '// Generado por `node packages/design/src/cli.ts derivar` desde design/datos/. No lo edites a mano.',
    '',
    `export const CAPACIDADES = ${JSON.stringify(cap, null, 2)} as const;`,
    '',
    `export const TRANSICIONES = ${JSON.stringify(tra, null, 2)} as const;`,
    '',
  ].join('\n');
}
