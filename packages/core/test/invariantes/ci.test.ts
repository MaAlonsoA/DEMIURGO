// El workflow de GitHub Actions reproduce `pnpm gate:all` en cuatro etapas encadenadas.

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Paso = { run?: string };
type Trabajo = { needs?: string; steps: Paso[]; services?: { postgres?: { image: string } } };
type Workflow = { jobs: Record<string, Trabajo> };

async function cargar(): Promise<{ wf: Workflow; gateAll: string[] }> {
  const wf = parse(await readFile('.github/workflows/ci.yml', 'utf8')) as Workflow;
  const raiz = JSON.parse(await readFile('package.json', 'utf8')) as { scripts: Record<string, string> };
  const gateAll = (raiz.scripts['gate:all'] ?? '').split('&&').map((c) => c.trim().replace(/^pnpm /, ''));
  return { wf, gateAll };
}

const ordenes = (t: Trabajo | undefined): string[] => (t?.steps ?? []).flatMap((p) => (p.run ? [p.run] : []));

describe('CI', () => {
  it('AC-ESQ-001-15 el workflow tiene las etapas tipos y lint, unitarias, integración con Postgres e invariantes', async () => {
    const { wf } = await cargar();
    expect(Object.keys(wf.jobs)).toEqual(['tipos-y-lint', 'unitarias', 'integracion', 'invariantes']);
    expect(wf.jobs.unitarias?.needs).toBe('tipos-y-lint');
    expect(wf.jobs.integracion?.needs).toBe('unitarias');
    expect(wf.jobs.invariantes?.needs).toBe('integracion');
    const compose = await readFile('compose.dev.yaml', 'utf8');
    for (const j of ['integracion', 'invariantes']) {
      const imagen = wf.jobs[j]?.services?.postgres?.image ?? '';
      expect(imagen).toMatch(/^postgres:18\.\d+@sha256:[0-9a-f]{64}$/);
      expect(compose).toContain(imagen);
    }
  });

  it('AC-FMT-001-06 las etapas de la CI cubren todo pnpm gate:all, incluido el validador de design/', async () => {
    const { wf, gateAll } = await cargar();
    const todas = Object.values(wf.jobs).flatMap(ordenes).join('\n');
    expect(gateAll).toContain('gate:design');
    const esperadas = gateAll.flatMap((gate) =>
      gate === 'gate:test' ? ['vitest run --project unitarias', 'vitest run --project integracion'] : [`pnpm ${gate}`],
    );
    const faltan = esperadas.filter((orden) => !todas.includes(orden));
    expect(faltan).toEqual([]);
  });
});
