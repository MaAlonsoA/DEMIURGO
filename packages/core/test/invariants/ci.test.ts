// The GitHub Actions workflow reproduces `pnpm gate:all` across four chained stages.

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Step = { run?: string; uses?: string; with?: Record<string, unknown> };
type Job = { needs?: string; steps: Step[]; services?: { postgres?: { image: string } } };
type Workflow = { jobs: Record<string, Job> };

async function load(): Promise<{ wf: Workflow; scripts: Record<string, string>; gateAll: string[] }> {
  const wf = parse(await readFile('.github/workflows/ci.yml', 'utf8')) as Workflow;
  const root = JSON.parse(await readFile('package.json', 'utf8')) as { scripts: Record<string, string> };
  const gateAll = (root.scripts['gate:all'] ?? '').split('&&').map((c) => c.trim().replace(/^pnpm /, ''));
  return { wf, scripts: root.scripts, gateAll };
}

const commands = (t: Job | undefined): string[] => (t?.steps ?? []).flatMap((p) => (p.run ? [p.run] : []));

/** Position of the first step matching the condition (-1 if none). */
const position = (t: Job | undefined, matches: (p: Step) => boolean): number => (t?.steps ?? []).findIndex(matches);

describe('CI', () => {
  it('AC-ESQ-001-15 the workflow has the types-and-lint, unit, integration-with-Postgres and invariants stages', async () => {
    const { wf } = await load();
    expect(Object.keys(wf.jobs)).toEqual(['types-and-lint', 'unit', 'integration', 'invariants']);
    expect(wf.jobs.unit?.needs).toBe('types-and-lint');
    expect(wf.jobs.integration?.needs).toBe('unit');
    expect(wf.jobs.invariants?.needs).toBe('integration');
    const compose = await readFile('compose.dev.yaml', 'utf8');
    for (const j of ['integration', 'invariants']) {
      const image = wf.jobs[j]?.services?.postgres?.image ?? '';
      expect(image).toMatch(/^postgres:18\.\d+@sha256:[0-9a-f]{64}$/);
      expect(compose).toContain(image);
    }
  });

  it('AC-FMT-001-06 the CI stages run, between them, every gate of pnpm gate:all, including gate:design and gate:traceability', async () => {
    const { wf, gateAll } = await load();
    const all = Object.values(wf.jobs).flatMap(commands).join('\n');
    expect(gateAll).toEqual(expect.arrayContaining(['gate:design', 'gate:test', 'gate:invariants', 'gate:traceability']));
    expect(gateAll.at(-1)).toBe('gate:traceability');
    const expected = gateAll.flatMap((gate) =>
      gate === 'gate:test' ? ['vitest run --project unit', 'vitest run --project integration'] : [`pnpm ${gate}`],
    );
    const missing = expected.filter((command) => !all.includes(command));
    expect(missing).toEqual([]);
  });

  it('AC-FMT-001-06 each test stage leaves its JUnit report and the invariants stage computes traceability with all of them', async () => {
    const { wf, scripts } = await load();
    expect(scripts['gate:test']).toContain('--outputFile.junit=reports/junit-tests.xml');
    expect(scripts['gate:invariants']).toContain('--outputFile.junit=reports/junit-invariants.xml');
    expect(scripts['gate:traceability']).toBe('node packages/design/src/cli.ts traceability');
    for (const [job, report] of [
      ['unit', 'reports/junit-unit.xml'],
      ['integration', 'reports/junit-integration.xml'],
    ] as const) {
      const t = wf.jobs[job];
      const test = position(t, (p) => p.run?.includes(`--reporter=junit --outputFile.junit=${report}`) ?? false);
      const upload = position(t, (p) => p.uses === 'actions/upload-artifact@v4' && p.with?.path === report);
      expect(test, `${job} writes ${report}`).toBeGreaterThanOrEqual(0);
      expect(upload, `${job} uploads ${report}`).toBeGreaterThan(test);
    }
    const inv = wf.jobs.invariants;
    const invariants = position(inv, (p) => p.run === 'pnpm gate:invariants');
    const download = position(inv, (p) => p.uses === 'actions/download-artifact@v4' && p.with?.path === 'reports');
    const trace = position(inv, (p) => p.run === 'pnpm gate:traceability');
    expect(invariants).toBeGreaterThanOrEqual(0);
    expect(download).toBeGreaterThan(invariants);
    expect(trace).toBeGreaterThan(download);
    expect(inv?.steps[download]?.with).toMatchObject({ pattern: 'junit-*', 'merge-multiple': true });
  });
});
