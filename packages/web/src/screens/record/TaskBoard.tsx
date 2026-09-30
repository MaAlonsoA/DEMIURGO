// The tasks of a feature, below its journey: the pieces it is built in (records of their own, each
// with its checks and resting on the feature), with their state, and "Add a task" once the feature
// is approved. The feature's thread proposes them too.

import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import type { ProductRow, ProductState, RecordDetail } from '../../api/types.ts';
import { canCreate } from '../../api/tables.ts';
import { buttonClass } from '../../components/Button.tsx';
import { PlusIcon } from '../../components/icons.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useTables } from '../../lib/hooks.ts';
import type { LineState } from '../epics/logic.ts';
import { CopyBriefButton } from './CopyBrief.tsx';
import { LineMark } from './EpicBoard.tsx';
import { effortTotals } from '../../sizes.ts';
import { SizeDisputeText, SizeText } from './TaskSize.tsx';
import { TASK_BOARD, TASK_SIZE } from './words.i18n.ts';

const stateOf = (r: ProductRow): LineState =>
  r.implementation === 'implemented' ? 'built' : r.readiness?.ready ? 'ready' : r.current ? 'approved' : 'designing';

export function TaskBoard({
  projectId,
  record,
  state,
}: {
  projectId: string;
  record: RecordDetail;
  state: ProductState | undefined;
}) {
  const t = useMessages(TASK_BOARD);
  const ts = useMessages(TASK_SIZE);
  const id = useId();
  const tables = useTables();
  if (!state) return null;
  const tasks = state.designs.filter((r) => r.type === 'task' && r.based_on === record.code).sort((a, b) => a.code.localeCompare(b.code));
  const approved = record.current !== null;
  const writable = !!tables && canCreate(tables, 'record.create');
  const built = tasks.filter((r) => r.implementation === 'implemented').length;
  // Effort (FDR-DEL-006): per size, about how many points, and how many are not built yet.
  // Criteria of the feature's current version that no task covers.
  const currentVersion = record.versions.find((v) => v.n === record.current);
  const covered = new Set(tasks.flatMap((r) => r.covers ?? []));
  const uncovered = tasks.length > 0 ? (currentVersion?.criteria ?? []).map((c) => c.code).filter((c) => !covered.has(c)) : [];
  const effort = effortTotals(tasks.map((r) => ({ size: r.effort?.size ?? null, built: r.implementation === 'implemented' })));

  return (
    <section aria-labelledby={id} data-task-board className="flex flex-col gap-3 rounded-lg border border-edge bg-panel px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="text-lg font-semibold text-fg">
          {t.title}
        </h2>
        {tasks.length > 0 ? <span className="text-sm tabular-nums text-fg-2">{t.count(built, tasks.length)}</span> : null}
      </div>
      <p className="max-w-prose text-sm text-fg-2">{t.note}</p>
      {uncovered.length > 0 ? (
        <p className="text-sm text-fg" data-uncovered>
          {t.uncovered(uncovered.join(', '))}
        </p>
      ) : null}
      {effort.total > 0 || effort.unsized > 0 ? (
        <p className="flex flex-wrap gap-x-2 text-sm tabular-nums text-fg-2" data-effort>
          {effort.summary ? <span data-effort-counts>{effort.summary}</span> : null}
          {effort.total > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span data-effort-total>{ts.total(effort.total)}</span>
              <span aria-hidden>·</span>
              <span data-effort-remaining>{ts.remaining(effort.remaining)}</span>
            </>
          ) : null}
          {effort.unsized > 0 ? (
            <>
              {effort.summary ? <span aria-hidden>·</span> : null}
              <span className="text-fg-3">{ts.unsized(effort.unsized)}</span>
            </>
          ) : null}
        </p>
      ) : null}
      {tasks.length === 0 ? (
        <p className="text-sm text-fg-2">{t.none}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-edge-subtle">
          {tasks.map((r) => {
            const s = stateOf(r);
            return (
              <li key={r.code} data-task={r.code} className="flex flex-col gap-1 py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link
                    to="/p/$projectId/records/$code"
                    params={{ projectId, code: r.code }}
                    className="font-medium text-fg hover:underline"
                  >
                    {r.title}
                    <span className="ml-2 font-mono text-xs text-fg-3">{r.code}</span>
                  </Link>
                  <SizeText effort={r.effort} />
                  <SizeDisputeText effort={r.effort} />
                  {r.covers?.length ? (
                    <span className="font-mono text-xs text-fg-3" data-covers>
                      {t.covers(r.covers.join(', '))}
                    </span>
                  ) : r.checks > 0 ? (
                    <span className="text-sm tabular-nums text-fg-3">{t.checks(r.checks)}</span>
                  ) : (
                    <span className="text-sm text-fg-3">{t.coversNone}</span>
                  )}
                  <span className="ml-auto flex items-center gap-3">
                    {s === 'ready' ? <CopyBriefButton projectId={projectId} code={r.code} size="sm" /> : null}
                    <LineMark state={s} />
                  </span>
                </div>
                {r.summary ? <p className="line-clamp-2 text-sm text-fg-2">{r.summary}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
      {!approved ? (
        <p className="text-sm text-fg-2">{t.approveFirst}</p>
      ) : writable ? (
        <div>
          <Link
            to="/p/$projectId/records/new"
            params={{ projectId }}
            search={{ type: 'task', basedOn: record.code }}
            className={buttonClass({ size: 'sm' })}
            data-add-task
          >
            <PlusIcon size={14} />
            {t.add}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
