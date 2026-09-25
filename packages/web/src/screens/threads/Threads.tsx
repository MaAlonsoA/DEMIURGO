// Threads (spec §4.7): each thread as the design system's Node, with its state, the open questions
// that wait for the person and its last activity, nested under its parent. "New thread" opens one
// with its purpose.

import { type Certainty, Node as DsNode } from '@demiurgo/design-system';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useEffect, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { explorationsQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import { useProjectId, useTables } from '../../lib/hooks.ts';
import { ago, dayTime } from '../../lib/time.ts';
import { Button } from '../../ui/Button.tsx';
import { TextDialog } from '../../ui/dialogs.tsx';
import { PlusIcon } from '../../ui/icons.tsx';
import { EmptyState, Page, PageTitle, Skeleton } from '../../ui/layout.tsx';
import { Mark } from '../../ui/marks.tsx';
import { NeedsBubble } from '../../ui/signals.tsx';
import { Tip } from '../../ui/Tip.tsx';
import { type MarkKind, stateWord } from '../../words.ts';
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
            <Button variant="secondary" onClick={() => setOpening(true)}>
              <PlusIcon size={14} />
              New thread
            </Button>
          ) : null
        }
      />

      {threads.isPending ? (
        <ListSkeleton />
      ) : rows && rows.length > 0 ? (
        <ThreadList projectId={projectId} rows={rows} />
      ) : (
        <EmptyState>No threads yet.{allowed ? ' Open one to explore something with DEMIURGO.' : ''}</EmptyState>
      )}

      <OpenThreadDialog projectId={projectId} open={opening} onOpenChange={setOpening} />
    </Page>
  );
}

/** A thread as the design system's Node: what it is, its state's mark, its purpose, and at the end what
    waits for the person and when it last moved. The whole row is the link to the thread. */
export function ThreadNode({
  projectId,
  thread: t,
  trailing,
}: {
  projectId: string;
  thread: { id: string; purpose: string; state: string };
  trailing?: ReactNode;
}) {
  const w = stateWord('exploration', t.state);
  return (
    <Link
      to="/p/$projectId/threads/$explorationId"
      params={{ projectId, explorationId: t.id }}
      className="block min-w-0 flex-1 rounded-control hover:[&>.dm-node]:border-ink-3"
    >
      <DsNode
        type="thread"
        state={NODE_STATE[w.mark] ?? 'unknown'}
        mark={<Mark kind={w.mark} label={w.word} />}
        title={t.purpose}
        trailing={trailing}
      />
    </Link>
  );
}

/** The node's state follows the thread's mark: open while active, confirmed when concluded, parked when set aside. */
const NODE_STATE: Partial<Record<MarkKind, Certainty | 'parked'>> = {
  open: 'open',
  confirmed: 'confirmed',
  parked: 'parked',
};

function ThreadList({ projectId, rows }: { projectId: string; rows: ThreadRow[] }) {
  return (
    <ul aria-label="Threads" className="flex flex-col gap-2">
      {rows.map(({ thread: t, depth }) => (
        <li
          key={t.id}
          data-thread-row={t.id}
          data-depth={depth}
          className="flex items-center gap-2"
          style={{ paddingLeft: depth * 26 }}
        >
          {/* The elbow reaches up to the row above, down to the middle of its own. */}
          {depth > 0 && (
            <span aria-hidden="true" className="-mt-7.5 h-7.5 w-3 shrink-0 rounded-bl-tag border-b border-l border-line-strong" />
          )}
          <ThreadNode
            projectId={projectId}
            thread={t}
            trailing={
              <span className="flex shrink-0 items-center gap-3">
                <NeedsBubble
                  count={t.open_questions}
                  detail={`${t.open_questions} open ${t.open_questions === 1 ? 'question waits' : 'questions wait'} for you.`}
                />
                <span className="dm-text-caption text-muted">
                  {t.state !== 'active' && `${stateWord('exploration', t.state).word} · `}
                  <Tip text={dayTime(t.last_activity)}>
                    <time dateTime={t.last_activity}>{ago(t.last_activity)}</time>
                  </Tip>
                </span>
              </span>
            }
          />
        </li>
      ))}
    </ul>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading the threads" className="flex flex-col gap-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex h-11 items-center gap-3 rounded-control border border-line bg-surface px-3">
          <Skeleton className="h-3.5 w-3.5" />
          <Skeleton className="h-3 w-3" />
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="ml-auto h-3 w-20" />
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
