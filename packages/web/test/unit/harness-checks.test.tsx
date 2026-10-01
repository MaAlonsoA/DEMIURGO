import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { type HarnessChecksData, HarnessChecksView } from '../../src/screens/observability/HarnessChecks.tsx';
import { type HarnessHealthData, HarnessHealthView, pieceText } from '../../src/screens/observability/HarnessHealth.tsx';

const check = (id: string, over: Partial<HarnessChecksData['checks'][number]> = {}): HarnessChecksData['checks'][number] => ({
  id,
  window_from: '2026-09-24T10:00:00.000Z',
  window_to: '2026-10-01T10:00:00.000Z',
  trigger: 'schedule',
  rules_version: 'pm-1',
  regressions: [],
  escapes: { new_total: 0, by_rule: {} },
  computed_at: '2026-10-01T10:00:00.000Z',
  ...over,
});

describe('HarnessChecksView', () => {
  it('says so when there is no check yet', () => {
    expect(renderToStaticMarkup(<HarnessChecksView data={{ total: 0, latest: null, checks: [] }} />)).toContain('No check yet');
  });

  it('shows the latest check with its regressions and new escapes', () => {
    const latest = check('c2', {
      trigger: 'merges',
      regressions: [
        { kind: 'verdict_worse', piece: 'B01', before: 'helps', after: 'hurts', threshold: null },
        { kind: 'cost_per_task_up', unit: 'usd_per_merged_task', before: 1, after: 1.4, threshold: 0.25 },
      ],
      escapes: { new_total: 3, by_rule: { E01: 2, E03: 1 } },
    });
    const html = renderToStaticMarkup(<HarnessChecksView data={{ total: 2, latest, checks: [latest, check('c1', { regressions: [], escapes: { new_total: 5 } })] }} />);
    expect(html).toContain('data-check="c2"');
    expect(html).toContain('After 5 merged tasks');
    expect(html).toMatch(/data-regression="verdict_worse"/);
    expect(html).toContain('B01');
    expect(html).toContain('helps');
    expect(html).toContain('hurts');
    expect(html).toMatch(/data-regression="cost_per_task_up"/);
    expect(html).toContain('3 new escapes');
    expect(html).toContain('E01 ×2, E03 ×1');
    expect(html).toContain('href="#harness-escapes"');
    // the earlier check is in the series, the latest is not repeated there
    expect(html).toContain('data-check-row="c1"');
    expect(html).not.toContain('data-check-row="c2"');
  });

  it('shows no regression table when there are none', () => {
    const latest = check('c1');
    const html = renderToStaticMarkup(<HarnessChecksView data={{ total: 1, latest, checks: [latest] }} />);
    expect(html).toContain('data-no-regressions');
    expect(html).toContain('No new escapes');
    expect(html).not.toContain('data-regression=');
  });
});

describe('piece names in the scorecard rows', () => {
  const data: HarnessHealthData = {
    rules_version: 'pm-1',
    requests: 1,
    pieces: [
      { piece: 'B03', name: 'Queue: hotspots and modules', verdict: 'helps', n: 12, precision: 0.8, recall: 0.6, benefit: {}, cost: {}, cases_total: 0, cases: [] },
      { piece: 'B99', name: null, verdict: 'no_data', n: 0, precision: null, recall: null, benefit: {}, cost: {}, cases_total: 0, cases: [] },
    ],
  };

  it('shows the code and the name, or the bare code without a name', () => {
    expect(pieceText({ piece: 'B03', name: 'Queue: hotspots and modules' })).toBe('B03 · Queue: hotspots and modules');
    expect(pieceText({ piece: 'B99', name: null })).toBe('B99');
    const html = renderToStaticMarkup(<HarnessHealthView projectId="p1" data={data} />);
    expect(html).toContain('>B03<');
    expect(html).toContain('Queue: hotspots and modules');
    expect(html).toContain('>B99<');
  });
});
