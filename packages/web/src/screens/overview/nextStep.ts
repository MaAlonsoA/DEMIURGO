// "Next step" on the Product page (spec «Entrega por épicas», 2b): once there is an epic or a
// feature, one action, the first that applies, epics by code.

import type { InceptionPath, InceptionStep, ProductRow, StageRow } from '../../api/types.ts';
import type { EpicRef } from '../epics/DesignNext.tsx';
import type { EpicLine } from '../epics/logic.ts';
import type { EpicState } from '../epics/plans.ts';

export type NextStep =
  | { kind: 'approve_epic'; code: string; title: string }
  | { kind: 'build'; code: string; title: string }
  | { kind: 'pass_architecture'; threadId: string | null }
  | { kind: 'close_gaps'; code: string; title: string; left: number }
  | { kind: 'continue'; title: string; code: string | null; threadId: string | null }
  | { kind: 'design_next'; epic: EpicRef; line: EpicLine }
  | { kind: 'check_walk'; code: string; title: string }
  | { kind: 'release' };

export function nextStep(rows: readonly ProductRow[], epics: readonly EpicState[], stages: readonly StageRow[]): NextStep | null {
  const features = rows.filter((r) => r.type === 'fdr');
  const draftEpic = epics.find((e) => e.epic.current === null);
  if (draftEpic) return { kind: 'approve_epic', code: draftEpic.epic.code, title: draftEpic.epic.title };
  const unbuilt = features.filter((f) => f.implementation !== 'implemented');
  const ready = unbuilt.find((f) => f.readiness?.ready);
  if (ready) return { kind: 'build', code: ready.code, title: ready.title };
  const approved = unbuilt.filter((f) => f.current !== null);
  const architecture = stages.find((s) => s.key === 'architecture');
  if (approved.length > 0 && architecture?.state !== 'passed') {
    return { kind: 'pass_architecture', threadId: architecture?.exploration_id ?? null };
  }
  const gaps = approved[0];
  if (gaps) return { kind: 'close_gaps', code: gaps.code, title: gaps.title, left: gaps.readiness?.reasons.length ?? 0 };
  const drafted = features.find((f) => f.current === null);
  if (drafted) return { kind: 'continue', title: drafted.title, code: drafted.code, threadId: drafted.origin_exploration };
  for (const e of epics) {
    const designing = e.plan.lines.find((l) => l.state === 'designing' && l.thread);
    if (designing) return { kind: 'continue', title: designing.name, code: null, threadId: designing.thread?.id ?? null };
  }
  for (const e of epics) {
    if (e.ref && e.plan.next) return { kind: 'design_next', epic: e.ref, line: e.plan.next };
  }
  const walk = epics.find(
    (e) => e.plan.lines.length > 0 && e.plan.lines.every((l) => l.state === 'built') && e.epic.implementation !== 'implemented',
  );
  if (walk) return { kind: 'check_walk', code: walk.epic.code, title: walk.epic.title };
  const release = stages.filter((s) => s.moment === 'before_release');
  if (epics.length > 0 && epics.every((e) => e.delivered) && release.some((s) => s.state !== 'passed')) return { kind: 'release' };
  return null;
}

/** The inception step that takes NEXT STEP's place: the current one, until only the build is left. */
export function inceptionStep(path: InceptionPath | undefined): InceptionStep | null {
  if (!path || path.current === null) return null;
  const step = path.steps.find((s) => s.key === path.current && s.state === 'current');
  if (!step || step.action?.kind === 'build') return null;
  return step;
}
