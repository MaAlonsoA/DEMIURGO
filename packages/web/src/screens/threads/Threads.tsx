// Threads (spec §4.7): each thread with its state, the open questions that wait for the person and
// its last activity, nested under its parent. "New thread" opens one with its purpose.

import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { explorationsQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import { cn } from '../../lib/cn.ts';
import { useProjectId, useTables } from '../../lib/hooks.ts';
import { ago, dayTime } from '../../lib/time.ts';
import { Button } from '../../ui/Button.tsx';
import { TextDialog } from '../../ui/dialogs.tsx';
import { PlusIcon, TypeIcon } from '../../ui/icons.tsx';
import { EmptyState, Page, PageTitle, Skeleton } from '../../ui/layout.tsx';
import { StateMark } from '../../ui/marks.tsx';
import { NeedsBubble } from '../../ui/signals.tsx';
import { Tip } from '../../ui/Tip.tsx';
import { type ThreadRow, threadTree } from './tree.ts';

export function ThreadsScreen() {
  const projectId = useProjectId();
  const tables = useTables();
  const threads = useQuery(explorationsQuery(projectId));
  const [opening, setOpening] = useState(false);
  const allowed = tables ? canCreate(tables, 'exploration.open') : false;

  const rows = threads.data ? threadTree(threads.data) : null;
  const active = threads.data?.filter((t) => t.state === 'active').length ?? 0;

  return (
    <Page>
      <PageTitle
        title="Threads"
        subtitle={
          threads.data && threads.data.length > 0
            ? `${threads.data.length} ${threads.data.length === 1 ? 'thread' : 'threads'} · ${active} active`
            : 'Explore something with DEMIURGO: a question, an idea, a change.'
        }
        actions={
          allowed ? (
            <Button variant="ink" onClick={() => setOpening(true)}>
              <PlusIcon size={14} />
              New thread
            </Button>
          ) : null
        }
      />

      {threads.isPending ? (
        <ListSkeleton />
      ) : rows && rows.length > 0 ? (
        <ThreadTable projectId={projectId} rows={rows} />
      ) : (
        <EmptyState>No threads yet.{allowed ? ' Open one to explore something with DEMIURGO.' : ''}</EmptyState>
      )}

      <OpenThreadDialog projectId={projectId} open={opening} onOpenChange={setOpening} />
    </Page>
  );
}

function ThreadTable({ projectId, rows }: { projectId: string; rows: ThreadRow[] }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
            <th scope="col" className="py-2.5 pr-4 pl-5 font-semibold">
              Thread
            </th>
            <th scope="col" className="w-[150px] px-4 py-2.5 font-semibold">
              State
            </th>
            <th scope="col" className="w-[150px] px-4 py-2.5 font-semibold">
              Open questions
            </th>
            <th scope="col" className="w-[150px] py-2.5 pr-5 pl-4 font-semibold">
              Last activity
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ thread: t, depth }) => (
            <tr
              key={t.id}
              data-thread-row={t.id}
              data-depth={depth}
              className="group border-b border-line-soft last:border-b-0 hover:bg-surface-2"
            >
              <td className="py-3 pr-4 pl-5">
                <span className="flex min-w-0 items-center gap-2.5" style={{ paddingLeft: depth * 26 }}>
                  {depth > 0 && (
                    <span
                      aria-hidden="true"
                      className="-mt-2.5 h-3 w-3 shrink-0 rounded-bl-[4px] border-b border-l border-line-strong"
                    />
                  )}
                  <span className={cn('flex shrink-0', t.state === 'active' ? 'text-ink-2' : 'text-inactive')}>
                    <TypeIcon kind="thread" size={15} />
                  </span>
                  <Link
                    to="/p/$projectId/threads/$explorationId"
                    params={{ projectId, explorationId: t.id }}
                    className={cn(
                      'min-w-0 truncate text-[14px] font-semibold underline-offset-2 hover:underline',
                      t.state === 'active' ? 'text-ink' : 'text-ink-2',
                    )}
                  >
                    {t.purpose}
                  </Link>
                </span>
              </td>
              <td className="px-4 py-3">
                <StateMark entity="exploration" state={t.state} />
              </td>
              <td className="px-4 py-3">
                {t.open_questions > 0 ? (
                  <NeedsBubble
                    count={t.open_questions}
                    size="sm"
                    detail={`${t.open_questions} open ${t.open_questions === 1 ? 'question waits' : 'questions wait'} for you.`}
                  />
                ) : (
                  <span className="text-xs text-muted">None</span>
                )}
              </td>
              <td className="py-3 pr-5 pl-4 text-[13px] text-ink-2">
                <Tip text={dayTime(t.last_activity)}>
                  <time dateTime={t.last_activity}>{ago(t.last_activity)}</time>
                </Tip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading the threads" className="rounded-[var(--radius-card)] border border-line bg-surface">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4 border-b border-line-soft px-5 py-3.5 last:border-b-0">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="ml-auto h-3 w-20" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Opens a thread (a child one when there is a parent) and goes to it. */
export function OpenThreadDialog({
  projectId,
  open,
  onOpenChange,
  parent,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parent?: { id: string; purpose: string };
}) {
  const command = useCommand(projectId);
  const navigate = useNavigate();
  const { reset } = command;
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);
  return (
    <TextDialog
      open={open}
      onOpenChange={onOpenChange}
      title={parent ? 'Open a thread inside' : 'Open a thread'}
      description={
        parent ? (
          <>
            Inside <span className="font-semibold text-ink">{parent.purpose}</span>. Say what this thread explores.
          </>
        ) : (
          'Say what this thread explores. DEMIURGO reads it as its purpose.'
        )
      }
      label="Purpose"
      submit="Open thread"
      required
      maxLength={1000}
      pending={command.isPending}
      error={command.error}
      onSubmit={(purpose) =>
        command.mutate(
          {
            command: 'exploration.open',
            data: parent ? { purpose, parent_id: parent.id, origin: { type: 'exploration', id: parent.id } } : { purpose },
          },
          {
            onSuccess: (r) => {
              onOpenChange(false);
              void navigate({ to: '/p/$projectId/threads/$explorationId', params: { projectId, explorationId: r.entity_id } });
            },
          },
        )
      }
    />
  );
}
