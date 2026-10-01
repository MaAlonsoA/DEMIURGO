import { describe, expect, it } from 'vitest';
import { blockingCriterionFindings, lintCriteria } from '../src/criterion-lint.ts';

const ac = (code: string, statement: string, verification = 'automatic') => ({ code, verification, statement });

describe('lintCriteria', () => {
  it('flags the Comidas criteria that escaped (statistical and real-network budgets marked automatic)', () => {
    const texts = [
      [
        'AC-MEA-002-12',
        'With five years of meal records on a mobile connection, the day view loads within 2 seconds in 95 % of the cases.',
      ],
      ['AC-MEA-005-10', 'Suggest foods answers within 2 seconds in 95 % of requests with five years of meal records.'],
      ['AC-WOR-002-12', 'Adding or correcting a set takes less than 1 second on a mobile connection, for 95 % of the sets.'],
    ] as const;
    for (const [code, text] of texts) {
      const f = lintCriteria([ac(code, text)]);
      expect(f.map((x) => x.kind)).toContain('needs_deployed_candidate');
      expect(f[0]?.criterion_code).toBe(code);
      expect(f[0]?.evidence).not.toBe('');
    }
  });

  it('flags real-environment wording and Spanish population wording', () => {
    expect(lintCriteria([ac('AC-X-001-01', 'Cold start of the app shows the home screen.')])).toHaveLength(1);
    expect(lintCriteria([ac('AC-X-001-02', 'Funciona en un dispositivo real.')])).toHaveLength(1);
    expect(lintCriteria([ac('AC-X-001-03', 'Responde en el 95 % de las solicitudes.')])).toHaveLength(1);
  });

  it('does not flag a plain timeout or a criterion already marked release or manual', () => {
    expect(lintCriteria([ac('AC-X-001-04', 'The request fails within 2 seconds when the server does not answer.')])).toEqual([]);
    expect(lintCriteria([ac('AC-X-001-05', 'On a mobile connection it loads in 95 % of the cases.', 'release')])).toEqual([]);
    expect(lintCriteria([ac('AC-X-001-06', 'On a mobile connection it loads.', 'manual')])).toEqual([]);
  });

  it('does not flag ordinary percentages or plain statements', () => {
    expect(lintCriteria([ac('AC-X-001-07', 'The total shows a 10 % discount.')])).toEqual([]);
    expect(
      lintCriteria([ac('AC-X-001-08', 'Given a new member, when they submit the form, then they see the confirmation.')]),
    ).toEqual([]);
  });

  it('returns the cited codes of other features and ignores its own', () => {
    const f = lintCriteria([
      ac(
        'AC-MEA-004-05',
        'With a saved workout from FDR-WOR-005 and EPC-WOR-001, calories burned show 400 kcal; see FDR-MEA-004.',
        'manual',
      ),
    ]);
    expect(
      f
        .filter((x) => x.kind === 'depends_on_unbuilt_feature')
        .map((x) => x.evidence)
        .sort(),
    ).toEqual(['EPC-WOR-001', 'FDR-WOR-005']);
  });

  it('only needs_deployed_candidate blocks approval', () => {
    const f = lintCriteria([
      ac('AC-AAA-001-01', 'Loads on a mobile connection.'),
      ac('AC-AAA-001-02', 'Uses FDR-BBB-001.', 'manual'),
    ]);
    expect(blockingCriterionFindings(f).map((x) => x.criterion_code)).toEqual(['AC-AAA-001-01']);
  });
});
