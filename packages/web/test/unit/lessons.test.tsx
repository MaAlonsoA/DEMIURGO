import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LESSONS } from '../../src/screens/lessons/lessons.i18n.ts';
import { LessonsView } from '../../src/screens/lessons/LessonsTab.tsx';
import { TaskLessonsView } from '../../src/screens/lessons/TaskLessons.tsx';
import type { ForensicAnalysis, ForensicsOverview, TaskForensics } from '../../src/screens/lessons/types.ts';

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
    const html = renderToStaticMarkup(<LessonsView projectId="p1" data={overview} />);
    for (const topic of ['lessonsClasses', 'lessonsCauses', 'lessonsImprovements', 'lessonsPieces', 'lessonsPlaybooks', 'lessonsTasks']) {
      expect(html).toContain(`data-help-topic="${topic}"`);
    }
    expect(html).toContain('data-playbook="E09"');
    expect(html).toContain('TSK-AAA-001');
    expect(html).toContain('List the files in the prompt.');
  });

  it('has the same words in both languages', () => {
    expect(Object.keys(LESSONS.es)).toEqual(Object.keys(LESSONS.en));
  });
});
