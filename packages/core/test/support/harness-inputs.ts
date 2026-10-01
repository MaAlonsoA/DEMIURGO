// Synthetic post-mortem inputs for the pure rule tests: no database, a fixed base time.

import type { PostmortemInputs } from '../../src/harness/postmortem.ts';

export const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
export const at = (minute: number): Date => new Date(T0 + minute * 60_000);

type Step = PostmortemInputs['steps'][number];

let n = 0;
export const uid = (prefix: string): string => `${prefix}-${++n}`;

export function step(requestId: string, attempt: number, stage: string, outcome: string, detail: unknown, minute: number): Step {
  return { id: uid('step'), project_id: 'p', build_request_id: requestId, attempt, stage, outcome, detail: detail ?? null, created_at: at(minute) } as unknown as Step;
}

/** A merged request: repo started at minute 0, commit and merge steps with the given real files. */
export function mergedSteps(requestId: string, files: string[], opts: { start?: number; end?: number; footprintAsString?: boolean; added?: string[] } = {}): Step[] {
  const start = opts.start ?? 0;
  const end = opts.end ?? start + 20;
  const footprint = { merge_commit: 'abc', files: files.map((path) => ({ path, additions: 1, deletions: 0, status: opts.added?.includes(path) ? 'added' : 'modified' })) };
  return [
    step(requestId, 1, 'repo', 'started', null, start),
    step(requestId, 1, 'commit', 'ok', { files }, start + 10),
    step(requestId, 1, 'merge', 'ok', { footprint: opts.footprintAsString ? JSON.stringify(footprint) : footprint }, end),
  ];
}

export function inputs(over: Partial<PostmortemInputs> & { id?: string; taskCode?: string; technical?: boolean } = {}): PostmortemInputs {
  const id = over.id ?? uid('req');
  const { id: _i, technical, ...rest } = over;
  return {
    request: {
      id,
      project_id: 'p',
      task_id: 't',
      task_version_id: 'tv',
      feature_version_id: technical ? null : 'fv',
      brief: '',
      requested_by: 'human:ana',
      requested_at: at(-5),
      state: 'done',
      head_sha: null,
    } as unknown as PostmortemInputs['request'],
    taskCode: 'TSK-A-001',
    steps: [],
    reviews: [],
    codeOpinions: [],
    layersOpinion: null,
    testRuns: [],
    ...rest,
  };
}
