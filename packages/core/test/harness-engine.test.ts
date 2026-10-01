// Engine marks (salud-del-harness §9.3): the cohort key, the CLI version lookup, the cut by cohort and the engine
// that a finding's evidence names. Pure parts only.

import { describe, expect, it } from 'vitest';
import { buildEngineMark, cliVersionOf, cohortLabel, cohortNormalizer, engineCohortKey, engineMarkOf, majorMinor, parseCliVersion, resetCliVersionCache, selectEngineCohort } from '../src/harness/engine.ts';
import { engineOfFinding, withEngineEvidence } from '../src/harness/postmortem.ts';
import { engineCohortOfEvidence } from '../src/queries/harness-health.ts';
import { claudeInitModelOf, claudeInitVersionOf, usageCollector } from '../src/runner/builder-usage.ts';

describe('engine cohort', () => {
  it('parses the version a CLI prints and keeps major.minor', () => {
    expect(parseCliVersion('2.1.4 (Claude Code)\n')).toBe('2.1.4');
    expect(parseCliVersion('codex-cli 0.46.0')).toBe('0.46.0');
    expect(parseCliVersion('nothing')).toBeNull();
    expect(majorMinor('2.1.4')).toBe('2.1');
    expect(majorMinor(null)).toBeNull();
  });

  it('keys by provider, model (the reported one wins) and major.minor, so patch releases share a cohort', () => {
    const a = buildEngineMark({ provider: 'claude', model: 'sonnet', modelReported: 'claude-sonnet-5-5', cliVersion: '2.1.4' });
    const b = buildEngineMark({ provider: 'claude', model: 'sonnet', modelReported: 'claude-sonnet-5-5', cliVersion: '2.1.9' });
    const c = buildEngineMark({ provider: 'claude', model: 'sonnet', modelReported: 'claude-sonnet-5-5', cliVersion: '2.2.0' });
    expect(engineCohortKey(a)).toBe('claude|claude-sonnet-5-5|2.1');
    expect(engineCohortKey(b)).toBe(engineCohortKey(a));
    expect(engineCohortKey(c)).not.toBe(engineCohortKey(a));
    expect(engineCohortKey({ provider: 'codex', model: 'gpt-5' })).toBe('codex|gpt-5|?');
    expect(engineCohortKey(buildEngineMark({ provider: 'jev', model: 'jev-latest', jevModel: 'jev-2026-09' }))).toBe('jev|jev-2026-09|?');
    expect(engineCohortKey(null)).toBe('unknown');
    expect(engineCohortKey({ provider: 'claude' })).toBe('unknown');
  });

  it('reads a stored mark from an object or a JSON string', () => {
    expect(engineMarkOf(JSON.stringify({ provider: 'codex', model: 'gpt-5', cli_version: '0.46.0' }))?.cli_version).toBe('0.46.0');
    expect(engineMarkOf('not json')).toBeNull();
    expect(engineMarkOf([])).toBeNull();
  });

  it('asks a CLI for its version once per binary and never throws', async () => {
    resetCliVersionCache();
    let calls = 0;
    const run = async () => {
      calls++;
      return '2.1.4 (Claude Code)';
    };
    expect(await cliVersionOf('claude', run)).toBe('2.1.4');
    expect(await cliVersionOf('claude', run)).toBe('2.1.4');
    expect(calls).toBe(1);
    expect(await cliVersionOf('opencode', run)).toBeNull();
    resetCliVersionCache();
    expect(await cliVersionOf('codex', () => Promise.reject(new Error('no binary')))).toBeNull();
    resetCliVersionCache();
  });
});

describe('cut by engine cohort', () => {
  const row = (piece: string, finding: string, engine_cohort: string) => ({ piece, finding, engine_cohort });
  // Newest first, as harnessFindingRows returns them.
  const rows = [row('B20', 'session.outcome', 'claude|m2|2.2'), row('B20', 'session.outcome', 'claude|m1|2.1'), row('B20', 'session.outcome', 'unknown'), row('B05', 'files.prediction', 'unknown'), row('B05', 'files.prediction', 'unknown')];

  it('keeps by default the newest known cohort of each rule and says what it left out', () => {
    const cut = selectEngineCohort(rows);
    expect(cut.rows.map((r) => r.engine_cohort)).toEqual(['claude|m2|2.2', 'unknown', 'unknown']);
    expect(cut.applied).toEqual({ 'B20/session.outcome': 'claude|m2|2.2' });
    expect(cut.excluded).toBe(2);
    expect(cut.available['claude|m1|2.1']).toBe(1);
  });

  it('keeps a rule that reads no engine whole, a named cohort alone, and all on request', () => {
    expect(selectEngineCohort(rows).rows.filter((r) => r.piece === 'B05')).toHaveLength(2);
    expect(selectEngineCohort(rows, 'claude|m1|2.1').rows).toHaveLength(1);
    expect(selectEngineCohort(rows, 'all').rows).toHaveLength(5);
    expect(selectEngineCohort(rows, 'all').excluded).toBe(0);
  });
});

describe('cohort normalisation (pm-8)', () => {
  const marks = [
    { provider: 'claude', model: 'sonnet' }, // before the marks carried more
    { provider: 'claude', model: 'sonnet', model_reported: 'claude-sonnet-5-5' },
    { provider: 'claude', model: 'sonnet', model_reported: 'claude-sonnet-5-5', cli_version: '2.1.4' },
    { provider: 'codex', model: 'gpt-6.1-sol' },
    { provider: 'codex', model: 'gpt-6.1-sol', cli_version: '0.159.3' },
  ];
  it('merges an alias with the model every mark of it reported, and a missing version with the single known one', () => {
    const key = cohortNormalizer(marks);
    expect(new Set(marks.slice(0, 3).map(key))).toEqual(new Set(['claude|claude-sonnet-5-5|2.1']));
    expect(new Set(marks.slice(3).map(key))).toEqual(new Set(['codex|gpt-6.1-sol|0.159']));
    expect(key(null)).toBe('unknown');
    expect(key({ provider: 'claude' })).toBe('unknown');
  });
  it('keeps an alias apart when it reported two models, and a missing version apart when two are known', () => {
    const key = cohortNormalizer([
      { provider: 'claude', model: 'opus', model_reported: 'claude-opus-4', cli_version: '2.0.1' },
      { provider: 'claude', model: 'opus', model_reported: 'claude-opus-5', cli_version: '2.0.1' },
      { provider: 'codex', model: 'm', cli_version: '0.1.0' },
      { provider: 'codex', model: 'm', cli_version: '0.2.0' },
    ]);
    expect(key({ provider: 'claude', model: 'opus' })).toBe('claude|opus|?');
    expect(key({ provider: 'codex', model: 'm' })).toBe('codex|m|?');
    expect(cohortLabel('codex|m|?')).toBe('codex · m · CLI version not recorded');
    expect(cohortLabel('claude|claude-sonnet-5-5|2.1')).toBe('claude · claude-sonnet-5-5 · CLI 2.1');
  });
});

describe('the current cohort is chosen by engine time and needs evidence (pm-8)', () => {
  let n = 0;
  const row = (cohort: string, at: string, request: string, cls = 'tp') => ({ piece: 'B09', finding: 'tdd.gate', engine_cohort: cohort, engine_at: at, class: cls, build_request_id: request, id: n++ });
  const old = (i: number) => row('claude|m1|2.1', `2026-10-01T10:0${i}:00Z`, `r${i}`);
  it('orders by when the engine ran, not by the order of the rows (the recompute of an old request does not change it)', () => {
    // The row of the OLD cohort comes first (it was recomputed last), but it ran before.
    const rows = [row('claude|m1|2.1', '2026-10-01T09:00:00Z', 'a'), row('claude|m2|2.2', '2026-10-01T12:00:00Z', 'b'), row('claude|m2|2.2', '2026-10-01T12:05:00Z', 'c'), row('claude|m2|2.2', '2026-10-01T12:06:00Z', 'd')];
    expect(selectEngineCohort(rows).applied).toEqual({ 'B09/tdd.gate': 'claude|m2|2.2' });
  });
  it('falls back to the newest cohort with 10 decisions or 3 requests, and says which newer one it skipped', () => {
    const rows = [row('claude|m2|2.2', '2026-10-01T12:00:00Z', 'z'), old(1), old(2), old(3)];
    const cut = selectEngineCohort(rows);
    expect(cut.applied).toEqual({ 'B09/tdd.gate': 'claude|m1|2.1' });
    expect(cut.newer_skipped['B09/tdd.gate']).toMatchObject({ cohort: 'claude|m2|2.2', decisions: 1, requests: 1 });
    expect(cut.excluded).toBe(1);
    expect(cut.excluded_by_piece).toEqual({ B09: 1 });
    // 10 decisions of two requests are enough on their own.
    const ten = [...Array.from({ length: 10 }, (_, i) => row('claude|m2|2.2', '2026-10-01T12:00:00Z', i < 5 ? 'x' : 'y')), old(1)];
    expect(selectEngineCohort(ten).applied['B09/tdd.gate']).toBe('claude|m2|2.2');
  });
  it('when no cohort has enough, the newest one is applied', () => {
    const rows = [row('claude|m2|2.2', '2026-10-01T12:00:00Z', 'z'), old(1)];
    expect(selectEngineCohort(rows).applied['B09/tdd.gate']).toBe('claude|m2|2.2');
  });
});

describe('the engine of a finding', () => {
  const inputs = {
    steps: [
      { id: 's1', attempt: 1, stage: 'builder', outcome: 'ok', created_at: new Date(1), detail: { provider: 'claude', model: 'sonnet' } },
      { id: 's2', attempt: 2, stage: 'builder', outcome: 'ok', created_at: new Date(2), detail: { provider: 'claude', model: 'sonnet', engine: { provider: 'claude', model: 'sonnet', model_reported: 'claude-sonnet-5-5', cli_version: '2.1.4' } } },
    ],
    reviews: [{ id: 'r1', run_id: 'run1', created_at: new Date(3) }],
    reviewRuns: [{ id: 'run1', provider: 'codex', requested_model: 'gpt-5', model: 'gpt-5', engine: null }],
    layersOpinion: { classifier_id: 'jev@jev-2026-09' },
  } as never;
  const f = (finding: string, attempt: number | null, evidence: unknown = { a: 1 }) => ({ piece: 'B01', finding, class: 'info' as const, attempt, evidence });

  it('names the builder of the attempt, the reviewer and Jev by the family of the rule', () => {
    expect(engineCohortOfEvidence(withEngineEvidence(inputs, [f('tdd.gate', 2)])[0]?.evidence)).toBe('claude|claude-sonnet-5-5|2.1');
    expect(engineCohortOfEvidence(withEngineEvidence(inputs, [f('tdd.gate', 1)])[0]?.evidence)).toBe('claude|sonnet|?');
    expect(engineCohortOfEvidence(withEngineEvidence(inputs, [f('review.cost', null)])[0]?.evidence)).toBe('codex|gpt-5|?');
    expect(engineOfFinding(inputs, f('schema.prediction', null))?.provider).toBe('jev');
  });

  it('leaves alone a rule that reads no engine, array evidence and evidence that already has one', () => {
    expect(withEngineEvidence(inputs, [f('files.prediction', 1)])[0]?.evidence).toEqual({ a: 1 });
    expect(withEngineEvidence(inputs, [f('tdd.gate', 1, ['x'])])[0]?.evidence).toEqual(['x']);
    expect(withEngineEvidence(inputs, [f('tdd.gate', 1, { engine: 'mine' })])[0]?.evidence).toEqual({ engine: 'mine' });
  });
});

describe('the builder stream', () => {
  const init = JSON.stringify({ type: 'system', subtype: 'init', claude_code_version: '2.1.4', model: 'claude-sonnet-5-5' });
  it('reads the version and model Claude announces in init', () => {
    expect(claudeInitVersionOf(init)).toBe('2.1.4');
    expect(claudeInitModelOf(init)).toBe('claude-sonnet-5-5');
    expect(claudeInitVersionOf('{"type":"assistant"}')).toBeUndefined();
    const c = usageCollector('claude');
    c.add(`${init}\n{"type":"assistant"}\n`);
    expect(c.cliVersion()).toBe('2.1.4');
    expect(c.modelReported()).toBe('claude-sonnet-5-5');
    expect(usageCollector('codex').cliVersion()).toBeUndefined();
  });
});
