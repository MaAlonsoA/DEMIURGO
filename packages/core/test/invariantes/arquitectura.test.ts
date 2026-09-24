// Pruebas de arquitectura sobre el código fuente.

import { readFile, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { esComando, todasLasGuardas } from '@demiurgo/domain';
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

  it('AC-CON-001-12 el actualizador y el clasificador solo emiten comandos de conocimiento derivado, clasificaciones y propuestas', async () => {
    const PERMITIDOS = new Set([
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
    ]);
    const TABLAS_PERMITIDAS = new Set(['verdict_cache', 'classifier_evaluations']);
    const modulos = ['actualizar.ts', 'flujos.ts', 'reconstruir.ts', 'derivar.ts', 'grafo-pg.ts', 'integracion.ts', 'evaluar.ts'];
    const infracciones: string[] = [];
    for (const m of modulos) {
      const texto = await readFile(`packages/core/src/conocimiento/${m}`, 'utf8');
      // Todo literal que nombra un comando de la matriz debe estar en la lista permitida.
      for (const c of texto.matchAll(/'([a-z_]+\.[a-z_]+)'/g)) {
        const nombre = c[1] ?? '';
        if (esComando(nombre) && !PERMITIDOS.has(nombre)) infracciones.push(`${m}: ${nombre}`);
      }
      // Ninguna escritura directa fuera de las tablas de caché y evaluaciones.
      for (const t of texto.matchAll(
        /(?:insertInto|updateTable|deleteFrom)\('([a-z_]+)'\)|insert into ([a-z_]+)|update ([a-z_]+) set/g,
      )) {
        const tabla = t[1] ?? t[2] ?? t[3] ?? '';
        if (!TABLAS_PERMITIDAS.has(tabla)) infracciones.push(`${m}: escribe en ${tabla}`);
      }
    }
    expect(infracciones).toEqual([]);
  });
});
