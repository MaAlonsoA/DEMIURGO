// The page of a feature its epic lists and nobody has designed yet (a planned feature): its reserved
// code, its name and sentence, where it sits in its epic's list and the step that designs it. It hangs
// from its epic in the breadcrumb; once designed, its FDR takes this same code and this address.

import { Link } from '@tanstack/react-router';
import type { PlannedFeatureRow, ProductState } from '../../api/types.ts';
import { canCreate } from '../../api/tables.ts';
import { Code } from '../../components/Badge.tsx';
import { buttonClass } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Page.tsx';
import { TypeIcon } from '../../components/types.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useTables } from '../../lib/hooks.ts';
import { DesignNextButton } from '../epics/DesignNext.tsx';
import { epicGroups, epicPlan, plannedOf } from '../epics/logic.ts';
import { LineControls } from '../epics/PlanEditing.tsx';
import { epicRef } from '../epics/plans.ts';
import { PLANNED_FEATURE } from '../epics/words.i18n.ts';
import { LineMark } from './EpicBoard.tsx';
import { recordCrumbs } from './Header.tsx';
import { HEADER } from './words.i18n.ts';

export function PlannedFeaturePage({
  projectId,
  planned,
  state,
}: {
  projectId: string;
  planned: PlannedFeatureRow;
  state: ProductState;
}) {
  const t = useMessages(PLANNED_FEATURE);
  const h = useMessages(HEADER);
  const tables = useTables();
  const rows = [...state.designs, ...state.decisions];
  const epic = rows.find((r) => r.code === planned.epic_code);
  const features = epicGroups(rows).groups.find((g) => g.epic.code === planned.epic_code)?.features ?? [];
  const plan = epic ? epicPlan(epic, plannedOf(state, epic.code), features, rows, state.explorations) : null;
  const index = plan ? plan.lines.findIndex((l) => l.code === planned.code) : -1;
  const line = plan && index >= 0 ? plan.lines[index] : undefined;
  const before = plan && index > 0 ? plan.lines[index - 1] : undefined;
  const after = plan && index >= 0 ? plan.lines[index + 1] : undefined;
  const ref = epic ? epicRef(epic) : null;
  const editable = !!tables && canCreate(tables, 'planned_feature.add');
  const sibling = (label: string, l: typeof before) =>
    l ? (
      <p className="text-sm text-fg-2">
        {label}:{' '}
        <Link to="/p/$projectId/records/$code" params={{ projectId, code: l.code }} className="text-fg hover:underline">
          <span className="mr-1.5 font-mono text-xs text-fg-3">{l.code}</span>
          {l.name}
        </Link>
      </p>
    ) : null;

  return (
    <div data-planned-feature={planned.code}>
      <PageHeader
        crumbs={recordCrumbs(
          projectId,
          { code: planned.code, type: 'fdr' },
          planned.name,
          [],
          h,
          epic ? [epic] : [],
        )}
        eyebrow={
          <>
            <span className="inline-flex items-center gap-1.5 text-sm text-fg-2">
              <TypeIcon type="fdr" size={15} className="text-fg-3" />
              {t.feature}
            </span>
            <Code>{planned.code}</Code>
            {line ? <LineMark state={line.state} /> : <span className="text-sm text-fg-2">{t.planned}</span>}
          </>
        }
        title={planned.name}
        meta={
          plan && index >= 0 && epic ? (
            <span className="tabular-nums">{t.place(index + 1, plan.lines.length, `${epic.code} ${epic.title}`)}</span>
          ) : null
        }
        actions={
          line && editable ? (
            <LineControls projectId={projectId} line={line} index={index} count={plan?.lines.length ?? 0} />
          ) : null
        }
      />
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <p className="max-w-prose text-md text-fg">{planned.summary}</p>
        <section className="flex max-w-prose flex-col gap-2" data-planned-next>
          <h2 className="text-base font-semibold text-fg">{t.nextStep}</h2>
          {line?.thread ? (
            <>
              <p className="text-sm text-fg-2">{t.designing}</p>
              <div>
                <Link
                  to="/p/$projectId/threads/$explorationId"
                  params={{ projectId, explorationId: line.thread.id }}
                  className={buttonClass({ variant: 'primary', size: 'sm' })}
                >
                  {t.openThread}
                </Link>
              </div>
            </>
          ) : ref && line ? (
            <>
              <p className="text-sm text-fg-2">{t.notDesigned}</p>
              <div>
                <DesignNextButton projectId={projectId} epic={ref} line={line} named size="sm" />
              </div>
            </>
          ) : epic ? (
            <>
              <p className="text-sm text-fg-2">{t.approveEpic(epic.code)}</p>
              <div>
                <Link
                  to="/p/$projectId/records/$code"
                  params={{ projectId, code: epic.code }}
                  className={buttonClass({ size: 'sm' })}
                >
                  {t.openEpic}
                </Link>
              </div>
            </>
          ) : null}
          <p className="text-sm text-fg-3">{t.becomes(planned.code)}</p>
        </section>
        {before || after ? (
          <section className="flex flex-col gap-1" aria-label={t.list}>
            {sibling(t.before, before)}
            {sibling(t.after, after)}
          </section>
        ) : null}
      </div>
    </div>
  );
}
