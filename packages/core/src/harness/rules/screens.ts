// Screen-check rule (salud-del-harness B27, revision against Anthropic's harness §4.5). `builder.screen_check` says, per
// criterion of a task that touches pages, whether the builder looked at the screen before reporting. Everything here is
// «convención nuestra»; the practice is the repository anthropics/cwc-long-running-agents («Opened the resulting
// screenshot or console log with the Read tool») and the article's «would fail to recognize that the feature didn't
// work end-to-end», which do not define a score:
// - The task touches pages when a file of its commits has the kind `page` or `route` (`build/code-map.ts kindOfPath`).
// - The criteria are those the builder steps name: `detail.screens`, the RED checks of the TDD gate and the tests of the
//   build report; with none, the task itself is the subject.
// - A screenshot is listed in `detail.screens: [{criterion, path}]` of a builder step.
// - A blocking UI comment: a `blocking` review comment on a UI file (page, route, component or style) that Jev classified
//   `defect` (`review_finding_kinds`, p >= 0.5); when no classification was loaded, any blocking comment on a UI file.
// Rows (class by criterion): `tp` = screenshot and merged without a blocking UI comment; `fn` = no screenshot and there
// was such a comment; otherwise `info` (a screenshot with a comment, or neither). `builder.screen_check_cost` = minutes
// of the builder steps of the request, once, when any screenshot was listed.

import { kindOfPath } from '../../build/code-map.ts';
import type { PostmortemInputs } from '../postmortem.ts';
import { asArray, asObject, commitFiles, detailOf, numberOf, stepsOf } from './builder-detail.ts';
import type { Finding, Rule } from './index.ts';
import { commentsOf } from './review.ts';

const PIECE = 'B27';
const UI_KINDS = new Set(['page', 'route', 'component', 'style']);
const PAGE_KINDS = new Set(['page', 'route']);

function criteriaOf(inputs: PostmortemInputs, screens: Map<string, string[]>): string[] {
  const set = new Set<string>(screens.keys());
  for (const s of stepsOf(inputs, 'builder')) {
    const d = detailOf(s);
    for (const r of asArray(asObject(d.tdd).red).map(asObject)) if (typeof r.criterion === 'string') set.add(r.criterion);
    for (const t of asArray(asObject(d.report).tests).map(asObject)) if (typeof t.criterion === 'string') set.add(t.criterion);
  }
  return [...set].sort();
}

export const builderScreenCheck: Rule = (inputs) => {
  const files = stepsOf(inputs, 'commit').filter((s) => s.outcome === 'ok').flatMap((s) => commitFiles(s));
  if (!files.some((f) => PAGE_KINDS.has(kindOfPath(f)))) return [];

  const screens = new Map<string, string[]>();
  for (const s of stepsOf(inputs, 'builder')) {
    for (const entry of asArray(detailOf(s).screens).map(asObject)) {
      if (typeof entry.criterion !== 'string' || typeof entry.path !== 'string') continue;
      screens.set(entry.criterion, [...(screens.get(entry.criterion) ?? []), entry.path]);
    }
  }
  const merged = inputs.steps.some((s) => s.stage === 'merge' && s.outcome === 'ok');
  const kinds = inputs.reviewKinds ?? [];
  const blocking: { pr_review: string; comment_index: number; path: string }[] = [];
  for (const review of inputs.reviews) {
    for (const c of commentsOf(review)) {
      if (c.severity !== 'blocking' || !UI_KINDS.has(kindOfPath(c.path))) continue;
      if (kinds.length > 0) {
        const k = kinds.find((x) => x.pr_review_id === review.id && x.comment_index === c.index);
        if (!k || k.category !== 'defect' || k.p < 0.5) continue;
      }
      blocking.push({ pr_review: review.id, comment_index: c.index, path: c.path });
    }
  }

  const subjects = criteriaOf(inputs, screens);
  if (subjects.length === 0) subjects.push(inputs.taskCode);
  const out: Finding[] = subjects.map((criterion): Finding => {
    const shots = screens.get(criterion) ?? [];
    const evidence = { criterion, screenshots: shots, merged, blocking_ui_comments: blocking, classified: kinds.length > 0 };
    const base = { piece: PIECE, finding: 'builder.screen_check', ground_truth: 'G04', subject: criterion, evidence } as const;
    if (shots.length > 0 && merged && blocking.length === 0) return { ...base, class: 'tp', value: 1, unit: 'tests' };
    if (shots.length === 0 && blocking.length > 0) return { ...base, class: 'fn', value: 1, unit: 'tests' };
    return { ...base, class: 'info', value: null, unit: null };
  });
  if (screens.size > 0) {
    const ms = stepsOf(inputs, 'builder').map((s) => numberOf(detailOf(s).duration_ms)).filter((n): n is number => n !== null);
    if (ms.length > 0) out.push({ piece: PIECE, finding: 'builder.screen_check_cost', class: 'cost', value: Math.round((ms.reduce((a, b) => a + b, 0) / 60_000) * 100) / 100, unit: 'min', subject: inputs.taskCode, evidence: { criteria: [...screens.keys()] } });
  }
  return out;
};
