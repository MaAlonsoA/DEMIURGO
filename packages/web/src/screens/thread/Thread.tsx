// A thread (spec §4.7): its purpose, state and origin; the conversation with the runs between the
// messages and the composer at the bottom; on the right, its questions resolved in place and the
// threads inside it. Conclude, Set aside and Resume come from the tables.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useCommand } from '../../api/commands.ts';
import { entityEventsQuery, explorationQuery, explorationsQuery, runsQuery, stateQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { ExplorationDetail, ProductState, Question } from '../../api/types.ts';
import { useRouteParams, useTables } from '../../lib/hooks.ts';
import { shortDate } from '../../lib/time.ts';
import { ActionBar, useAllows } from '../../ui/ActionBar.tsx';
import { Button } from '../../ui/Button.tsx';
import { TextDialog } from '../../ui/dialogs.tsx';
import { PlusIcon, TypeIcon } from '../../ui/icons.tsx';
import { Breadcrumbs, type Crumb, Page, SectionTitle, Skeleton } from '../../ui/layout.tsx';
import { StateMark } from '../../ui/marks.tsx';
import { QuestionItem } from '../../ui/QuestionItem.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import { whoOf } from '../../words.ts';
import { NotFound } from '../not-found/NotFound.tsx';
import { OpenThreadDialog, ThreadNode } from '../threads/Threads.tsx';
import { Composer } from './Composer.tsx';
import { Conversation } from './Conversation.tsx';
import { buildTimeline, draftableDecisions } from './timeline.ts';

const short = (text: string, n = 56) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

export function ThreadScreen() {
  const { projectId, explorationId = '' } = useRouteParams();
  const thread = useQuery(explorationQuery(projectId, explorationId));
  const runs = useQuery(runsQuery(projectId, { exploration: explorationId }));
  const state = useQuery(stateQuery(projectId));
  const resume = useCommand(projectId);
  const allows = useAllows('exploration', thread.data?.state);

  if (thread.error instanceof ApiError && thread.error.status === 404) {
    return <NotFound thing="this thread">It may belong to another project.</NotFound>;
  }
  const t = thread.data;
  if (!t && thread.error) {
    return (
      <Page>
        <Reasons error={thread.error} className="mx-auto max-w-[760px]" />
      </Page>
    );
  }
  if (!t) return <ThreadSkeleton />;

  const items = buildTimeline(t.messages, runs.data ?? []);
  const active = t.state === 'active';
  const decisions = state.data ? draftableDecisions(state.data.decisions, t.id) : undefined;
  const canResume = allows('exploration.resume');

  return (
    <Page className="pb-0" aside={<ThreadAside projectId={projectId} thread={t} />}>
      <div className="mx-auto flex min-h-[calc(100vh-56px-28px)] max-w-[760px] flex-col">
        <ThreadHeader projectId={projectId} thread={t} products={state.data} />
        <div className="flex-1">
          {runs.isPending ? (
            <div aria-hidden="true" className="flex flex-col gap-4">
              <Skeleton className="h-16 w-3/5 self-end" />
              <Skeleton className="h-24 w-4/5" />
            </div>
          ) : (
            <Conversation projectId={projectId} items={items} runs={runs.data ?? []} questions={t.questions} active={active} />
          )}
        </div>
        {resume.error ? <Reasons error={resume.error} className="mt-4" /> : null}
        <Composer
          projectId={projectId}
          explorationId={t.id}
          active={active}
          inactiveNote={
            t.state === 'concluded'
              ? 'This thread is concluded. Resume it to continue.'
              : 'This thread is set aside. Resume it to continue.'
          }
          decisions={decisions}
          onResume={canResume ? () => resume.mutate({ command: 'exploration.resume', entityId: t.id }) : undefined}
        />
      </div>
    </Page>
  );
}

type Dialog = null | 'conclude' | 'set_aside';

const PURPOSE_COMMANDS = new Set(['exploration.open', 'exploration.revise_purpose']);

/** Earlier versions of the thread's purpose: the agent rewrites it as the design moves on. */
function PurposeHistory({ projectId, explorationId }: { projectId: string; explorationId: string }) {
  const events = useQuery(entityEventsQuery(projectId, explorationId)).data;
  const versions = (events ?? [])
    .filter((e) => e.entity_id === explorationId && PURPOSE_COMMANDS.has(e.command))
    .map((e) => ({ id: e.id, at: e.at, purpose: String((e.after as { purpose?: string } | null)?.purpose ?? '') }))
    .filter((v) => v.purpose)
    .toReversed();
  if (versions.length < 2) return null;
  return (
    <details data-purpose-history className="dm-text-small text-ink-2">
      <summary className="cursor-pointer select-none">Earlier summaries ({versions.length - 1})</summary>
      <ol className="mt-2 flex flex-col gap-2.5 border-l border-line pl-3">
        {versions.slice(1).map((v) => (
          <li key={v.id} className="flex flex-col gap-0.5">
            <span className="dm-label">{shortDate(v.at)}</span>
            <p className="dm-text-body leading-relaxed whitespace-pre-wrap text-ink-2">{v.purpose}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

function ThreadHeader({
  projectId,
  thread: t,
  products,
}: {
  projectId: string;
  thread: ExplorationDetail;
  products?: ProductState;
}) {
  const command = useCommand(projectId);
  const [dialog, setDialog] = useState<Dialog>(null);
  const threads = useQuery(explorationsQuery(projectId)).data;
  const parent = t.parent_id ? threads?.find((x) => x.id === t.parent_id) : undefined;
  const open = (d: Dialog) => {
    command.reset();
    setDialog(d);
  };
  const run = (name: string, data: Record<string, unknown>) =>
    command.mutate({ command: name, entityId: t.id, data }, { onSuccess: () => setDialog(null) });

  const crumbs: Crumb[] = [
    { label: 'Threads', to: '/p/$projectId/threads', params: { projectId } },
    ...(parent
      ? [
          {
            label: short(parent.purpose, 40),
            to: '/p/$projectId/threads/$explorationId',
            params: { projectId, explorationId: parent.id },
          },
        ]
      : []),
    { label: short(t.purpose, 48) },
  ];

  return (
    <header data-thread-header className="mb-7 flex flex-col gap-2.5">
      <Breadcrumbs items={crumbs} />
      <div className="dm-label flex items-center gap-1.5">
        <TypeIcon kind="thread" size={14} />
        Thread
        <span className="dm-sep" aria-hidden="true">
          ·
        </span>
        <span className="tracking-normal normal-case">
          <StateMark entity="exploration" state={t.state} />
        </span>
      </div>
      <div className="flex items-start justify-between gap-6">
        <h1 className="dm-text-page-title leading-tight font-semibold text-balance">{t.purpose}</h1>
        <ActionBar
          entity="exploration"
          state={t.state}
          className="shrink-0 pt-1"
          handlers={{
            'exploration.conclude': { run: () => open('conclude'), variant: 'secondary' },
            'exploration.set_aside': { run: () => open('set_aside'), variant: 'text' },
            'exploration.resume': {
              run: () => run('exploration.resume', {}),
              variant: 'secondary',
              disabled: command.isPending,
            },
          }}
        />
      </div>
      <Provenance projectId={projectId} thread={t} parent={parent} products={products} />
      <PurposeHistory projectId={projectId} explorationId={t.id} />
      {!dialog && command.error ? <Reasons error={command.error} /> : null}
      {t.state === 'concluded' && t.state_reason && (
        <div
          data-thread-conclusion
          className="mt-1 flex flex-col gap-0.5 rounded-card-md border border-line bg-surface px-4 py-3"
        >
          <span className="dm-label">Conclusion</span>
          <p className="dm-text-body leading-relaxed whitespace-pre-wrap">{t.state_reason}</p>
        </div>
      )}
      {t.state === 'set_aside' && (
        <div
          data-thread-conclusion
          className="mt-1 flex flex-col gap-0.5 rounded-card-md border border-dashed border-line-strong px-4 py-3"
        >
          <span className="dm-label">Why it was set aside</span>
          <p className="dm-text-body leading-relaxed whitespace-pre-wrap text-ink-2">{t.state_reason || 'No reason given.'}</p>
        </div>
      )}

      <TextDialog
        open={dialog === 'conclude'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Conclude this thread"
        description="Say what the thread settled. It stays with the thread, and you can resume it later."
        label="Conclusion"
        submit="Conclude"
        required
        maxLength={1000}
        pending={command.isPending}
        error={dialog ? command.error : null}
        onSubmit={(text) => run('exploration.conclude', { reason: text })}
      />
      <TextDialog
        open={dialog === 'set_aside'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Set this thread aside"
        description="It stops for now, with everything it has. Say why."
        label="Reason"
        submit="Set aside"
        required
        maxLength={1000}
        pending={command.isPending}
        error={dialog ? command.error : null}
        onSubmit={(text) => run('exploration.set_aside', { reason: text })}
      />
    </header>
  );
}

/** Where the thread comes from: its parent, its origin and who opened it. */
function Provenance({
  projectId,
  thread: t,
  parent,
  products,
}: {
  projectId: string;
  thread: ExplorationDetail;
  parent: { id: string; purpose: string } | undefined;
  products?: ProductState;
}) {
  const threads = useQuery(explorationsQuery(projectId)).data;
  const parentDetail = useQuery({
    ...explorationQuery(projectId, t.parent_id ?? ''),
    enabled: t.origin_type === 'question' && !!t.parent_id,
  }).data;
  const parts: ReactNode[] = [];
  const link = 'font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline';
  if (parent) {
    parts.push(
      <span key="parent">
        Inside{' '}
        <Link to="/p/$projectId/threads/$explorationId" params={{ projectId, explorationId: parent.id }} className={link}>
          {parent.purpose}
        </Link>
      </span>,
    );
  }
  if (t.origin_type && t.origin_id && !(t.origin_type === 'exploration' && t.origin_id === t.parent_id)) {
    parts.push(<span key="origin">{originOf(projectId, t, threads, parentDetail?.questions, products, link)}</span>);
  }
  const who = whoOf(t.opened_by);
  parts.push(
    <span key="who" className="inline-flex items-center gap-1.5">
      <WhoMark actor={t.opened_by} size={16} />
      Opened by {who.kind === 'you' ? 'you' : who.name} · {shortDate(t.created_at)}
    </span>,
  );
  return (
    <p data-thread-provenance className="dm-text-small flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 && (
            <span className="dm-sep" aria-hidden="true">
              ·
            </span>
          )}
          {p}
        </span>
      ))}
    </p>
  );
}

function originOf(
  projectId: string,
  t: ExplorationDetail,
  threads: { id: string; purpose: string }[] | undefined,
  questions: Question[] | undefined,
  products: ProductState | undefined,
  link: string,
): ReactNode {
  const id = t.origin_id ?? '';
  switch (t.origin_type) {
    case 'exploration': {
      const from = threads?.find((x) => x.id === id);
      return from ? (
        <>
          From the thread{' '}
          <Link to="/p/$projectId/threads/$explorationId" params={{ projectId, explorationId: from.id }} className={link}>
            {from.purpose}
          </Link>
        </>
      ) : (
        'From another thread'
      );
    }
    case 'question': {
      const q = questions?.find((x) => x.id === id);
      return q ? `From the question “${short(q.question, 80)}”` : 'From a question';
    }
    case 'record_version': {
      const row = [...(products?.decisions ?? []), ...(products?.designs ?? [])].find(
        (r) => r.latest_id === id || r.current_id === id,
      );
      if (!row) return 'From a record';
      const n = row.latest_id === id ? row.latest.n : (row.current ?? row.latest.n);
      return (
        <>
          From{' '}
          <Link to="/p/$projectId/records/$code" params={{ projectId, code: row.code }} search={{ v: n }} className={link}>
            {row.title}
          </Link>{' '}
          <span className="dm-code">
            {row.code} v{n}
          </span>
        </>
      );
    }
    case 'proposal':
      return 'From a proposal';
    default:
      return null;
  }
}

/** The right column: the questions of the thread and the threads inside it. */
function ThreadAside({ projectId, thread: t }: { projectId: string; thread: ExplorationDetail }) {
  const tables = useTables();
  const [opening, setOpening] = useState(false);
  const order: Record<string, number> = { pending: 0, inferred: 1, postponed: 2, confirmed: 3, discarded: 4 };
  const sorted = [...t.questions].sort((a, b) => (order[a.state] ?? 5) - (order[b.state] ?? 5));
  const waiting = sorted.filter((q) => ['pending', 'inferred', 'postponed'].includes(q.state));
  const settled = sorted.filter((q) => !['pending', 'inferred', 'postponed'].includes(q.state));
  const canOpen = !!tables && canCreate(tables, 'exploration.open');

  return (
    <>
      <section aria-labelledby="thread-questions" className="flex flex-col">
        <SectionTitle aside={waiting.length > 0 ? `${waiting.length} waiting` : undefined}>
          <span id="thread-questions">Questions</span>
        </SectionTitle>
        {t.questions.length === 0 && (
          <p className="dm-text-small text-muted">No questions yet. DEMIURGO raises them as the thread goes on.</p>
        )}
        <QuestionList projectId={projectId} questions={waiting} />
        {settled.length > 0 && (
          <>
            <h3 className="dm-label mt-4 mb-1">Settled</h3>
            <QuestionList projectId={projectId} questions={settled} />
          </>
        )}
      </section>

      <section aria-labelledby="thread-children" className="flex flex-col border-t border-line-soft pt-5">
        <SectionTitle>
          <span id="thread-children">Threads inside</span>
        </SectionTitle>
        {t.children.length > 0 ? (
          <ul className="mb-3 flex flex-col gap-2">
            {t.children.map((c) => (
              <li key={c.id} className="flex">
                <ThreadNode projectId={projectId} thread={c} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="dm-text-small mb-3 text-muted">None yet.</p>
        )}
        {canOpen && (
          <Button variant="secondary" className="self-start" onClick={() => setOpening(true)}>
            <PlusIcon size={12} />
            New thread inside
          </Button>
        )}
        <OpenThreadDialog
          projectId={projectId}
          open={opening}
          onOpenChange={setOpening}
          parent={{ id: t.id, purpose: t.purpose }}
        />
      </section>
    </>
  );
}

function QuestionList({ projectId, questions }: { projectId: string; questions: Question[] }) {
  if (questions.length === 0) return null;
  return (
    <ul className="flex flex-col divide-y divide-line-soft">
      {questions.map((q) => (
        <li key={q.id} className="py-3 first:pt-1">
          <QuestionItem projectId={projectId} question={q} />
        </li>
      ))}
    </ul>
  );
}

function ThreadSkeleton() {
  return (
    <Page
      aside={
        <div role="status" aria-label="Loading the questions" className="flex flex-col gap-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      }
    >
      <div role="status" aria-label="Loading the thread" className="mx-auto flex max-w-[760px] flex-col gap-4">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="mt-6 h-16 w-3/5 self-end" />
        <Skeleton className="h-28 w-4/5" />
      </div>
    </Page>
  );
}
