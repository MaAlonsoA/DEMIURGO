import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { type AttentionData, AttentionView, type StageAttention, type WorthItData, WorthItView } from '../../src/screens/observability/HarnessHealth.tsx';

const stat = (median: number | null) => ({ n: median === null ? 0 : 3, median, p90: median, max: median });
const stage = (key: string, extra: Partial<StageAttention> = {}): StageAttention => ({
  stage: key,
  questions: { raised: 0, answered: 0, discarded: 0, pending: 0, led_to_version: 0, led_to_version_proxy: 0, seconds_to_answer: stat(null) },
  proposals: { accepted: 0, rejected: 0, edited: 0, pending: 0, superseded: 0, seconds_to_decide: stat(null) },
  batches: { resolved: 0, whole_accepted: 0, timed: 0, timed_from_shown: 0, seconds_per_item: stat(null) },
  cost: { runs: 0, input_tokens: 0, output_tokens: 0, usd: 0, artefacts: 0, tokens_per_artefact: null, usd_per_artefact: null },
  person_minutes_proxy: 0,
  ...extra,
});

const attention: AttentionData = {
  stages: [
    stage('definition', {
      questions: { raised: 25, answered: 24, discarded: 0, pending: 1, led_to_version: 20, led_to_version_proxy: 22, seconds_to_answer: stat(22) },
      proposals: { accepted: 8, rejected: 1, edited: 0, pending: 0, superseded: 0, seconds_to_decide: stat(60) },
      cost: { runs: 4, input_tokens: 1_500_000, output_tokens: 500_000, usd: 1.5, artefacts: 4, tokens_per_artefact: 500_000, usd_per_artefact: 0.375 },
      person_minutes_proxy: 45,
    }),
    stage('tasks', {
      proposals: { accepted: 10, rejected: 2, edited: 1, pending: 0, superseded: 0, seconds_to_decide: stat(30) },
      batches: { resolved: 2, whole_accepted: 1, timed: 2, timed_from_shown: 1, seconds_per_item: stat(90) },
    }),
    stage('security'),
  ],
  person: { buckets_minutes: 500, session_minutes: 446, sessions: 26 },
};

describe('AttentionView', () => {
  const html = renderToStaticMarkup(<AttentionView data={attention} />);
  it('renders a row per stage that has data, named in words, and hides empty stages', () => {
    expect(html).toContain('data-stage="definition"');
    expect(html).toContain('Definition');
    expect(html).toContain('data-stage="tasks"');
    expect(html).not.toContain('data-stage="security"');
  });
  it('shows counts, times, tokens and the proxy marked as convention', () => {
    expect(html).toContain('22 s');
    expect(html).toContain('90 s');
    expect(html).toContain('2M');
    expect(html).toContain('$1.5');
    expect(html).toContain('Our convention');
    expect(html).toContain('500');
  });
});

describe('WorthItView', () => {
  const worth: WorthItData = {
    value: { merged_tasks: 43, criteria_verified: 1800, records_approved: { task: 600 }, records_approved_total: 779 },
    cost: {
      design: { runs_without_usage: 1 },
      reviewer: { runs_without_usage: 0 },
      builder: { steps_without_usage: 80 },
      tokens: 12_000_000,
      usd: 54,
      ci: { runs: 86, minutes: 400 },
      person_minutes: { buckets_minutes: 500 },
      patches: { count: null, source: 'not_derivable' },
    },
    units: { tokens_per_merged_task: 279_000, usd_per_merged_task: 1.26, usd_per_verified_criterion: 0.03, person_minutes_per_merged_task: 11.63, patches_per_merged_task: null },
  };
  it('lists value, cost and units, says patches are not derivable and counts runs without usage', () => {
    const html = renderToStaticMarkup(<WorthItView data={worth} />);
    expect(html).toContain('Merged tasks');
    expect(html).toContain('43');
    expect(html).toContain('Not derivable per project');
    expect(html).toContain('$1.26');
    expect(html).toContain('81 runs or steps reported no usage');
    expect(html).toContain('Per unit delivered');
  });
  it('shows the patch count when the caller supplied it', () => {
    const html = renderToStaticMarkup(<WorthItView data={{ ...worth, cost: { ...worth.cost, patches: { count: 279, source: 'parameter' } }, units: { ...worth.units, patches_per_merged_task: 6.49 } }} />);
    expect(html).toContain('279');
    expect(html).toContain('6.49');
    expect(html).not.toContain('Not derivable per project');
  });
});
