import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ForensicStepView, forensicStepOf } from '../../src/screens/build/ForensicStep.tsx';
import type { ForensicAnalysis, TaskForensic } from '../../src/screens/lessons/types.ts';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, hash, children, ...rest }: { to: string; params: Record<string, string>; hash?: string; children: unknown } & Record<string, unknown>) => (
    <a href={`${Object.entries(params).reduce((p, [k, v]) => p.replace(`$${k}`, v), to)}${hash ? `#${hash}` : ''}`} {...rest}>
      {children as never}
    </a>
  ),
}));

const analysis = { outcome: 'rework' } as ForensicAnalysis;
const forensic = (over: Partial<TaskForensic>): TaskForensic => ({ id: 'f1', task_version_id: 'v1', created_at: '2026-10-02T10:00:00Z', catalog_version: 'c', agent_version: 'a', analysis, ...over });
const request = { id: 'r1', running: false, end: '2026-10-02T09:00:00Z' };

describe('Forensic analysis step of a build request', () => {
  it('shows nothing while the request runs', () => {
    expect(forensicStepOf({ ...request, running: true }, [forensic({ request_ids: ['r1'] })])).toBeNull();
    expect(renderToStaticMarkup(<ForensicStepView projectId="p1" taskCode="TSK-1" state={null} />)).toBe('');
  });

  it('is pending when the request ended and no analysis came from it', () => {
    const state = forensicStepOf(request, [forensic({ request_ids: ['other'], created_at: '2026-10-02T08:00:00Z' })]);
    expect(state).toEqual({ kind: 'pending' });
    expect(renderToStaticMarkup(<ForensicStepView projectId="p1" taskCode="TSK-1" state={state} />)).toContain('data-forensic-step="pending"');
  });

  it('is done when the trigger or the covered requests include it, with a link to the lessons anchor', () => {
    const byTrigger = forensicStepOf(request, [forensic({ id: 'a', trigger_request_id: 'r1' }), forensic({ id: 'b', request_ids: ['r1'] })]);
    expect(byTrigger).toMatchObject({ kind: 'done', forensic: { id: 'a' } });
    const byCovered = forensicStepOf(request, [forensic({ request_ids: ['r1'], created_at: '2026-10-02T08:00:00Z' })]);
    expect(byCovered).toMatchObject({ kind: 'done' });
    const html = renderToStaticMarkup(<ForensicStepView projectId="p1" taskCode="TSK-1" state={byTrigger} />);
    expect(html).toContain('data-forensic-step="done"');
    expect(html).toContain('Done · Rework');
    expect(html).toContain('href="/p/p1/records/TSK-1#lessons-learned"');
  });

  it('falls back on the first analysis written after the request ended', () => {
    expect(forensicStepOf(request, [forensic({ created_at: '2026-10-02T09:30:00Z' })])).toMatchObject({ kind: 'done' });
  });
});
