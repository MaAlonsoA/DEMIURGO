import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IDEA_FINDINGS, VERDICTS } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import { createSimulatedClassifier } from '../src/classifier/simulated.ts';
import { evaluateClassifier } from '../src/knowledge/evaluate.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment();

describe('classifier evaluation', () => {
  it('AC-CON-001-11 records precision and recall by verdict and by finding in a file and in the table', async () => {
    const output = await mkdtemp(join(tmpdir(), 'dmg-eval-'));
    try {
      const report = await evaluateClassifier({
        classifier: createSimulatedClassifier(),
        partition: 'test',
        db: environment().services.db,
        output,
      });
      expect(report.verdicts.total).toBeGreaterThanOrEqual(30);
      expect(report.ideas.total).toBeGreaterThanOrEqual(20);
      for (const v of VERDICTS) {
        expect(report.verdicts.byClass[v]).toMatchObject({ precision: expect.any(Number), recall: expect.any(Number) });
      }
      for (const h of IDEA_FINDINGS) expect(report.ideas.byClass[h]).toHaveProperty('recall');
      const file = JSON.parse(await readFile(report.file ?? '', 'utf8')) as { verdicts: { accuracy: number } };
      expect(file.verdicts.accuracy).toBe(report.verdicts.accuracy);
      const rows = await environment()
        .services.db.selectFrom('classifier_evaluations')
        .selectAll()
        .where('classifier', '=', 'simulated@1')
        .execute();
      expect(rows.map((f) => f.task).sort()).toEqual(['ideas', 'verdicts']);
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  });

  it('AC-CLA-001-02 the simulator gives the same response for the same input', async () => {
    const a = await evaluateClassifier({ classifier: createSimulatedClassifier(), partition: 'dev' });
    const b = await evaluateClassifier({ classifier: createSimulatedClassifier(), partition: 'dev' });
    expect(b.responses).toEqual(a.responses);
  });
});
