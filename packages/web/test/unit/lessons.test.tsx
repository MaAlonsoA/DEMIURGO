import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { KnownErrorDetailView, KnownErrorsView } from '../../src/screens/lessons/KnownErrors.tsx';
import { LESSONS } from '../../src/screens/lessons/lessons.i18n.ts';
import { LessonsView } from '../../src/screens/lessons/LessonsTab.tsx';
import { TaskLessonsView } from '../../src/screens/lessons/TaskLessons.tsx';
import type { ForensicAnalysis, ForensicsOverview, KnownErrorDetail, KnownErrorEntry, KnownErrorsOverview, TaskForensics } from '../../src/screens/lessons/types.ts';

// A router link rendered as a plain anchor, so the test needs no router.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, children, ...rest }: { to: string; params: Record<string, string>; children: unknown } & Record<string, unknown>) => (
    <a href={Object.entries(params).reduce((p, [k, v]) => p.replace(`$${k}`, v), to)} {...rest}>
      {children as never}
    </a>
  ),
}));

const analysis: ForensicAnalysis = {
  summary: 'The builder needed two attempts.',
  outcome: 'rework',
  timeline: [],
  went_well: [{ what: 'Tests were written first.', evidence: 'step 3' }],
  went_wrong: [{ what: 'The screen check failed.', evidence: 'attempt 1', phase: 'P9', error_class: 'E09', cost: { attempts: 2, minutes: 12 } }],
  root_causes: [{ cause: 'The prompt omitted the file list.', dimension: 'prompt', where: 'agent:builder', why: 'No context', evidence: 'attempt 1' }],
  improvements: [{ change: 'List the files in the prompt.', dimension: 'prompt', target: 'agent:builder', expected_effect: 'Fewer retries', source: 'convención nuestra', priority: 'high', playbook_class: 'E09' }],
  lessons: ['Always list the files.'],
  checklist: [
    { piece_id: 'agent:builder', involved: 'yes', verdict: 'contributed_to_error', note: 'Missed the files', evidence: 'attempt 1' },
    { piece_id: 'piece:B07', involved: 'yes', verdict: 'worked', note: 'Predicted files', evidence: '' },
    { piece_id: 'guard:ownership', involved: 'no', verdict: 'not_applicable', note: 'Not used', evidence: '' },
  ],
};

const task: TaskForensics = {
  task: { id: 't1', code: 'TSK-AAA-001' },
  forensics: [
    { id: 'f2', task_version_id: 'v1', created_at: '2026-10-02T10:00:00Z', catalog_version: 'c1', agent_version: 'a1', analysis },
    { id: 'f1', task_version_id: 'v1', created_at: '2026-10-01T10:00:00Z', catalog_version: 'c1', agent_version: 'a1', analysis: { ...analysis, summary: 'Older analysis.' } },
  ],
};

const overview: ForensicsOverview = {
  catalog_version: 'c1',
  catalog_excluded_tasks: [],
  tasks: [{ code: 'TSK-AAA-001', task_id: 't1', analyzed_at: '2026-10-02T10:00:00Z', outcome: 'rework', summary: 'Two attempts.', counts: { went_wrong: 1, root_causes: 1, improvements: 1 } }],
  by_class: [{ class: 'E09', occurrences: 3, tasks: 1, attempts: 2, minutes: 12, usd: 0.5, improvements: 1, playbook_version: 1 }],
  by_dimension: [{ dimension: 'prompt', root_causes: 1, improvements: 1, tasks: 1 }],
  improvements: [{ target: 'agent:builder', dimension: 'prompt', playbook_class: 'E09', change: 'List the files in the prompt.', expected_effect: 'Fewer retries', source: 'convención nuestra', priority: 'high', frequency: 1, score: 3, tasks: ['TSK-AAA-001'] }],
  by_piece: [{ piece_id: 'agent:builder', involved: 1, worked: 0, contributed_to_error: 1, could_have_prevented: 0, missing: 0, not_applicable: 0, tasks: 1 }],
  playbooks: [
    {
      class_key: 'E09',
      version: 1,
      title: 'Screen check failures',
      created_at: '2026-10-02T10:00:00Z',
      based_on: ['f2'],
      entry: { class_key: 'E09', title: 'Screen check failures', what_it_is: 'A screen that does not match.', symptoms: ['Red screen check'], detection: 'Rule E09', prevention: [{ dimension: 'prompt', change: 'List files' }], response: 'Rebuild', examples: ['TSK-AAA-001'], sources: ['convención nuestra'] },
    },
  ],
};

describe('Lessons learned views', () => {
  it('renders the latest analysis of a task with the checklist hiding not applicable pieces', () => {
    const html = renderToStaticMarkup(<TaskLessonsView data={task} />);
    expect(html).toContain('data-forensic="f2"');
    expect(html).toContain('The builder needed two attempts.');
    expect(html).toContain('Predicted files');
    expect(html).toContain('data-piece="agent:builder"');
    expect(html).toContain('data-piece="piece:B07"');
    expect(html).not.toContain('data-piece="guard:ownership"');
    expect(html).toContain('Building');
    expect(html).toContain('data-dimension="prompt"');
    expect(html).toContain('<select');
  });

  it('shows the empty state when the task has no analysis', () => {
    const html = renderToStaticMarkup(<TaskLessonsView data={{ task: task.task, forensics: [] }} />);
    expect(html).toContain(LESSONS.en.empty);
  });

  it('renders the aggregate tab', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <LessonsView projectId="p1" data={overview} />
      </QueryClientProvider>,
    );
    for (const topic of ['lessonsClasses', 'lessonsCauses', 'lessonsImprovements', 'lessonsPieces', 'lessonsPlaybooks', 'lessonsTasks']) {
      expect(html).toContain(`data-help-topic="${topic}"`);
    }
    expect(html).toContain('data-playbook="E09"');
    expect(html).toContain('TSK-AAA-001');
    expect(html).toContain('List the files in the prompt.');
  });

  it('shows the known error or the new error of each went-wrong item, with the recurrence why', () => {
    const wrong = analysis.went_wrong[0]!;
    const data: TaskForensics = {
      ...task,
      forensics: [
        {
          ...task.forensics[0]!,
          analysis: {
            ...analysis,
            went_wrong: [
              { ...wrong, known_error: 'KE-001', recurrence_why: 'The fix only covered the stage check.' },
              { ...wrong, what: 'Something unseen.', known_error: null, new_error: { title: 'Stale lockfile' } },
            ],
          },
        },
      ],
    };
    const html = renderToStaticMarkup(<TaskLessonsView data={data} projectId="p1" />);
    expect(html).toContain('href="/p/p1/observability/known-errors/KE-001"');
    expect(html).toContain('The fix only covered the stage check.');
    expect(html).toContain('data-went-wrong-new');
    expect(html).toContain('Stale lockfile');
  });

  it('has the same words in both languages', () => {
    expect(Object.keys(LESSONS.es)).toEqual(Object.keys(LESSONS.en));
  });

  const entry = (over: Partial<KnownErrorEntry> = {}): KnownErrorEntry => ({
    code: 'KE-001',
    version: 1,
    title: 'Builder ignores the file list',
    description: 'The builder edits files outside its list.',
    error_class: 'E09',
    phase: 'P9',
    dimension: 'prompt',
    signature: 'files changed not in predicted list',
    pieces: ['agent:builder', 'piece:B07'],
    status: 'open',
    fix: null,
    origin_project_id: 'p1',
    created_by: 'agent:run:1',
    created_at: '2026-10-01T10:00:00Z',
    ...over,
  });

  it('renders the known-error vault section: counts by status, legend, help and a row per entry', () => {
    const data: KnownErrorsOverview = {
      total: 2,
      by_status: { open: 1, fix_claimed: 0, validated: 0, recurred: 1 },
      entries: [
        { ...entry(), occurrences: 3, last_seen: '2026-10-02T10:00:00Z', after_fix_recurrences: 0, tasks: ['TSK-AAA-001'] },
        { ...entry({ code: 'KE-002', title: 'Stale lockfile', status: 'recurred' }), occurrences: 1, last_seen: null, after_fix_recurrences: 1, tasks: [] },
      ],
    };
    const html = renderToStaticMarkup(<KnownErrorsView projectId="p1" data={data} />);
    expect(html).toContain('data-help-topic="lessonsKnown"');
    for (const k of ['open', 'fix_claimed', 'validated', 'recurred']) expect(html).toContain(`data-status-count="${k}"`);
    expect(html).toContain(LESSONS.en.keLegend('fix_claimed'));
    expect(html).toContain('data-known-error-row="KE-001"');
    expect(html).toContain('href="/p/p1/observability/known-errors/KE-002"');
    expect(html).toContain('Builder ignores the file list');
    expect(html).toContain('href="/p/p1/records/TSK-AAA-001"');
  });

  it('renders the known-error page: signature, pieces, fix history and occurrences', () => {
    const fixed = entry({
      version: 2,
      status: 'recurred',
      fix: { description: 'List files in the prompt.', commits: ['abcdef1234567'], piece_versions: { 'agent:builder': 'v7' }, claimed_at: '2026-10-01T12:00:00Z' },
    });
    const data: KnownErrorDetail = {
      entry: fixed,
      versions: [entry(), fixed],
      occurrences: [
        { id: 'o1', project: { id: 'p1', name: 'Comidas' }, task: { id: 't1', code: 'TSK-AAA-001' }, forensic_id: 'f1', went_wrong_index: 0, occurred_at: '2026-10-01T11:00:00Z', piece_versions: {}, after_fix: false, recurrence_why: null, created_at: '2026-10-01T11:00:00Z', current: true },
        { id: 'o2', project: { id: 'p1', name: 'Comidas' }, task: { id: 't2', code: 'TSK-AAA-002' }, forensic_id: 'f2', went_wrong_index: 1, occurred_at: '2026-10-02T11:00:00Z', piece_versions: {}, after_fix: true, recurrence_why: 'The fix missed the retry path.', created_at: '2026-10-02T11:00:00Z', current: true },
      ],
    };
    const html = renderToStaticMarkup(<KnownErrorDetailView projectId="p1" data={data} />);
    expect(html).toContain('data-known-error-page="KE-001"');
    expect(html).toContain('files changed not in predicted list');
    expect(html).toContain('data-piece="agent:builder"');
    expect(html).toContain('data-version="1"');
    expect(html).toContain('data-version="2"');
    expect(html).toContain('List files in the prompt.');
    expect(html).toContain('abcdef123');
    expect(html).toContain('data-occurrence="o2"');
    expect(html).toContain('data-after-fix="yes"');
    expect(html).toContain('The fix missed the retry path.');
    expect(html).toContain('href="/p/p1/records/TSK-AAA-002"');
  });
});
