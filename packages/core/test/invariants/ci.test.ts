// El workflow de GitHub Actions reproduce `pnpm gate:all` en cuatro etapas encadenadas.

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Paso = { run?: string; uses?: string; with?: Record<string, unknown> };
type Trabajo = { needs?: string; steps: Paso[]; services?: { postgres?: { image: string } } };
type Workflow = { jobs: Record<string, Trabajo> };

async function cargar(): Promise<{ wf: Workflow; scripts: Record<string, string>; gateAll: string[] }> {
  const wf = parse(await readFile('.github/workflows/ci.yml', 'utf8')) as Workflow;
  const raiz = JSON.parse(await readFile('package.json', 'utf8')) as { scripts: Record<string, string> };
  const gateAll = (raiz.scripts['gate:all'] ?? '').split('&&').map((c) => c.trim().replace(/^pnpm /, ''));
  return { wf, scripts: raiz.scripts, gateAll };
}

const ordenes = (t: Trabajo | undefined): string[] => (t?.steps ?? []).flatMap((p) => (p.run ? [p.run] : []));

/** Posición del primer paso que cumple la condición (-1 si no hay ninguno). */
const posicion = (t: Trabajo | undefined, cumple: (p: Paso) => boolean): number => (t?.steps ?? []).findIndex(cumple);

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

  it('AC-FMT-001-06 las etapas de la CI ejecutan, entre todas, cada gate de pnpm gate:all, incluidos gate:design y gate:trazabilidad', async () => {
    const { wf, gateAll } = await cargar();
    const todas = Object.values(wf.jobs).flatMap(ordenes).join('\n');
    expect(gateAll).toEqual(expect.arrayContaining(['gate:design', 'gate:test', 'gate:invariantes', 'gate:trazabilidad']));
    expect(gateAll.at(-1)).toBe('gate:trazabilidad');
    const esperadas = gateAll.flatMap((gate) =>
      gate === 'gate:test' ? ['vitest run --project unitarias', 'vitest run --project integracion'] : [`pnpm ${gate}`],
    );
    const faltan = esperadas.filter((orden) => !todas.includes(orden));
    expect(faltan).toEqual([]);
  });

  it('AC-FMT-001-06 cada etapa de pruebas deja su informe JUnit y la de invariantes calcula la trazabilidad con todos', async () => {
    const { wf, scripts } = await cargar();
    expect(scripts['gate:test']).toContain('--outputFile.junit=reports/junit-pruebas.xml');
    expect(scripts['gate:invariantes']).toContain('--outputFile.junit=reports/junit-invariantes.xml');
    expect(scripts['gate:trazabilidad']).toBe('node packages/design/src/cli.ts trazabilidad');
    for (const [trabajo, informe] of [
      ['unitarias', 'reports/junit-unitarias.xml'],
      ['integracion', 'reports/junit-integracion.xml'],
    ] as const) {
      const t = wf.jobs[trabajo];
      const prueba = posicion(t, (p) => p.run?.includes(`--reporter=junit --outputFile.junit=${informe}`) ?? false);
      const subida = posicion(t, (p) => p.uses === 'actions/upload-artifact@v4' && p.with?.path === informe);
      expect(prueba, `${trabajo} escribe ${informe}`).toBeGreaterThanOrEqual(0);
      expect(subida, `${trabajo} sube ${informe}`).toBeGreaterThan(prueba);
    }
    const inv = wf.jobs.invariantes;
    const invariantes = posicion(inv, (p) => p.run === 'pnpm gate:invariantes');
    const descarga = posicion(inv, (p) => p.uses === 'actions/download-artifact@v4' && p.with?.path === 'reports');
    const traza = posicion(inv, (p) => p.run === 'pnpm gate:trazabilidad');
    expect(invariantes).toBeGreaterThanOrEqual(0);
    expect(descarga).toBeGreaterThan(invariantes);
    expect(traza).toBeGreaterThan(descarga);
    expect(inv?.steps[descarga]?.with).toMatchObject({ pattern: 'junit-*', 'merge-multiple': true });
  });
});
