// The code map of a repository (build/code-map.ts): symbols, tables, routes, import edges, ranking,
// the render budget and the section of the builder brief.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCodeMap, codeMapLines, moduleOverlap, rankCodeMap, renderCodeMap, tokenize } from '../src/build/code-map.ts';

const root = mkdtempSync(join(tmpdir(), 'dmg-codemap-'));
const sh = (...a: string[]) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim();
const put = (path: string, content: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};

beforeAll(() => {
  sh('init', '-q', '-b', 'main');
  put('tsconfig.json', '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }');
  put('migrations/0001_meals.sql', '-- meals\nCREATE TABLE meals (\n  id uuid primary key,\n  name text not null,\n  planned_on date,\n  constraint meals_name unique (name)\n);\n');
  put('migrations/0002_cardio.sql', 'ALTER TABLE meals ADD COLUMN calories integer;\nCREATE TABLE IF NOT EXISTS cardio_sessions (id uuid, minutes int);\n');
  put('src/lib/meal-plan.ts', 'export interface MealPlan { days: number }\nexport function planMeals(days: number, diet: string): MealPlan {\n  return { days };\n}\nexport const DEFAULT_DAYS = 7;\nfunction hidden() {}\nexport default class Planner {}\n');
  put('src/lib/format.ts', 'export const formatDate = (d: Date): string => d.toISOString();\nexport type Fmt = string;\n');
  put('src/components/MealCard.tsx', "import { planMeals } from '@/lib/meal-plan';\nimport { formatDate } from '../lib/format.js';\nexport function MealCard({ meal }: { meal: string }) {\n  return null;\n}\nexport const Badge = memo(() => null);\n");
  put('src/app/(app)/meals/[id]/page.tsx', "import { MealCard } from '@/components/MealCard';\nexport default function MealPage() {\n  return null;\n}\n");
  put('src/app/api/meals/route.ts', "import { planMeals } from '../../../lib/meal-plan';\nexport async function GET(req: Request) {}\nexport async function POST(req: Request) {}\n");
  put('src/app/actions.ts', "'use server';\nexport async function saveMeal(form: FormData) {}\n");
  put('src/lib/unrelated-billing.ts', 'export function chargeCard(amount: number) {}\n');
  put('test/meal-plan.test.ts', "import { planMeals } from '../src/lib/meal-plan';\nexport const x = 1;\n");
  put('node_modules/dep/index.js', 'export function nope() {}\n');
  put('pnpm-lock.yaml', 'lock');
  sh('add', '-A');
  sh('commit', '-q', '-m', 'init');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('code map', () => {
  it('reads symbols, kinds and signatures, and skips vendored files and lockfiles', async () => {
    const map = await buildCodeMap(root, 'main');
    expect([...map.byPath.keys()].some((p) => p.includes('node_modules') || p.includes('lock'))).toBe(false);
    const plan = map.byPath.get('src/lib/meal-plan.ts')!;
    expect(plan.kind).toBe('lib');
    expect(plan.symbols.map((s) => `${s.kind}:${s.name}:${s.exported}`)).toEqual(
      expect.arrayContaining(['interface:MealPlan:true', 'function:planMeals:true', 'const:DEFAULT_DAYS:true', 'function:hidden:false', 'default:Planner:true']),
    );
    expect(plan.symbols.find((s) => s.name === 'planMeals')?.signature).toBe('planMeals(days: number, diet: string)');
    expect(map.byPath.get('src/lib/format.ts')!.symbols.find((s) => s.name === 'formatDate')).toMatchObject({ kind: 'function', signature: 'formatDate(d: Date)' });
    const card = map.byPath.get('src/components/MealCard.tsx')!;
    expect(card.kind).toBe('component');
    expect(card.symbols.map((s) => `${s.kind}:${s.name}`)).toEqual(expect.arrayContaining(['component:MealCard', 'component:Badge']));
    expect(map.byPath.get('src/app/actions.ts')!.kind).toBe('server_action');
    expect(map.byPath.get('test/meal-plan.test.ts')!.kind).toBe('test');
  });

  it('reads tables and added columns from migrations', async () => {
    const map = await buildCodeMap(root, 'main');
    expect(map.tables.get('meals')!.columns).toEqual(['id uuid', 'name text', 'planned_on date', 'calories integer']);
    expect(map.tables.get('meals')!.files).toEqual(['migrations/0001_meals.sql', 'migrations/0002_cardio.sql']);
    expect(map.tables.get('cardio_sessions')!.columns).toEqual(['id uuid', 'minutes int']);
    expect(map.modules.get('table:meals')).toEqual(['migrations/0001_meals.sql', 'migrations/0002_cardio.sql']);
  });

  it('records routes of pages and API routes from the path', async () => {
    const map = await buildCodeMap(root, 'main');
    expect(map.byPath.get('src/app/(app)/meals/[id]/page.tsx')).toMatchObject({ kind: 'page', route: '/meals/[id]' });
    const route = map.byPath.get('src/app/api/meals/route.ts')!;
    expect(route).toMatchObject({ kind: 'route', route: '/api/meals' });
    expect(route.symbols.map((s) => s.name)).toEqual(['GET', 'POST']);
  });

  it('resolves imports between repository files: relative, js-for-ts and alias', async () => {
    const map = await buildCodeMap(root, 'main');
    expect(map.byPath.get('src/components/MealCard.tsx')!.imports.sort()).toEqual(['src/lib/format.ts', 'src/lib/meal-plan.ts']);
    expect(map.byPath.get('src/app/(app)/meals/[id]/page.tsx')!.imports).toEqual(['src/components/MealCard.tsx']);
    expect(map.byPath.get('src/app/api/meals/route.ts')!.imports).toEqual(['src/lib/meal-plan.ts']);
    expect(map.edges).toContainEqual(['src/components/MealCard.tsx', 'src/lib/meal-plan.ts']);
  });

  it('caches by commit sha', async () => {
    expect(await buildCodeMap(root, 'main')).toBe(await buildCodeMap(root, 'HEAD'));
  });

  it('ranks the files of a task first, with plural stems and a footprint boost, and leaves tests out', async () => {
    expect(tokenize('planMeals meal_plan')).toEqual(['plan', 'meal', 'meal', 'plan']);
    const map = await buildCodeMap(root, 'main');
    const ranked = rankCodeMap(map, 'Plan the meals of a week');
    const paths = ranked.map((r) => r.file.path);
    expect(paths[0]).toBe('src/lib/meal-plan.ts');
    expect(paths.slice(0, 3)).toContain('src/components/MealCard.tsx');
    expect(paths).not.toContain('test/meal-plan.test.ts');
    expect(paths.indexOf('src/lib/unrelated-billing.ts')).toBe(-1);
    expect(ranked[0]!.symbols.map((s) => s.name)).toContain('planMeals');
    const boosted = rankCodeMap(map, 'charge', { footprintFiles: ['src/lib/format.ts'] }).map((r) => r.file.path);
    expect(boosted.indexOf('src/lib/format.ts')).toBeGreaterThanOrEqual(0);
    expect(rankCodeMap(map, 'meals', { limit: 2 })).toHaveLength(2);
    expect(rankCodeMap(map, 'meals')).toEqual(rankCodeMap(map, 'meals'));
  });

  it('renders path then indented symbols within the budget', async () => {
    const map = await buildCodeMap(root, 'main');
    const ranked = rankCodeMap(map, 'meals calories planned');
    const text = renderCodeMap(ranked, 4000);
    expect(text).toContain('src/lib/meal-plan.ts\n  interface MealPlan');
    expect(text).toContain('  planMeals(days: number, diet: string)');
    expect(text).toContain('  table meals(id uuid, name text, planned_on date, calories integer)');
    expect(text).toContain('src/app/api/meals/route.ts [route /api/meals]');
    for (const budget of [30, 120, 400]) expect(renderCodeMap(ranked, budget).length).toBeLessThanOrEqual(budget);
    expect(renderCodeMap(ranked, 10)).toBe('');
  });

  it('is empty without a repository or a main branch', async () => {
    expect(await codeMapLines(null, 'meals', [])).toEqual([]);
    expect(await codeMapLines(join(root, 'missing'), 'meals', [])).toEqual([]);
    expect(await codeMapLines(root, 'meals', [])).not.toEqual([]);
  });

  it('shows the modules two file sets share', async () => {
    const map = await buildCodeMap(root, 'main');
    const overlap = moduleOverlap(
      ['migrations/0001_meals.sql', 'src/lib/format.ts', 'test/meal-plan.test.ts'],
      ['migrations/0002_cardio.sql', 'src/lib/meal-plan.ts', 'test/meal-plan.test.ts'],
      map,
    );
    expect(overlap.modules).toEqual(['lib:src/lib', 'table:meals']);
    expect(overlap.files).toEqual(['test/meal-plan.test.ts']);
    expect(moduleOverlap(['src/lib/format.ts'], ['src/app/api/meals/route.ts'], map)).toEqual({ files: [], modules: [] });
  });
});
