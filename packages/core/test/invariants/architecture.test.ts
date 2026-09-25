// Architecture tests over the source code.

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

/** Modules that may read environment variables: config and the environment of child processes. */
// The probe holds the script that runs inside the container: there it reads the runner's environment.
const ENV_READERS = new Set([
  'packages/core/src/config.ts',
  'packages/core/src/env.ts',
  'packages/core/src/runner/probe.ts',
  // MCP server startup: a separate process that only reads its URL, its token and its project.
  'packages/mcp/src/main.ts',
  // The evidence ingester runs outside the application and reads only its own variables.
  'packages/evidence/src/config.ts',
]);

describe('architecture', () => {
  it('AC-ESQ-001-06 only config reads environment variables', async () => {
    const violators = [...(await allSources()).entries()]
      .filter(([path, text]) => !ENV_READERS.has(path) && /process\.env\b/.test(text))
      .map(([path]) => path);
    expect(violators).toEqual([]);
  });

  it('AC-ESQ-001-06 tests use ephemeral databases with prefix dmg_t_', async () => {
    const base = await createEphemeralDatabase();
    try {
      expect(base.name).toMatch(/^dmg_t_\d+_[0-9a-f]{8}$/);
      expect(new URL(base.url).pathname).toBe(`/${base.name}`);
    } finally {
      await base.drop();
    }
  });

  it('AC-NUC-001-03 every guard declared in the tables has a registered implementation', () => {
    const notImplemented = allGuards().filter((g) => !GUARDS[g]);
    expect(notImplemented).toEqual([]);
  });

  it('AC-DIS-001-04 agent actions only post messages, raise or infer questions and submit batches: they never decide (I2)', async () => {
    // An agent's output is applied here: messages, questions (the system infers them) and batches of proposals.
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
          violations.push(`${path}: writes to ${t[1] ?? t[2] ?? t[3] ?? ''}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('AC-CON-001-12 the updater and the classifier only emit derived-knowledge commands, classifications and proposals', async () => {
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
      ...['update.ts', 'workflows.ts', 'rebuild.ts', 'derive.ts', 'graph-pg.ts', 'integration.ts', 'evaluate.ts'].map(
        (m) => `packages/core/src/knowledge/${m}`,
      ),
      // The classifier adapters emit no commands and write nothing to the database.
      ...(await sources('packages/core/src/classifier')).keys(),
    ];
    const violations: string[] = [];
    for (const m of modules) {
      const text = await readFile(m, 'utf8');
      // Every literal naming a matrix command must be in the allowed list.
      for (const c of text.matchAll(/'([a-z_]+\.[a-z_]+)'/g)) {
        const name = c[1] ?? '';
        if (isCommand(name) && !ALLOWED.has(name)) violations.push(`${m}: ${name}`);
      }
      // No direct write outside the cache and evaluations tables.
      for (const t of text.matchAll(
        /(?:insertInto|updateTable|deleteFrom)\('([a-z_]+)'\)|insert into ([a-z_]+)|update ([a-z_]+) set/g,
      )) {
        const table = t[1] ?? t[2] ?? t[3] ?? '';
        if (!ALLOWED_TABLES.has(table)) violations.push(`${m}: writes to ${table}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('AC-CON-001-12 the knowledge component has a closed list with no decisive commands or authority states', () => {
    // The bus enforces the list at runtime (even though the matrix allows the command for system): so
    // building the command name at runtime doesn't work either.
    const violations: string[] = [];
    for (const c of COMMANDS_BY_COMPONENT.knowledge ?? []) {
      if (!isCommand(c)) {
        violations.push(`${c}: is not a command`);
        continue;
      }
      if (isDecisive(c)) violations.push(`${c}: is decisive`);
      const def = entityDefinition(entityOf(c));
      for (const t of def.transitions.filter((x) => x.command === c)) {
        if (def.authority.includes(t.to)) violations.push(`${c}: reaches authority state ${t.to}`);
      }
    }
    expect(violations).toEqual([]);
    // And superseding an approved version requires a later approved one (guard in the table).
    expect(findTransition('record_version', 'approved', 'record_version.supersede')?.guards).toContain('has_later_approved');
  });
});
