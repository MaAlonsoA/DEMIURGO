// Harness health query (salud-del-harness §1.2): the verdict is «no data» under 10 decisions, the thresholds
// (precision 0.7 / 0.5, recall 0.5) are applied, and the scorecards read the latest post-mortem of each request.

import { human } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { type FindingClass, type FindingFact, findingsToCsv, harnessFindingRows, harnessScorecards, scorecardsOf, verdictOf } from '../src/queries/harness-health.ts';
import { useEnvironment } from './support/env.ts';

const fact = (cls: FindingClass, extra: Partial<FindingFact> = {}): FindingFact => ({ piece: 'B01', class: cls, ground_truth: null, value: null, unit: null, ...extra });
const many = (cls: FindingClass, n: number, extra: Partial<FindingFact> = {}) => Array.from({ length: n }, () => fact(cls, extra));
const verdict = (facts: FindingFact[]) => scorecardsOf(facts)[0]!.verdict;

describe('verdict by §1.2', () => {
  it('is «no data» under 10 decisions, however good they look', () => {
    expect(verdict(many('tp', 9))).toBe('no_data');
    expect(verdict([...many('tp', 5), ...many('info', 20)])).toBe('no_data');
    expect(verdict(many('tp', 10))).toBe('helps');
  });

  it('applies the precision and recall thresholds', () => {
    // precision 7/10 = 0.7 and recall 7/10: helps (boundaries are inclusive)
    expect(verdict([...many('tp', 7), ...many('fp', 3), ...many('fn', 3)])).toBe('helps');
    // precision 0.6: neither helps nor hurts
    expect(verdict([...many('tp', 6), ...many('fp', 4)])).toBe('neutral');
    // precision 0.4 (< 0.5): hurts
    expect(verdict([...many('tp', 4), ...many('fp', 6)])).toBe('hurts');
    // precision 1 but recall 0.4 (< 0.5): not enough to help
    expect(verdict([...many('tp', 4), ...many('fn', 6)])).toBe('neutral');
    // precision exactly 0.5 does not hurt
    expect(verdict([...many('tp', 5), ...many('fp', 5), ...many('fn', 2)])).toBe('neutral');
  });

  it('cost alone never hurts; a single harmful FN does not hurt below 10 cases; a harmful rate does', () => {
    // Cost without any TP (B03 of the validation): not a classification, not «hurts».
    expect(verdict(many('cost', 10, { unit: 'min', value: 2 }))).toBe('no_data');
    expect(verdict([...many('tn', 20), ...many('cost', 4, { unit: 'min', value: 2 })])).toBe('no_data');
    // One harmful FN among 23 escape decisions (B17 after the fix): 4 %, not above the rate.
    const rare = [...many('tn', 22, { ground_truth: 'G03' }), ...many('fn', 1, { ground_truth: 'G03' })];
    expect(verdict(rare)).toBe('helps'); // only the escape rate is measured, and it is low
    expect(scorecardsOf(rare)[0]!.rules[0]).toMatchObject({ escape_rate: 1 / 23, verdict: 'helps' });
    // The same single FN with no sample behind it never hurts.
    expect(verdict([...many('tn', 3, { ground_truth: 'G03' }), ...many('fn', 1, { ground_truth: 'G03' })])).toBe('no_data');
    // A harmful rate of 30 % over 10 decisions hurts.
    expect(verdict([...many('tn', 7, { ground_truth: 'G03' }), ...many('fn', 3, { ground_truth: 'G03' })])).toBe('hurts');
    // 16 decisions with no harmful ground truth (B02: schema rule, one FN of G13): nothing measured, no verdict
    expect(verdict([...many('tn', 15, { ground_truth: 'G13' }), ...many('fn', 1, { ground_truth: 'G13' }), fact('tp'), fact('fp')])).toBe('no_data');
    // A harmless FN (G01) is not an escape.
    expect(verdict([...many('tp', 9), ...many('fn', 1, { ground_truth: 'G01' }), ...many('cost', 1, { unit: 'min', value: 1 })])).toBe('helps');
  });

  it('counts only classification decisions in n; benefit, cost and info rows are not decisions', () => {
    const [card] = scorecardsOf([...many('tp', 3), ...many('benefit', 40, { unit: 'files', value: 1 }), ...many('cost', 40, { unit: 'tokens', value: 1 }), ...many('info', 5)]);
    expect(card).toMatchObject({ n: 3, verdict: 'no_data' });
  });

  it('measures per rule, never mixing the rules of a piece (B17: comments and escapes)', () => {
    const comments = [...many('tp', 9, { finding: 'review.finding_outcome' }), ...many('fp', 1, { finding: 'review.finding_outcome' })];
    const escapes = [...many('tn', 21, { finding: 'review.escape', ground_truth: 'G03' }), ...many('fn', 1, { finding: 'review.escape', ground_truth: 'G03' })];
    const cost = many('cost', 30, { finding: 'review.cost', unit: 'tokens', value: 1000 });
    const [card] = scorecardsOf([...comments, ...escapes, ...cost].map((f) => ({ ...f, piece: 'B17' })));
    expect(card).toMatchObject({ main_rule: 'review.finding_outcome', precision: 0.9, recall: 1, n: 32, verdict: 'helps' });
    const escape = card!.rules.find((r) => r.finding === 'review.escape')!;
    // The escape rule has no TP: its precision and recall are null / 0 of itself, not the comments' 90 %.
    expect(escape).toMatchObject({ precision: null, n: 22 });
  });

  it('shows a precision only with TP + FP > 0 and a recall only with TP + FN > 0 (B03 «precision 0 %» was a recall)', () => {
    const [card] = scorecardsOf(many('fn', 3, { finding: 'queue.parallel_conflict' }).concat(many('tn', 295, { finding: 'queue.parallel_conflict' })));
    expect(card).toMatchObject({ precision: null, main_rule: null });
    expect(card!.rules[0]).toMatchObject({ precision: null, recall: 0 });
  });

  it('the verdict of a piece is its worst rule', () => {
    const good = many('tp', 12, { finding: 'a.good' });
    const bad = [...many('tp', 3, { finding: 'a.bad' }), ...many('fp', 9, { finding: 'a.bad' })];
    expect(verdict([...good, ...bad])).toBe('hurts');
  });

  it('needs the benefit to beat the cost in a shared unit', () => {
    const base = many('tp', 10);
    expect(verdict([...base, fact('benefit', { unit: 'ci_runs', value: 5 }), fact('cost', { unit: 'ci_runs', value: 2 })])).toBe('helps');
    expect(verdict([...base, fact('benefit', { unit: 'ci_runs', value: 2 }), fact('cost', { unit: 'ci_runs', value: 5 })])).toBe('neutral');
    // different units are not compared
    expect(verdict([...base, fact('benefit', { unit: 'ci_runs', value: 1 }), fact('cost', { unit: 'min', value: 5 })])).toBe('helps');
  });

  it('sums values per unit and counts per class', () => {
    const [card] = scorecardsOf([fact('benefit', { unit: 'min', value: 3 }), fact('benefit', { unit: 'min', value: 4 }), fact('cost', { unit: 'tokens', value: 100 }), fact('tp'), fact('fn')]);
    expect(card).toMatchObject({ benefit: { min: 7 }, cost: { tokens: 100 }, counts: { tp: 1, fn: 1, benefit: 2, cost: 1 }, n: 2, precision: 1, recall: 0.5 });
    expect(verdictOf({ ...card!, n: 3 })).toBe('no_data');
    expect(verdictOf({ ...card!, n: 12 })).toBe('no_data'); // 1 positive: no measure has 10 cases behind it
  });
});

describe('scorecards over stored post-mortems', () => {
  const environment = useEnvironment();
  const ana = human('ana');

  async function task(name: string) {
    const s = environment().services;
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name } });
    const made = await executeCommand(s, {
      command: 'record.create',
      actor: ana,
      projectId,
      data: {
        type: 'fdr',
        domain: 'hhq',
        title: `Feature ${name}`,
        sections: [
          { title: 'Goal', content: 'A goal.' },
          { title: 'Scope', content: 'Scope.' },
          { title: 'Out of scope', content: 'Nothing.' },
          { title: 'Behavior', content: '1. It works.' },
        ],
        criteria: [{ carry: 'new', title: 'One', statement: 'Given a, when b, then c.', verification: 'automatic', check: 'A test.' }],
      },
    });
    const requestId = (
      await s.db
        .insertInto('build_requests')
        .values({ project_id: projectId, task_id: made.entityId, task_version_id: (made.result as { versionId: string }).versionId, feature_version_id: null, brief: 'b', requested_by: 'human:ana' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    return { projectId, requestId };
  }

  async function postmortem(p: { projectId: string; requestId: string }, rules: string, hash: string, findings: { piece: string; class: FindingClass; attempt?: number; value?: number; unit?: 'min' }[]) {
    const s = environment().services;
    const pm = await s.db
      .insertInto('harness_postmortems')
      .values({ project_id: p.projectId, build_request_id: p.requestId, rules_version: rules, inputs_hash: hash, attempts: 1, outcome: 'merged', findings: findings.length })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const f of findings) {
      await s.db
        .insertInto('harness_findings')
        .values({ project_id: p.projectId, postmortem_id: pm.id, build_request_id: p.requestId, attempt: f.attempt ?? 1, piece: f.piece, finding: `${f.piece}.x`, class: f.class, value: f.value ?? null, unit: f.unit ?? null, evidence: JSON.stringify({}) })
        .execute();
    }
  }

  it('reads the latest post-mortem of each request and the newest rules version, with cases and links data', async () => {
    const p = await task('Cards');
    // Older post-mortem of the same request and rules (superseded by the later one) and an older rules version.
    await postmortem(p, 'pm-1', 'h1', [{ piece: 'B01', class: 'fp' }]);
    await new Promise((r) => setTimeout(r, 5));
    await postmortem(p, 'pm-1', 'h2', [
      { piece: 'B01', class: 'tp' },
      { piece: 'B01', class: 'tp', attempt: 2 },
      { piece: 'B02', class: 'cost', value: 4, unit: 'min' },
      { piece: 'B24', class: 'info', value: 2 },
    ]);
    const health = await harnessScorecards(environment().services.db, p.projectId);
    expect(health.rules_version).toBe('pm-1');
    expect(health.requests).toBe(1);
    const b01 = health.pieces.find((x) => x.piece === 'B01')!;
    expect(b01).toMatchObject({ n: 2, verdict: 'no_data', precision: 1, cases_total: 2 });
    expect(b01.cases.map((c) => c.attempt).sort()).toEqual([1, 2]);
    expect(b01.cases[0]).toMatchObject({ build_request_id: p.requestId, task_code: expect.stringMatching(/^[A-Z]{3}-/) });
    expect(health.pieces.find((x) => x.piece === 'B02')).toMatchObject({ cost: { min: 4 }, verdict: 'no_data' });
    // `info` counts nowhere as a decision and is not a case
    expect(health.pieces.find((x) => x.piece === 'B24')).toMatchObject({ n: 0, cases_total: 0 });

    // A newer rules version wins by default; the old one can be asked for.
    await postmortem(p, 'pm-2', 'h3', [{ piece: 'B03', class: 'tn' }]);
    expect((await harnessScorecards(environment().services.db, p.projectId)).pieces.map((x) => x.piece)).toEqual(['B03']);
    expect((await harnessScorecards(environment().services.db, p.projectId, { rules: 'pm-1' })).pieces.length).toBe(3);
    const rows = await harnessFindingRows(environment().services.db, p.projectId, { rules: 'pm-1', piece: 'B01' });
    expect(rows.rows).toHaveLength(2);
    const csv = findingsToCsv(rows.rows);
    expect(csv.split('\r\n')[0]).toContain('task_code,attempt,piece');
    expect(csv.split('\r\n')).toHaveLength(4);
  });
});
