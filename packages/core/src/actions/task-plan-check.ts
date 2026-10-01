// Deterministic plan checks for `task_plan`, run when the plan is applied. They do not refuse the plan: each finding is a
// warning the person sees with the proposals (the batch summary and the `warnings` of the task proposal), so nothing
// is dropped or let through in silence. The practice is the checklist read before approving a design (Fagan, «Design and
// Code Inspections to Reduce Errors in Program Development», IBM Systems Journal, 1976) and tracing what a change touches
// (Bohner & Arnold, Software Change Impact Analysis, 1996). The rules themselves, and the file-name matching, are our
// convention: they come from the defects found in the Comidas project (mejora-contencion-diseno.md, family A and B).

import { posix } from 'node:path';

export type PlanTask = {
  title: string;
  goal: string;
  scope: string;
  covers: string[];
  depends_on: number[];
  depends_on_existing?: string[];
  waits_for_features: string[];
};

/** A file some merged task added: the task and the feature that own it. */
export type FileOwner = { task: string; feature: string };

/** Criteria a task covers, split: one that CI cannot decide (`manual`, `release`) never closes a task the builder agent must finish. */
const notAutomatic = (v: string | undefined) => v === 'manual' || v === 'release';

const CODE_FILE = /[\w@./-]+\.(?:tsx?|jsx?|mjs|cjs|mts|cts|sql|css|prisma)\b/g;

/** File names a text mentions (paths or bare names). Pure. */
export function mentionedFiles(text: string): string[] {
  return [...new Set((text.match(CODE_FILE) ?? []).map((f) => f.replace(/^\.?\//, '')))];
}

/** The owner of a mentioned file: a full-path match, or a bare name only one owned file has. Pure. */
export function ownerOfMention(mention: string, owners: ReadonlyMap<string, FileOwner>): { path: string; owner: FileOwner } | null {
  const exact = owners.get(mention);
  if (exact) return { path: mention, owner: exact };
  const base = posix.basename(mention);
  const hits = [...owners.entries()].filter(([p]) => posix.basename(p) === base && (mention === base || p.endsWith(`/${mention}`)));
  return hits.length === 1 ? { path: hits[0]![0], owner: hits[0]![1] } : null;
}

export type PlanCheckInput = {
  feature: string;
  tasks: readonly PlanTask[];
  /** Verification of each criterion of the feature. */
  verification: ReadonlyMap<string, string>;
  /** The criteria the feature's existing tasks cover once the plan's changes apply. */
  existingCovers: readonly string[];
  deploymentRecorded: boolean;
  /** Criteria taken out of a task because another one already covers them, and the tasks that went whole. */
  dropped: readonly { title: string; criteria: string[]; whole: boolean }[];
  owners: ReadonlyMap<string, FileOwner>;
};

/** One warning per finding, in words for the person. `task` is the 1-based position of the new task it is about, or null. */
export type PlanWarning = { task: number | null; text: string };

export function planWarnings(input: PlanCheckInput): PlanWarning[] {
  const out: PlanWarning[] = [];
  const verif = (c: string) => input.verification.get(c);
  const covered = [...new Set([...input.existingCovers, ...input.tasks.flatMap((t) => t.covers)])];
  if (covered.length > 0 && covered.every((c) => notAutomatic(verif(c))))
    out.push({
      task: null,
      text: `Every criterion the tasks of ${input.feature} cover is checked by a person or at release: no task is checked by an automatic test, so none can be closed by the builder agent.`,
    });
  for (const [i, t] of input.tasks.entries()) {
    const n = i + 1;
    const own = t.covers.filter((c) => verif(c) !== undefined);
    if (own.length > 0 && own.every((c) => notAutomatic(verif(c))))
      out.push({ task: n, text: `«${t.title}» covers only criteria checked by a person or at release (${own.join(', ')}): the builder agent has no automatic test to close it with.` });
    const release = t.covers.filter((c) => verif(c) === 'release');
    if (release.length > 0 && !input.deploymentRecorded)
      out.push({
        task: n,
        text: `«${t.title}» covers ${release.join(', ')}, checked against the deployed release candidate, and no deployment is recorded for the project: it cannot be checked until one exists.`,
      });
    const waits = t.depends_on.length + (t.depends_on_existing?.length ?? 0) + t.waits_for_features.length;
    if (waits === 0) {
      const found = new Map<string, { path: string; owner: FileOwner }>();
      for (const m of mentionedFiles(`${t.goal}\n${t.scope}`)) {
        const hit = ownerOfMention(m, input.owners);
        if (hit) found.set(hit.owner.task, hit);
      }
      for (const { path, owner } of found.values())
        out.push({
          task: n,
          text: `«${t.title}» depends on nothing but its Scope names ${path}, which ${owner.task} (${owner.feature}) built: consider \`depends_on\` ${owner.task}.`,
        });
    }
  }
  for (const d of input.dropped)
    out.push({
      task: null,
      text: d.whole
        ? `«${d.title}» was left out of the plan: every criterion it covers (${d.criteria.join(', ')}) is already covered by another task.`
        : `${d.criteria.join(', ')} ${d.criteria.length > 1 ? 'were' : 'was'} taken out of «${d.title}»: another task already covers ${d.criteria.length > 1 ? 'them' : 'it'}.`,
    });
  return out;
}

/** The warnings as lines for the batch summary, capped (our convention) so the summary stays readable. */
export function warningsSummary(warnings: readonly PlanWarning[], max = 1200): string {
  if (warnings.length === 0) return '';
  const lines = warnings.map((w) => `- ${w.text}`);
  const text = `Plan warnings (${warnings.length}):\n${lines.join('\n')}`;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
