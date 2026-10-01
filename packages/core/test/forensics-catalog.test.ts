// The piece catalog of the forensics is built from the code, so a piece that exists and the catalog misses fails here:
// every agent and skill folder, harness piece, bus guard, build stage, queue decision, Jev question module,
// context-pack builder and escape rule must be in it.

import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadAgentCatalog } from '../src/agents/catalog.ts';
import { CLASSIFIER_PLUMBING_FILES, JEV_QUESTION_FILES, catalogVersion, loadPieceCatalog } from '../src/forensics/catalog.ts';
import { PIECE_NAMES } from '../src/harness/pieces.ts';

const dir = (path: string) => new URL(path, import.meta.url);
const ids = async () => new Set((await loadPieceCatalog()).map((i) => i.id));

describe('forensics piece catalog', () => {
  it('every item has an id, a kind, a name, a version and what it does; ids are unique and sorted', async () => {
    const items = await loadPieceCatalog();
    expect(items.length).toBeGreaterThan(100);
    for (const i of items) {
      expect(i.id).toMatch(/^[a-z]+:[A-Za-z0-9_.-]+$/);
      expect(i.name.length).toBeGreaterThan(0);
      expect(i.version.length).toBeGreaterThan(0);
      expect(i.what_it_does.length).toBeGreaterThan(0);
    }
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(items.map((i) => i.id)).toEqual(items.map((i) => i.id).toSorted());
  });

  it('has every agent folder and every skill folder of packages/core', async () => {
    const have = await ids();
    for (const a of (await readdir(dir('../agents/'), { withFileTypes: true })).filter((e) => e.isDirectory())) expect(have, `agent:${a.name}`).toContain(`agent:${a.name}`);
    for (const s of (await readdir(dir('../skills/'), { withFileTypes: true })).filter((e) => e.isDirectory())) expect(have, `skill:${s.name}`).toContain(`skill:${s.name}`);
    const catalog = await loadAgentCatalog();
    for (const a of catalog.agents) expect(have).toContain(`agent:${a.id}`);
    expect(have).toContain('agent:task_forensics');
    expect(have).toContain('agent:playbook_writer');
  });

  it('has every harness piece B01–B27 and D01–D12', async () => {
    const have = await ids();
    for (const code of Object.keys(PIECE_NAMES)) expect(have).toContain(`piece:${code}`);
    expect(have).toContain('piece:B07');
    expect(have).toContain('piece:D12');
  });

  it('has every bus guard, by name', async () => {
    const have = await ids();
    const { GUARDS } = await import('../src/bus/guards.ts');
    expect(Object.keys(GUARDS).length).toBeGreaterThan(20);
    for (const name of Object.keys(GUARDS)) expect(have).toContain(`guard:${name}`);
  });

  it('has every build stage the orchestrator records', async () => {
    const have = await ids();
    const source = await readFile(dir('../src/build/orchestrator.ts'), 'utf8');
    const stages = [...source.matchAll(/\b(?:stage|record)\(r, '([a-z_]+)'/g)].map((m) => m[1]);
    expect(stages.length).toBeGreaterThan(10);
    for (const s of stages) expect(have).toContain(`stage:${s}`);
    for (const s of ['environment', 'builder', 'commit', 'design', 'review', 'merge']) expect(have).toContain(`stage:${s}`);
  });

  it('has every queue decision that holds a task', async () => {
    const have = await ids();
    for (const k of ['wait_dependency', 'wait_feature_busy', 'wait_schema', 'wait_module', 'wait_testability', 'wait_hold', 'over_limit', 'stopped']) expect(have).toContain(`queue:${k}`);
    expect(have).not.toContain('queue:start');
  });

  it('has every Jev question module: a new classifier file is a question or plumbing, never forgotten', async () => {
    const have = await ids();
    const files = (await readdir(dir('../src/classifier/'))).filter((f) => f.endsWith('.ts')).map((f) => f.replace(/\.ts$/, ''));
    const known = new Set<string>([...JEV_QUESTION_FILES, ...CLASSIFIER_PLUMBING_FILES]);
    expect(files.filter((f) => !known.has(f)), 'classifier files that are neither a Jev question nor plumbing: add them to forensics/catalog.ts').toEqual([]);
    for (const f of JEV_QUESTION_FILES) expect(have).toContain(`jev:${f.replaceAll('-', '_')}`);
    const items = await loadPieceCatalog();
    // A question version comes from its module's own `*_QUESTION_VERSION` exports.
    expect(items.find((i) => i.id === 'jev:task_needs')?.version).toMatch(/^[0-9a-f]{12}$/);
  });

  it('has every context-pack builder, readiness and every escape rule', async () => {
    const have = await ids();
    const { BUILDERS } = await import('../src/context/build.ts');
    for (const action of Object.keys(BUILDERS)) expect(have).toContain(`context:${action}`);
    expect(have).toContain('context:task_forensics');
    expect(have).toContain('readiness:ready_to_build');
    const { ESCAPE_RULES } = await import('../src/harness/rules/escapes/index.ts');
    for (const code of Object.keys(ESCAPE_RULES)) expect(have).toContain(`escape:${code}`);
    const e15 = (await loadPieceCatalog()).find((i) => i.id === 'escape:E15');
    expect(e15?.what_it_does).toContain('shared_without_dependency');
  });

  it('the catalog version is the hash of the ids: stable, and any piece added or removed changes it', async () => {
    const items = await loadPieceCatalog();
    expect(catalogVersion(items)).toBe(catalogVersion(await loadPieceCatalog()));
    expect(catalogVersion(items)).toBe(catalogVersion([...items].reverse()));
    expect(catalogVersion(items.slice(1))).not.toBe(catalogVersion(items));
    // A piece changing its own version does not change the shape of the checklist.
    expect(catalogVersion(items.map((i) => ({ ...i, version: 'x' })))).toBe(catalogVersion(items));
  });
});
