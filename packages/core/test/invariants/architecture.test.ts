// Pruebas de arquitectura sobre el código fuente.

import { readFile, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import {
  COMMANDS_BY_COMPONENT,
  findTransition,
  entityDefinition,
  entityOf,
  isCommand,
  isDecisive,
  allGuards,
} from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import '../../src/bus/bus.ts';
import { GUARDS } from '../../src/bus/guards.ts';
import { createEphemeralDatabase } from '../support/ephemeral-db.ts';

async function sources(dir: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.ts')) {
      const path = join(e.parentPath, e.name).split(sep).join('/');
      m.set(path, await readFile(path, 'utf8'));
    }
  }
  return m;
}

async function allSources(): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const p of await readdir('packages')) {
    const dir = join('packages', p, 'src');
    for (const [k, v] of await sources(dir).catch(() => new Map<string, string>())) m.set(k, v);
  }
  return m;
}

/** Módulos que pueden leer variables de entorno: la configuración y el entorno de procesos hijos. */
// La sonda contiene el script que se ejecuta dentro del contenedor: allí lee el entorno del runner.
const ENV_READERS = new Set([
  'packages/core/src/config.ts',
  'packages/core/src/env.ts',
  'packages/core/src/runner/probe.ts',
  // Arranque del servidor MCP: proceso aparte que solo lee su URL, su token y su proyecto.
  'packages/mcp/src/main.ts',
]);

describe('architecture', () => {
  it('AC-ESQ-001-06 solo la configuración lee variables de entorno', async () => {
    const violators = [...(await allSources()).entries()]
      .filter(([path, text]) => !ENV_READERS.has(path) && /process\.env\b/.test(text))
      .map(([path]) => path);
    expect(violators).toEqual([]);
  });

  it('AC-ESQ-001-06 las pruebas usan bases efímeras con prefijo dmg_t_', async () => {
    const base = await createEphemeralDatabase();
    try {
      expect(base.name).toMatch(/^dmg_t_\d+_[0-9a-f]{8}$/);
      expect(new URL(base.url).pathname).toBe(`/${base.name}`);
    } finally {
      await base.drop();
    }
  });

  it('AC-NUC-001-03 toda guarda declarada en las tablas tiene implementación registrada', () => {
    const notImplemented = allGuards().filter((g) => !GUARDS[g]);
    expect(notImplemented).toEqual([]);
  });

  it('AC-DIS-001-04 las acciones de agente solo publican, plantean o infieren preguntas y envían lotes: nunca deciden (I2)', async () => {
    // La salida de un agente se aplica aquí: mensajes, preguntas (el sistema las infiere) y lotes de propuestas.
    const ALLOWED = new Set(['message.post', 'question.raise', 'question.infer', 'batch.submit']);
    const violations: string[] = [];
    for (const dir of ['packages/core/src/actions', 'packages/core/src/agents']) {
      for (const [path, text] of await sources(dir)) {
        for (const c of text.matchAll(/'([a-z_]+\.[a-z_]+)'/g)) {
          const name = c[1] ?? '';
          if (isCommand(name) && !ALLOWED.has(name)) violations.push(`${path}: ${name}`);
        }
        for (const t of text.matchAll(
          /(?:insertInto|updateTable|deleteFrom)\('([a-z_]+)'\)|insert into ([a-z_]+)|update ([a-z_]+) set/g,
        )) {
          violations.push(`${path}: escribe en ${t[1] ?? t[2] ?? t[3] ?? ''}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('AC-CON-001-12 el actualizador y el clasificador solo emiten comandos de conocimiento derivado, clasificaciones y propuestas', async () => {
    const ALLOWED = new Set([
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
    const ALLOWED_TABLES = new Set(['verdict_cache', 'classifier_evaluations']);
    const modules = [
      ...['actualizar.ts', 'flujos.ts', 'reconstruir.ts', 'derive.ts', 'grafo-pg.ts', 'integration.ts', 'assess.ts'].map(
        (m) => `packages/core/src/knowledge/${m}`,
      ),
      // Los adaptadores del clasificador no emiten comandos ni escriben en la base.
      ...(await sources('packages/core/src/classifier')).keys(),
    ];
    const violations: string[] = [];
    for (const m of modules) {
      const text = await readFile(m, 'utf8');
      // Todo literal que nombra un comando de la matriz debe estar en la lista permitida.
      for (const c of text.matchAll(/'([a-z_]+\.[a-z_]+)'/g)) {
        const name = c[1] ?? '';
        if (isCommand(name) && !ALLOWED.has(name)) violations.push(`${m}: ${name}`);
      }
      // Ninguna escritura directa fuera de las tablas de caché y evaluaciones.
      for (const t of text.matchAll(
        /(?:insertInto|updateTable|deleteFrom)\('([a-z_]+)'\)|insert into ([a-z_]+)|update ([a-z_]+) set/g,
      )) {
        const table = t[1] ?? t[2] ?? t[3] ?? '';
        if (!ALLOWED_TABLES.has(table)) violations.push(`${m}: escribe en ${table}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('AC-CON-001-12 el componente del conocimiento tiene una lista cerrada sin comandos decisivos ni estados de autoridad', () => {
    // La lista la impone el bus en ejecución (aunque la matriz permita el comando a system): así
    // tampoco vale construir el nombre del comando en tiempo de ejecución.
    const violations: string[] = [];
    for (const c of COMMANDS_BY_COMPONENT.knowledge ?? []) {
      if (!isCommand(c)) {
        violations.push(`${c}: no es un comando`);
        continue;
      }
      if (isDecisive(c)) violations.push(`${c}: es decisivo`);
      const def = entityDefinition(entityOf(c));
      for (const t of def.transitions.filter((x) => x.command === c)) {
        if (def.authority.includes(t.to)) violations.push(`${c}: alcanza el estado de autoridad ${t.to}`);
      }
    }
    expect(violations).toEqual([]);
    // Y sustituir una versión aprobada exige otra aprobada posterior (guarda en la tabla).
    expect(findTransition('record_version', 'approved', 'record_version.supersede')?.guards).toContain(
      'has_later_approved',
    );
  });
});
