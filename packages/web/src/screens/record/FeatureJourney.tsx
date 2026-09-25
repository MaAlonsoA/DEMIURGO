// A feature's own design journey (INV-REC-15), below the product-level stages: its requirements with
// their checks, what it changes of the product baselines (quality, security, rollout) and Ready to
// build — derived from the version on screen and its readiness. The baseline step only says what the
// feature changes: it is information, not a step that is always "Done" (INVENTORY INV-REC, UX problem).

import { useId } from 'react';
import type { Readiness, RecordVersion } from '../../api/types.ts';
import { StatusBadge } from '../../components/status.tsx';

const DELTAS = [
  { title: 'Quality', baseline: 'Global quality' },
  { title: 'Security', baseline: 'Security baseline' },
  { title: 'Rollout', baseline: 'Operations baseline' },
] as const;

type Step = { label: string; state: 'done' | 'todo' | 'info'; detail: string };

export function FeatureJourney({ version, readiness }: { version: RecordVersion; readiness: Readiness | null }) {
  const id = useId();
  const requirements = version.criteria.length;
  const titles = new Set(version.sections.map((s) => s.title));
  const deltas = DELTAS.filter((d) => titles.has(d.title));
  const left = readiness?.reasons.length ?? 0;
  const steps: Step[] = [
    {
      label: 'Requirements',
      state: requirements > 0 ? 'done' : 'todo',
      detail:
        requirements > 0
          ? `${requirements} ${requirements === 1 ? 'requirement' : 'requirements'}, each with its check (below).`
          : 'No requirements yet: each one is a check with how it is verified.',
    },
    {
      label: 'Changes to the product baseline',
      state: 'info',
      detail: deltas.length
        ? `Changes ${deltas.map((d) => d.baseline).join(', ')}; the rest follows the product.`
        : 'None: it follows the product quality, security and operations baselines.',
    },
    {
      label: 'Ready to build',
      state: readiness?.ready ? 'done' : 'todo',
      detail: readiness?.ready
        ? 'Every check is verifiable and it rests on approved decisions.'
        : `${left} ${left === 1 ? 'thing' : 'things'} left: see "Before it can be built".`,
    },
  ];
  return (
    <section aria-labelledby={id} data-feature-journey className="flex flex-col gap-3">
      <h2 id={id} className="text-lg font-semibold text-fg">
        Feature design
      </h2>
      <ol className="grid gap-3 @2xl:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.label} className="flex flex-col gap-1.5 rounded-lg border border-edge bg-panel px-3.5 py-3">
            <span className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-fg-2 tabular-nums">Step {i + 1}</span>
              {s.state === 'done' ? (
                <StatusBadge kind="done" />
              ) : s.state === 'todo' ? (
                <StatusBadge kind="open" word="To do" />
              ) : null}
            </span>
            <span className="text-base font-semibold text-fg">{s.label}</span>
            <span className="text-sm text-fg-2">{s.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
