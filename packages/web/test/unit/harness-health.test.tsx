import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// A router link rendered as a plain anchor with its target and search, so the test needs no router.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, search, children, ...rest }: { to: string; params: Record<string, string>; search?: Record<string, string | number>; children: unknown } & Record<string, unknown>) => {
    const path = Object.entries(params).reduce((p, [k, v]) => p.replace(`$${k}`, v), to);
    const q = search ? `?${new URLSearchParams(Object.entries(search).map(([k, v]) => [k, String(v)])).toString()}` : '';
    return (
      <a href={`${path}${q}`} {...rest}>
        {children as never}
      </a>
    );
  },
}));

import { type HarnessHealthData, HarnessHealthView } from '../../src/screens/observability/HarnessHealth.tsx';
import { selectionFromSearch } from '../../src/screens/build/timelineLogic.ts';

const data: HarnessHealthData = {
  rules_version: 'pm-1',
  requests: 3,
  pieces: [
    { piece: 'B01', verdict: 'helps', n: 12, precision: 0.75, recall: 0.6, benefit: { ci_runs: 5 }, cost: { ci_runs: 2 }, cases_total: 1, cases: [
      { finding_id: 'f1', piece: 'B01', finding: 'queue.skip', class: 'tp', ground_truth: 'G01', value: 1, unit: 'ci_runs', subject: 'a.ts', attempt: 2, build_request_id: 'req-1', task_code: 'TSK-AAA-001', pr_url: 'https://example.test/pr/1' },
    ] },
    { piece: 'B02', verdict: 'hurts', n: 10, precision: 0.3, recall: null, benefit: {}, cost: { min: 8 }, cases_total: 0, cases: [] },
    { piece: 'B03', verdict: 'no_data', n: 2, precision: null, recall: null, benefit: {}, cost: {}, cases_total: 0, cases: [] },
  ],
};

describe('HarnessHealthView', () => {
  it('renders one row per piece with its verdict and measures', () => {
    const html = renderToStaticMarkup(<HarnessHealthView projectId="p1" data={data} />);
    expect(html).toMatch(/data-piece="B01" data-verdict="helps"/);
    expect(html).toMatch(/data-piece="B02" data-verdict="hurts"/);
    expect(html).toMatch(/data-piece="B03" data-verdict="no_data"/);
    expect(html).toContain('Helps');
    expect(html).toContain('Gets in the way');
    expect(html).toContain('No data');
    expect(html).toContain('75%');
    expect(html).toContain('5 CI runs');
    expect(html).toContain('8 min');
  });

  it('shows an empty note when no piece has data', () => {
    expect(renderToStaticMarkup(<HarnessHealthView projectId="p1" data={{ ...data, pieces: [] }} />)).toContain('No build has a post-mortem yet');
  });

  it('only pieces with cases get an expander (cases are hidden until opened)', () => {
    const html = renderToStaticMarkup(<HarnessHealthView projectId="p1" data={data} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html.match(/aria-expanded/g)).toHaveLength(1);
    expect(html).not.toContain('TSK-AAA-001');
  });
});

describe('opening an attempt from a link', () => {
  const tl = {
    requests: [
      { id: 'r1', task_code: 'TSK-A-1', attempts: [{ n: 1 }, { n: 2 }] },
      { id: 'r2', task_code: 'TSK-A-1', attempts: [{ n: 1 }] },
    ],
  } as never;
  it('picks the request by id, else the latest of the task, and the attempt asked or the last', () => {
    expect(selectionFromSearch(tl, { request: 'r1', attempt: 1 })).toEqual({ request: 'r1', attempt: 1 });
    expect(selectionFromSearch(tl, { request: 'r1' })).toEqual({ request: 'r1', attempt: 2 });
    expect(selectionFromSearch(tl, { task: 'TSK-A-1', attempt: 1 })).toEqual({ request: 'r2', attempt: 1 });
    expect(selectionFromSearch(tl, { task: 'TSK-X-9' })).toBeNull();
    expect(selectionFromSearch(tl, {})).toBeNull();
  });
});
