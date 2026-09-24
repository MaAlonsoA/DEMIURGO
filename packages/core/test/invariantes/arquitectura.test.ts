// Pruebas de arquitectura sobre el código fuente.

import { readFile, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { todasLasGuardas } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import '../../src/bus/bus.ts';
import { GUARDAS } from '../../src/bus/guardas.ts';
import { crearBaseEfimera } from '../soporte/base-efimera.ts';

async function fuentes(dir: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.ts')) {
      const ruta = join(e.parentPath, e.name).split(sep).join('/');
      m.set(ruta, await readFile(ruta, 'utf8'));
    }
  }
  return m;
}

async function todasLasFuentes(): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const p of await readdir('packages')) {
    const dir = join('packages', p, 'src');
    for (const [k, v] of await fuentes(dir).catch(() => new Map<string, string>())) m.set(k, v);
  }
  return m;
}

/** Módulos que pueden leer variables de entorno: la configuración y el entorno de procesos hijos. */
// La sonda contiene el script que se ejecuta dentro del contenedor: allí lee el entorno del runner.
const LECTORES_DE_ENTORNO = new Set([
  'packages/core/src/config.ts',
  'packages/core/src/entorno.ts',
  'packages/core/src/runner/sonda.ts',
  // Arranque del servidor MCP: proceso aparte que solo lee su URL, su token y su proyecto.
  'packages/mcp/src/main.ts',
]);

describe('arquitectura', () => {
  it('AC-ESQ-001-06 solo la configuración lee variables de entorno', async () => {
    const infractores = [...(await todasLasFuentes()).entries()]
      .filter(([ruta, texto]) => !LECTORES_DE_ENTORNO.has(ruta) && /process\.env\b/.test(texto))
      .map(([ruta]) => ruta);
    expect(infractores).toEqual([]);
  });

  it('AC-ESQ-001-06 las pruebas usan bases efímeras con prefijo dmg_t_', async () => {
    const base = await crearBaseEfimera();
    try {
      expect(base.nombre).toMatch(/^dmg_t_\d+_[0-9a-f]{8}$/);
      expect(new URL(base.url).pathname).toBe(`/${base.nombre}`);
    } finally {
      await base.eliminar();
    }
  });

  it('AC-NUC-001-03 toda guarda declarada en las tablas tiene implementación registrada', () => {
    const sinImplementar = todasLasGuardas().filter((g) => !GUARDAS[g]);
    expect(sinImplementar).toEqual([]);
  });
});
