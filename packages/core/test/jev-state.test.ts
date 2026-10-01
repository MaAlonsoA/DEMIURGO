// What Jev is told about the project's repository and how it sizes a task (A/B audit of 01-10-2026):
// the CI sentence and the tables are read deterministically from the repository, and the size is the
// level nearest the expected Score. Pure functions and a fake client; no database, no real call.

import { afterEach, describe, expect, it } from 'vitest';
import type { TypeSafeClient } from '@typesafe-ai/sdk';
import { describeCi, repositoryFrom, tablesFromMigrations } from '../src/classifier/repo-context.ts';
import { SIZE_LEVELS, buildSizeRequest, judgeSize, sizeOfScore } from '../src/classifier/size.ts';

const WORKFLOW = `
name: CI
on: [push, pull_request]
jobs:
  ci:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        ports: ['5432:5432']
    steps:
      - run: pnpm install
      - run: pnpm typecheck
      - run: pnpm build
      - run: pnpm test
      - run: pnpm exec playwright test
`;
const PKG = JSON.stringify({ devDependencies: { vitest: '1.0.0', '@playwright/test': '1', '@axe-core/playwright': '4' } });

describe('describeCi', () => {
  it('names what the workflow and package.json really run, and what CI cannot offer', () => {
    const ci = describeCi(WORKFLOW, PKG, ['e2e/fakes/off.ts']) ?? '';
    expect(ci).toContain('GitHub Actions');
    expect(ci).toContain('ephemeral Postgres 17');
    expect(ci).toContain('Vitest');
    expect(ci).toContain('Playwright end-to-end tests with axe accessibility checks');
    expect(ci).toContain('local fakes');
    expect(ci).toContain('no deployed environment');
    expect(ci).toContain('no person');
  });

  it('claims no fakes or axe that the repository does not show, and gives null for what it does not understand', () => {
    const ci = describeCi(WORKFLOW, JSON.stringify({ devDependencies: { vitest: '1' } }), ['src/a.ts']) ?? '';
    expect(ci).not.toContain('fakes');
    expect(ci).not.toContain('axe');
    expect(describeCi('not: [a workflow', null, [])).toBeNull();
    expect(describeCi('name: x', null, [])).toBeNull();
  });
});

describe('repository reading', () => {
  it('parses tables and columns from CREATE TABLE and ADD COLUMN', () => {
    const tables = tablesFromMigrations([
      'create table food_entries (\n  id uuid primary key,\n  name text not null,\n  constraint x unique (name)\n);',
      'alter table food_entries add column notes text;\ncreate table if not exists goals (\n  id uuid,\n  kcal int\n);',
    ]);
    expect(tables).toEqual([
      { table: 'food_entries', columns: ['id', 'name', 'notes'] },
      { table: 'goals', columns: ['id', 'kcal'] },
    ]);
  });

  it('groups the files by layer and leaves tests out', () => {
    const repo = repositoryFrom(
      ['migrations/0001_init.sql', 'src/server/foods.ts', 'src/server/foods.test.ts', 'src/app/day/page.tsx', 'src/app/foods-actions.ts', 'src/app/api/x/route.ts', 'src/design-system/Button.tsx'],
      [],
    );
    expect(repo.migrations).toEqual(['0001_init.sql']);
    expect(repo.server_modules).toEqual(['src/server/foods.ts']);
    expect(repo.server_actions).toEqual(['src/app/foods-actions.ts']);
    expect(repo.route_handlers).toEqual(['src/app/api/x/route.ts']);
    expect(repo.pages).toEqual(['src/app/day/page.tsx']);
    expect(repo.ui_components).toEqual(['src/design-system/Button.tsx']);
  });
});

describe('size', () => {
  const saved = process.env.TYPESAFE_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = saved;
  });
  const TASK = { title: 'Goals form', goal: 'g', scope: 's', acceptance_criteria: ['Goals are saved.'] };

  it('sends the task as JSON with structured levels', () => {
    const { state, questions } = buildSizeRequest({ task: TASK, repo: null });
    expect(state).toEqual({ task: TASK });
    const q = questions.size as { criteria: { size: string; summary: string; signals: string[] }[] };
    expect(q.criteria).toHaveLength(SIZE_LEVELS.length);
    expect(q.criteria[1]).toMatchObject({ size: 'S', summary: expect.any(String), signals: expect.any(Array) });
  });

  it('adds the repository before the task when it is there', () => {
    const repo = { project_stack: { ci: 'c' }, repository: { migrations: [], database_tables: [], server_modules: [], server_actions: [], route_handlers: [], pages: [], ui_components: [] } };
    const { state } = buildSizeRequest({ task: TASK, repo });
    expect(Object.keys(state)).toEqual(['task', 'project_stack', 'repository_before_task']);
  });

  it('takes the level nearest the expected score, not the most probable one', async () => {
    expect(sizeOfScore(0)).toBe('XS');
    expect(sizeOfScore(1.4)).toBe('S');
    expect(sizeOfScore(1.6)).toBe('M');
    expect(sizeOfScore(9)).toBe('XL');
    expect(sizeOfScore(-1)).toBe('XS');
    const client = {
      systemOne: async () => ({ model: 'jev-test', answers: { size: { type: 'score', score: 2.6, confidence: 0.4, probabilities: { 0: 0.1, 1: 0.1, 2: 0.45, 3: 0.35, 4: 0 } } }, usage: { input_tokens: 7, output_tokens: 0 } }),
    } as unknown as Pick<TypeSafeClient, 'systemOne'>;
    const j = await judgeSize(client, { task: TASK });
    expect(j).toMatchObject({ size: 'L', score: 2.6, confidence: 0.4, input_tokens: 7 });
  });
});
