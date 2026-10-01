// Engine marks (salud-del-harness §9.3): the cohort key, the CLI version lookup, the cut by cohort and the engine
// that a finding's evidence names. Pure parts only.

import { describe, expect, it } from 'vitest';
import { buildEngineMark, cliVersionOf, engineCohortKey, engineMarkOf, majorMinor, parseCliVersion, resetCliVersionCache, selectEngineCohort } from '../src/harness/engine.ts';
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
