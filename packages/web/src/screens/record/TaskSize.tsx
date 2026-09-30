// A task's effort size on its page (FDR-DEL-006): the current size or "No size" (a task from before
// sizes), five options to change it with one click (record.set_size: no new version, a journal
// event), and a reminder to split an XL task. Only a person changes it.

import { useId } from 'react';
import { useCommand } from '../../api/commands.ts';
import type { RecordDetail, TaskEffort, TaskSize } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { useAllows } from '../../components/actions.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { SIZE_POINTS, TASK_SIZES } from '../../sizes.ts';
import { TASK_SIZE } from './words.i18n.ts';

/** The size as a line shows it: "M · 3 points", or "No size". */
export function SizeText({ effort }: { effort: TaskEffort | null | undefined }) {
  const t = useMessages(TASK_SIZE);
  const size = effort?.size ?? null;
  return (
    <span data-size={size ?? 'none'} className={cn('text-sm tabular-nums', size ? 'text-fg-2' : 'text-fg-3')}>
      {size ? t.current(size, SIZE_POINTS[size]) : t.noSize}
    </span>
  );
}

export function TaskSizePanel({ projectId, record }: { projectId: string; record: RecordDetail }) {
  const t = useMessages(TASK_SIZE);
  const id = useId();
  const command = useCommand(projectId);
  const allows = useAllows('record', 'registered');
  const writable = allows('record.set_size');
  const effort = record.effort ?? null;
  const size = effort?.size ?? null;
  const set = (next: TaskSize) => {
    if (next === size || command.isPending) return;
    command.mutate(
      { command: 'record.set_size', entityId: record.id, data: { size: next } },
      { onSuccess: () => announce(t.changed(next)) },
    );
  };

  return (
    <section aria-labelledby={id} data-task-size className="flex flex-col gap-2 rounded-lg border border-edge bg-panel px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={id} className="text-md font-semibold text-fg">
          {t.title}
        </h2>
        <SizeText effort={effort} />
      </div>
      {writable ? (
        <div role="group" aria-label={t.options} className="inline-flex flex-wrap gap-1.5">
          {TASK_SIZES.map((s) => {
            const on = s === size;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                aria-label={t.option(s, SIZE_POINTS[s])}
                data-size-option={s}
                disabled={command.isPending}
                onClick={() => set(s)}
                className={cn(
                  'inline-flex h-8 cursor-pointer items-center rounded-full border px-3 text-sm font-medium transition-colors duration-[var(--m-fast)] disabled:cursor-default',
                  on ? 'border-fg bg-fg text-panel' : 'border-edge-strong bg-panel text-fg-2 hover:border-edge-control hover:text-fg',
                )}
              >
                {s}
              </button>
            );
          })}
        </div>
      ) : null}
      <p className="max-w-prose text-sm text-fg-3">{t.note}</p>
      {size === 'XL' ? (
        <p className="text-sm font-medium text-fg" data-split-note>
          {t.split}
        </p>
      ) : null}
      {command.error ? <ErrorNotice error={command.error} /> : null}
    </section>
  );
}
