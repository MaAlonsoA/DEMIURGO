// The pure parts of the Metabase setup (`pnpm evidence metabase-setup`, spec §12, §15.3) and of the env
// file `pnpm evidence:up` generates: no Metabase and no database here. The live setup is checked by hand
// against the stack (docs/observabilidad.md).

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QUESTIONS_DIR, listQuestions } from '../src/ask.ts';
import {
  DASHBOARD_NAME,
  GRID_WIDTH,
  NO_RUN,
  QUESTIONS,
  byName,
  dashboardLayout,
  planDashcards,
  readAdminPassword,
  tagId,
  toNativeQuery,
} from '../src/metabase.ts';
import { ensureEnvFile, missingSecretLines, parseEnvFile, renderEnvFile } from '../src/up.ts';

describe('env file', () => {
  it('parses KEY=value pairs, ignoring comments, blanks and quotes', () => {
    const text = [
      '# a comment',
      '',
      'PHOENIX_SECRET=abc123',
      "PHOENIX_ADMIN_PASSWORD='quoted value'",
      'METABASE_ADMIN_PASSWORD="with=equals"',
      '  SPACED = padded  ',
      'no-equals-here',
      '=nokey',
    ].join('\r\n');
    expect(parseEnvFile(text)).toEqual({
      PHOENIX_SECRET: 'abc123',
      PHOENIX_ADMIN_PASSWORD: 'quoted value',
      METABASE_ADMIN_PASSWORD: 'with=equals',
      SPACED: 'padded',
    });
  });

  it('renders the four secrets, each parseable back', () => {
    const rendered = renderEnvFile((n) => 'x'.repeat(n * 2));
    expect(parseEnvFile(rendered)).toEqual({
      PHOENIX_SECRET: 'x'.repeat(64),
      PHOENIX_SYSTEM_KEY: 'x'.repeat(64),
      PHOENIX_ADMIN_PASSWORD: 'x'.repeat(24),
      METABASE_ADMIN_PASSWORD: 'x'.repeat(24),
    });
    expect(missingSecretLines(parseEnvFile(rendered))).toEqual([]);
  });

  it('appends only the missing secrets to an existing file, and leaves a complete one alone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dmg-env-'));
    const path = join(dir, '.env');
    // A file from before phase 5: three secrets, no trailing newline.
    await writeFile(path, 'PHOENIX_SECRET=a\nPHOENIX_SYSTEM_KEY=b\nPHOENIX_ADMIN_PASSWORD=c', 'utf8');
    expect(await ensureEnvFile(path)).toEqual({ state: 'extended', keys: ['METABASE_ADMIN_PASSWORD'] });
    const parsed = parseEnvFile(await readFile(path, 'utf8'));
    expect(parsed).toMatchObject({ PHOENIX_SECRET: 'a', PHOENIX_SYSTEM_KEY: 'b', PHOENIX_ADMIN_PASSWORD: 'c' });
    expect(parsed.METABASE_ADMIN_PASSWORD).toMatch(/^[0-9a-f]{24}$/);
    expect(await ensureEnvFile(path)).toEqual({ state: 'unchanged' });
    expect(await readAdminPassword(path)).toBe(parsed.METABASE_ADMIN_PASSWORD);
    expect(await ensureEnvFile(join(dir, 'fresh.env'))).toEqual({ state: 'created' });
  });

  it('refuses a file without the Metabase password', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dmg-env-'));
    const path = join(dir, '.env');
    await writeFile(path, 'PHOENIX_SECRET=a\n', 'utf8');
    await expect(readAdminPassword(path)).rejects.toThrow(/METABASE_ADMIN_PASSWORD is missing/);
    await expect(readAdminPassword(join(dir, 'none.env'))).rejects.toThrow(/pnpm evidence:up/);
  });
});

describe('native queries', () => {
  it('turns :param into {{param}} template tags with defaults, once per name, leaving casts and strings alone', () => {
    const sql = "select :project, uuid_or_null(:project), :run::uuid, 'a:b' as s, x::text from t where :since = 'all'";
    const { query, templateTags } = toNativeQuery(sql, { project: 'all', run: NO_RUN, since: 'all' });
    expect(query).toBe(
      "select {{project}}, uuid_or_null({{project}}), {{run}}::uuid, 'a:b' as s, x::text from t where {{since}} = 'all'",
    );
    expect(Object.keys(templateTags)).toEqual(['project', 'run', 'since']);
    expect(templateTags.project).toEqual({
      id: tagId('project'),
      name: 'project',
      'display-name': 'Project',
      type: 'text',
      default: 'all',
      required: true,
    });
    expect(templateTags.run?.default).toBe(NO_RUN);
  });

  it('gives a tag a stable uuid-shaped id', () => {
    expect(tagId('project')).toBe(tagId('project'));
    expect(tagId('project')).not.toBe(tagId('since'));
    expect(tagId('project')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('refuses a parameter without default and a default without parameter', () => {
    expect(() => toNativeQuery('select :project', {})).toThrow(/No default for parameter :project/);
    expect(() => toNativeQuery('select 1', { project: 'all' })).toThrow(/does not use: project/);
  });

  it('covers every question file, with defaults for exactly its parameters', async () => {
    const files = await listQuestions();
    for (const spec of QUESTIONS) {
      expect(files).toContain(spec.question);
      const sql = await readFile(join(QUESTIONS_DIR, `${spec.question}.sql`), 'utf8');
      expect(() => toNativeQuery(sql, spec.defaults)).not.toThrow();
    }
    // The seven rows of spec §15.3, in order, make the dashboard.
    expect(QUESTIONS.filter((q) => q.onDashboard).map((q) => q.question)).toEqual([
      'decision-effort',
      'interaction-time',
      'cache-by-provider',
      'engine-acceptance',
      'interventions',
      'context-budget',
      'engine-reliability',
    ]);
    expect(new Set(QUESTIONS.map((q) => q.name)).size).toBe(QUESTIONS.length);
  });
});

describe('idempotent matching', () => {
  it('finds an item by name ignoring whitespace and archived copies, the oldest first', () => {
    const items = [
      { id: 9, name: DASHBOARD_NAME },
      { id: 3, name: `${DASHBOARD_NAME}  `, archived: true },
      { id: 5, name: 'DEMIURGO  ·  primer cuadro' },
      { id: 7, name: 'Other' },
    ];
    expect(byName(items, DASHBOARD_NAME)?.id).toBe(5);
    expect(byName(items, 'Other')?.id).toBe(7);
    expect(byName(items, 'Missing')).toBeUndefined();
    expect(byName([], DASHBOARD_NAME)).toBeUndefined();
  });

  it('lays the cards two per row on the grid, the odd last one full width', () => {
    const layout = dashboardLayout(7);
    expect(layout).toHaveLength(7);
    expect(layout[0]).toEqual({ row: 0, col: 0, size_x: GRID_WIDTH / 2, size_y: 6 });
    expect(layout[1]).toEqual({ row: 0, col: GRID_WIDTH / 2, size_x: GRID_WIDTH / 2, size_y: 6 });
    expect(layout[2]).toMatchObject({ row: 6, col: 0 });
    expect(layout[6]).toEqual({ row: 18, col: 0, size_x: GRID_WIDTH, size_y: 6 });
    expect(dashboardLayout(2).every((p) => p.size_x === GRID_WIDTH / 2)).toBe(true);
    expect(dashboardLayout(0)).toEqual([]);
  });

  it('keeps the dashcard of a card already on the dashboard, adds new ones with negative ids and drops the rest', () => {
    const existing = [
      { id: 41, card_id: 100 },
      { id: 42, card_id: 999 }, // a card no longer wanted
      { id: 43, card_id: 102 },
    ];
    const planned = planDashcards([100, 101, 102], existing);
    expect(planned.map((d) => [d.id, d.card_id])).toEqual([
      [41, 100],
      [-1, 101],
      [43, 102],
    ]);
    expect(planned.map((d) => d.id)).not.toContain(42);
    expect(planned[1]).toMatchObject({ row: 0, col: GRID_WIDTH / 2, parameter_mappings: [], visualization_settings: {} });
    // Re-planning over what Metabase would return after saving changes nothing.
    const saved = planned.map((d, i) => ({ id: d.id < 0 ? 50 + i : d.id, card_id: d.card_id }));
    expect(planDashcards([100, 101, 102], saved).map((d) => d.id)).toEqual([41, 51, 43]);
  });
});
