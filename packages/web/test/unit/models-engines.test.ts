import { describe, expect, it } from 'vitest';
import type { Catalog } from '../../src/api/models.ts';
import { type RunProgress, progressText } from '../../src/api/progress.ts';
import {
  agentOrder,
  agentSection,
  changeWords,
  choosableProviders,
  effortsOf,
  engineLabel,
  failureKindsText,
  firstEngine,
  formatTokens,
  resolutionLine,
  withModel,
  withProvider,
} from '../../src/screens/models/engines.ts';

const catalog = (provider: string, label: string, models: Catalog['models'], ready = true): Catalog => ({
  provider,
  label,
  installed: true,
  version: '1',
  ready,
  message: ready ? null : `${label} isn't signed in.`,
  sessions: provider !== 'opencode',
  models,
  discoveredAt: '2026-09-25T10:00:00Z',
});

const CATALOGS: Catalog[] = [
  catalog('opencode', 'OpenCode', [
    { id: 'qwen-local/qwen3.8-27b', label: 'Qwen3.8-27B', efforts: ['high', 'medium', 'low'], defaultEffort: 'high' },
  ]),
  catalog('codex', 'Codex', [
    { id: 'gpt-6-sol', label: 'GPT-6-Sol', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    { id: 'gpt-6-luna', label: 'GPT-6-Luna', efforts: ['low', 'medium'], defaultEffort: 'medium' },
  ]),
  catalog(
    'claude',
    'Claude',
    [{ id: 'opus', label: 'Opus (latest)', efforts: ['low', 'high', 'max'], defaultEffort: null }],
    false,
  ),
  catalog('simulated', 'Simulated', [{ id: 'simulated', label: 'Simulated', efforts: [], defaultEffort: null }]),
];

describe('choosing an engine', () => {
  it('AC-AGE-002-02 only discovered providers with models can be chosen, in a fixed order', () => {
    const empty = catalog('claude', 'Claude', []);
    expect(choosableProviders([...CATALOGS, { ...empty, provider: 'other' }]).map((c) => c.provider)).toEqual([
      'claude',
      'codex',
      'opencode',
      'simulated',
    ]);
  });

  it('AC-AGE-002-02 the efforts offered are those of the chosen model', () => {
    expect(effortsOf(CATALOGS, 'codex', 'gpt-6-luna')).toEqual(['low', 'medium']);
    expect(effortsOf(CATALOGS, 'codex', 'nope')).toEqual([]);
  });

  it('AC-AGE-002-02 switching provider takes its first model and that model default effort', () => {
    expect(firstEngine(CATALOGS, 'codex')).toEqual({ provider: 'codex', model: 'gpt-6-sol', effort: 'medium' });
    // A model with efforts always takes one: without a declared default, medium if offered, else the first.
    expect(firstEngine(CATALOGS, 'claude')).toEqual({ provider: 'claude', model: 'opus', effort: 'low' });
    expect(firstEngine(CATALOGS, 'simulated')).toEqual({ provider: 'simulated', model: 'simulated', effort: null });
    expect(withProvider(CATALOGS, 'opencode')).toEqual({ provider: 'opencode', model: 'qwen-local/qwen3.8-27b', effort: 'high' });
  });

  it('AC-AGE-002-02 switching model keeps the effort only if the new model offers it', () => {
    const sol = { provider: 'codex', model: 'gpt-6-sol', effort: 'high' };
    expect(withModel(CATALOGS, sol, 'gpt-6-luna')).toEqual({ provider: 'codex', model: 'gpt-6-luna', effort: 'medium' });
    expect(withModel(CATALOGS, { ...sol, effort: 'low' }, 'gpt-6-luna').effort).toBe('low');
  });

  it('names an engine with the labels discovery gave', () => {
    expect(engineLabel({ provider: 'codex', model: 'gpt-6-sol', effort: 'high' }, CATALOGS)).toBe('Codex · GPT-6-Sol · high');
    expect(engineLabel({ provider: 'claude', model: 'opus', effort: null }, CATALOGS)).toBe('Claude · Opus (latest)');
    expect(engineLabel({ provider: 'gone', model: 'x', effort: null }, CATALOGS)).toBe('gone · x');
  });

  it('AC-AGE-002-03 AC-AGE-002-08 says what runs the agent and where it comes from, or what the person has to do', () => {
    const sol = { provider: 'codex', model: 'gpt-6-sol', effort: 'high' };
    expect(resolutionLine({ status: 'ok', source: 'group', ...sol }, CATALOGS)).toEqual({
      tone: 'ok',
      text: 'Codex · GPT-6-Sol · high (from its group)',
    });
    expect(resolutionLine({ status: 'ok', source: 'agent', ...sol }, CATALOGS).text).toBe(
      'Codex · GPT-6-Sol · high (its own model)',
    );
    expect(resolutionLine({ status: 'unassigned' }, CATALOGS)).toEqual({
      tone: 'problem',
      text: 'No model: DEMIURGO cannot run it.',
    });
    expect(
      resolutionLine(
        {
          status: 'unavailable',
          source: 'group',
          reason: 'gpt-6-sol is no longer offered by Codex.',
          provider: 'codex',
          model: 'gpt-6-sol',
          effort: null,
        },
        CATALOGS,
      ),
    ).toEqual({ tone: 'problem', text: 'gpt-6-sol is no longer offered by Codex.' });
  });

  it('orders the agents as the product uses them', () => {
    expect(
      ['echo', 'knowledge_classifier', 'designer', 'onboarding', 'explorer', 'knowledge_reviewer'].toSorted(agentOrder),
    ).toEqual(['onboarding', 'explorer', 'designer', 'knowledge_classifier', 'knowledge_reviewer', 'echo']);
  });

  it('formats token counts', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(1240)).toBe('1,240');
    expect(formatTokens(1_250_000)).toBe('1.25M');
  });
});

describe('saying what changed', () => {
  it('AC-AGE-002-02 a change of engine is said in words once it applies, of a group or of one task', () => {
    const sol = { provider: 'codex', model: 'gpt-6-sol', effort: 'medium' };
    expect(changeWords('Deep thinking', { kind: 'group', engine: sol }, CATALOGS)).toBe(
      'Deep thinking now uses Codex · GPT-6-Sol · medium.',
    );
    expect(changeWords('Deep thinking', { kind: 'group', engine: null }, CATALOGS)).toBe('Deep thinking has no engine now.');
    expect(changeWords('Explorer', { kind: 'agent', engine: sol }, CATALOGS)).toBe(
      "Explorer now uses Codex · GPT-6-Sol · medium instead of its group's.",
    );
    expect(changeWords('Explorer', { kind: 'agent', engine: null }, CATALOGS)).toBe('Explorer follows its group again.');
  });

  it('AC-AGE-002-02 names a part of DEMIURGO as the agents table does, and every failure kind in words', () => {
    const agents = [{ id: 'knowledge_classifier', section: 'Knowledge classifier' }];
    expect(agentSection('knowledge_classifier', agents)).toBe('Knowledge classifier');
    expect(agentSection('unknown_agent', agents)).toBe('unknown_agent');
    expect(agentSection('explorer', undefined)).toBe('explorer');
    expect(failureKindsText({ invalid_output: 2, stale_knowledge: 1, timeout: 0 })).toBe('2 invalid output, 1 stale knowledge');
    expect(failureKindsText({})).toBe('');
  });
});

describe('live progress', () => {
  it('AC-AGE-002-10 says what the provider is doing, what it has written and for how long', () => {
    const p: RunProgress = {
      run_id: 'r',
      call_id: 'c',
      provider: 'codex',
      model: 'gpt-6-sol',
      started_at: '2026-09-25T10:00:00Z',
      events: 4,
      tokens: 1240,
      last_kind: 'thinking',
    };
    expect(progressText(p, Date.parse('2026-09-25T10:00:12Z'))).toBe('Thinking… 1,240 tokens · 0:12');
    expect(progressText({ ...p, tokens: null, last_kind: 'started' }, Date.parse('2026-09-25T10:01:05Z'))).toBe('Starting… 1:05');
  });
});
