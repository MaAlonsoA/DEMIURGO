// A feature's own design journey (INV-REC-15), below the product-level stages: its requirements with
// their checks, what it changes of the product baselines (quality, security, rollout) and Ready to
// build — derived from the version on screen and its readiness. The baseline step only says what the
// feature changes: it is information, not a step that is always "Done" (INVENTORY INV-REC, UX problem).

import { useId } from 'react';
import type { Readiness, RecordVersion } from '../../api/types.ts';
import { StatusBadge } from '../../components/status.tsx';
import { useMessages } from '../../i18n/define.ts';
import { FEATURE_JOURNEY } from './words.i18n.ts';

// The record's own section titles that a change to the product baseline is read off of; they are
// always written in English (records are always written in English), never translated.
const DELTA_TITLES = ['Quality', 'Security', 'Rollout'] as const;

type Step = { label: string; state: 'done' | 'todo' | 'info'; detail: string };

export function FeatureJourney({ version, readiness }: { version: RecordVersion; readiness: Readiness | null }) {
  const t = useMessages(FEATURE_JOURNEY);
  const id = useId();
  const requirements = version.criteria.length;
  const titles = new Set(version.sections.map((s) => s.title));
  const baselineOf: Record<(typeof DELTA_TITLES)[number], string> = {
    Quality: t.qualityBaseline,
    Security: t.securityBaseline,
    Rollout: t.rolloutBaseline,
  };
  const deltas = DELTA_TITLES.filter((title) => titles.has(title));
  const left = readiness?.reasons.length ?? 0;
  const steps: Step[] = [
    {
      label: t.requirementsLabel,
      state: requirements > 0 ? 'done' : 'todo',
      detail: requirements > 0 ? t.requirementsDetail(requirements) : t.noRequirementsDetail,
    },
    {
      label: t.baselineLabel,
      state: 'info',
      detail: deltas.length ? t.baselineDetail(deltas.map((d) => baselineOf[d]).join(', ')) : t.noBaselineDetail,
    },
    {
      label: t.readyLabel,
      state: readiness?.ready ? 'done' : 'todo',
      detail: readiness?.ready ? t.readyDoneDetail : t.readyLeftDetail(left),
    },
  ];
  return (
    <section aria-labelledby={id} data-feature-journey className="flex flex-col gap-3">
      <h2 id={id} className="text-lg font-semibold text-fg">
        {t.title}
      </h2>
      <ol className="grid gap-3 @2xl:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.label} className="flex flex-col gap-1.5 rounded-lg border border-edge bg-panel px-3.5 py-3">
            <span className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-fg-2 tabular-nums">{t.stepN(i + 1)}</span>
              {s.state === 'done' ? (
                <StatusBadge kind="done" />
              ) : s.state === 'todo' ? (
                <StatusBadge kind="open" word={t.toDo} />
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
