import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ForensicDot, LaneForensicMarkView, forensicStepOf } from '../../src/screens/build/ForensicStep.tsx';
import type { ForensicAnalysis, TaskForensic } from '../../src/screens/lessons/types.ts';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, hash, children, ...rest }: { to: string; params: Record<string, string>; hash?: string; children: unknown } & Record<string, unknown>) => (
    <a href={`${Object.entries(params).reduce((p, [k, v]) => p.replace(`$${k}`, v), to)}${hash ? `#${hash}` : ''}`} {...rest}>
      {children as never}
    </a>
  ),
}));

const forensic = { id: 'f1', task_version_id: 'v1', created_at: '2026-10-02T10:00:00Z', catalog_version: 'c', agent_version: 'a', analysis: { outcome: 'rework' } as ForensicAnalysis, request_ids: ['r1'] } as TaskForensic;
const request = { id: 'r1', running: false, end: '2026-10-02T09:00:00Z' };
const mark = (state: ReturnType<typeof forensicStepOf>) =>
  renderToStaticMarkup(<LaneForensicMarkView projectId="p1" taskCode="TSK-1" state={state} doneLabel="Forensic analysis done" pendingLabel="Forensic analysis pending" />);

describe('Lanes forensic marker', () => {
  it('links to the lessons learned when the analysis is done', () => {
    const html = mark(forensicStepOf(request, [forensic]));
    expect(html).toContain('data-lane-forensic="done"');
    expect(html).toContain('href="/p/p1/records/TSK-1#lessons-learned"');
  });

  it('is pending when the request ended without an analysis', () => {
    const html = mark(forensicStepOf(request, []));
    expect(html).toContain('data-lane-forensic="pending"');
    expect(html).toContain('Forensic analysis pending');
  });

  it('shows nothing while the request runs', () => {
    expect(mark(forensicStepOf({ ...request, running: true }, [forensic]))).toBe('');
  });

  it('draws a filled dot for done and a hollow one for pending', () => {
    expect(renderToStaticMarkup(<ForensicDot kind="done" />)).toContain('bg-fg-2');
    expect(renderToStaticMarkup(<ForensicDot kind="pending" />)).toContain('border-edge-control');
  });
});
