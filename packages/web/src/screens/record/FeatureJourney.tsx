// A feature's own design journey (below the product-level stages): its requirements with their
// checks, what it changes of the product baseline (quality, security, rollout) and Ready to build.
// Derived from the version on screen: the sections and criteria it has, and its readiness.

import { useId } from 'react';
import type { Readiness, RecordVersion } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';

const DELTAS = [
  { title: 'Quality', baseline: 'Global quality' },
  { title: 'Security', baseline: 'Security baseline' },
  { title: 'Rollout', baseline: 'Operations baseline' },
] as const;

export function FeatureJourney({ version, readiness }: { version: RecordVersion; readiness: Readiness | null }) {
  const id = useId();
  const requirements = version.criteria.length;
  const titles = new Set(version.sections.map((s) => s.title));
  const deltas = DELTAS.filter((d) => titles.has(d.title));
  const steps = [
    {
      label: 'Requirements',
      done: requirements > 0,
      detail:
        requirements > 0
          ? `${requirements} ${requirements === 1 ? 'requirement' : 'requirements'}, each with its check (below).`
          : 'No requirements yet: each one is a check with how it is verified.',
    },
    {
      label: 'Changes to the product baseline',
      done: true,
      detail: deltas.length
        ? `Changes ${deltas.map((d) => d.baseline).join(', ')}; the rest follows the product.`
        : 'None: it follows the product quality, security and operations baselines.',
    },
    {
      label: 'Ready to build',
      done: !!readiness?.ready,
      detail: readiness?.ready
        ? 'Every check is verifiable and it rests on approved decisions.'
        : `${readiness?.reasons.length ?? 0} ${readiness?.reasons.length === 1 ? 'thing' : 'things'} left: see the panel on the right.`,
    },
  ];
  return (
    <section aria-labelledby={id} data-feature-journey className="mb-6 flex flex-col gap-2.5">
      <h2 id={id} className="dm-text-caption font-semibold text-muted">
        Feature design
      </h2>
      <ol className="grid grid-cols-3 gap-3">
        {steps.map((s, i) => (
          <li
            key={s.label}
            className={cn('flex flex-col gap-1 rounded-card-md border px-3.5 py-3', s.done ? 'border-line' : 'border-line-strong bg-surface')}
          >
            <span className="dm-label">
              {i + 1} · {s.done ? 'Done' : 'To do'}
            </span>
            <span className="dm-text-body font-semibold">{s.label}</span>
            <span className="dm-text-small text-ink-3">{s.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
