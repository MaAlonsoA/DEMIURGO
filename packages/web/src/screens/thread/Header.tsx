// The thread's header (DESIGN.md §3.3; INV-THR-01…13): where it sits (breadcrumbs), what it is and
// its state in words, its purpose as the h1 — clamped to three lines with "Show all", since the
// agent rewrites it as the design moves on — where it comes from and who opened it, the design stage
// it carries with its progress, the earlier summaries of its purpose, and Conclude, Set aside and
// Resume as the tables allow them. Once concluded or set aside, it says why.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { entityEventsQuery, explorationQuery } from '../../api/queries.ts';
import type { Exploration, ExplorationDetail, ProductState, Question, StageRow } from '../../api/types.ts';
import { ActionBar } from '../../components/actions.tsx';
import { announce } from '../../components/announce.tsx';
import { Code } from '../../components/Badge.tsx';
import { Card } from '../../components/Card.tsx';
import { PromptDialog } from '../../components/Dialog.tsx';
import { StagesIcon, ThreadsIcon } from '../../components/icons.tsx';
import { Meter } from '../../components/Meter.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { type Crumb, PageHeader } from '../../components/Page.tsx';
import { EntityState } from '../../components/status.tsx';
import { Who, whoName } from '../../components/Who.tsx';
import { shortDate } from '../../lib/time.ts';
import { whoOf } from '../../words.ts';

export const short = (text: string, n = 56): string => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

type Dialog = null | 'conclude' | 'set_aside';

export function ThreadHeader({
  projectId,
  thread: t,
  parent,
  threads,
  products,
  stage,
  extraActions,
}: {
  projectId: string;
  thread: ExplorationDetail;
  parent: Exploration | undefined;
  threads: readonly Exploration[] | undefined;
  products: ProductState | undefined;
  stage: StageRow | undefined;
  /** More actions for small screens (the side panel's content in a sheet). */
  extraActions?: ReactNode;
}) {
  const command = useCommand(projectId);
  const [dialog, setDialog] = useState<Dialog>(null);
  const clamp = useClamp(t.purpose);
  const open = (d: Dialog) => {
    command.reset();
    setDialog(d);
  };
  const run = (name: string, data: Record<string, unknown>, said: string) =>
    command.mutate(
      { command: name, entityId: t.id, data },
      {
        onSuccess: () => {
          setDialog(null);
          announce(said);
        },
      },
    );

  const crumbs: Crumb[] = [{ label: 'Threads', link: { to: '/p/$projectId/threads', params: { projectId } } }];
  if (parent)
    crumbs.push({
      label: short(parent.purpose, 40),
      link: { to: '/p/$projectId/threads/$explorationId', params: { projectId, explorationId: parent.id } },
    });
  crumbs.push({ label: short(t.purpose, 48) });

  return (
    <div data-thread-header>
      <PageHeader
        crumbs={crumbs}
        eyebrow={
          <>
            <ThreadsIcon size={14} />
            <span>Thread</span>
            <span data-thread-state={t.state} className="inline-flex">
              <EntityState entity="exploration" state={t.state} />
            </span>
          </>
        }
        title={
          <span ref={clamp.ref} className={clamp.all ? 'block' : 'line-clamp-3'}>
            {t.purpose}
          </span>
        }
        meta={
          <>
            {clamp.overflows || clamp.all ? (
              <button
                type="button"
                onClick={clamp.toggle}
                aria-expanded={clamp.all}
                className="basis-full cursor-pointer text-left text-sm font-medium text-accent-text hover:underline"
              >
                {clamp.all ? 'Show less of the purpose' : 'Show all of the purpose'}
              </button>
            ) : null}
            <Provenance projectId={projectId} thread={t} parent={parent} threads={threads} products={products} />
          </>
        }
        actions={
          <>
            {extraActions}
            <ActionBar
              entity="exploration"
              state={t.state}
              handlers={{
                'exploration.conclude': { run: () => open('conclude'), variant: 'secondary' },
                'exploration.set_aside': { run: () => open('set_aside'), variant: 'quiet' },
                'exploration.resume': {
                  run: () => run('exploration.resume', {}, 'Thread resumed.'),
                  variant: 'primary',
                  pending: command.isPending && !dialog,
                  pendingLabel: 'Resuming…',
                },
              }}
            />
          </>
        }
      >
        {stage ? <StageProgress stage={stage} /> : null}
        <PurposeHistory projectId={projectId} explorationId={t.id} />
        {!dialog && command.error ? <ErrorNotice error={command.error} /> : null}
        {t.state === 'concluded' && t.state_reason ? (
          <Card tone="success" padding="sm" data-thread-conclusion className="flex max-w-3xl flex-col gap-0.5">
            <span className="text-sm font-medium text-success-text">Conclusion</span>
            <p className="text-base whitespace-pre-wrap text-fg">{t.state_reason}</p>
          </Card>
        ) : null}
        {t.state === 'set_aside' ? (
          <div
            data-thread-conclusion
            className="flex max-w-3xl flex-col gap-0.5 rounded-lg border border-dashed border-edge-strong px-3 py-3"
          >
            <span className="text-sm font-medium text-fg-2">Why it was set aside</span>
            <p className="text-base whitespace-pre-wrap text-fg">{t.state_reason || 'No reason given.'}</p>
          </div>
        ) : null}
      </PageHeader>

      <PromptDialog
        open={dialog === 'conclude'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Conclude this thread"
        description="Say what the thread settled. It stays with the thread, and you can resume it later."
        label="Conclusion"
        submit="Conclude"
        pendingLabel="Concluding…"
        required
        maxLength={1000}
        pending={command.isPending}
        error={dialog === 'conclude' ? command.error : null}
        onSubmit={(text) => run('exploration.conclude', { reason: text }, 'Thread concluded.')}
      />
      <PromptDialog
        open={dialog === 'set_aside'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Set this thread aside"
        description="It stops for now, with everything it has. Say why."
        label="Reason"
        submit="Set aside"
        pendingLabel="Setting aside…"
        required
        maxLength={1000}
        pending={command.isPending}
        error={dialog === 'set_aside' ? command.error : null}
        onSubmit={(text) => run('exploration.set_aside', { reason: text }, 'Thread set aside.')}
      />
    </div>
  );
}

/** The purpose clamped to three lines: whether it overflows, and "Show all" to read it whole. */
function useClamp(text: string) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [all, setAll] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure again when the purpose changes
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return { ref, overflows, all, toggle: () => setAll((a) => !a) };
}

/** The design stage this thread carries: its title and how many of its questions are answered. */
function StageProgress({ stage }: { stage: StageRow }) {
  return (
    <div data-thread-stage={stage.key} className="flex max-w-md flex-col gap-1.5">
      <span className="inline-flex items-center gap-1.5 text-sm text-fg-2">
        <StagesIcon size={14} className="text-fg-3" />
        Design stage: <span className="font-medium text-fg">{stage.title}</span>
      </span>
      <Meter value={stage.covered} max={stage.total} label={`${stage.covered} of ${stage.total} answered`} />
    </div>
  );
}

const PURPOSE_COMMANDS = new Set(['exploration.open', 'exploration.revise_purpose']);

/** Earlier versions of the purpose: the agent rewrites it as the design moves on. */
function PurposeHistory({ projectId, explorationId }: { projectId: string; explorationId: string }) {
  const events = useQuery(entityEventsQuery(projectId, explorationId)).data;
  const versions = (events ?? [])
    .filter((e) => e.entity_id === explorationId && PURPOSE_COMMANDS.has(e.command))
    .map((e) => ({ id: e.id, at: e.at, purpose: (e.after as { purpose?: string } | null)?.purpose ?? '' }))
    .filter((v) => v.purpose)
    .toReversed();
  if (versions.length < 2) return null;
  return (
    <details data-purpose-history className="max-w-3xl text-sm">
      <summary className="w-fit cursor-pointer font-medium text-fg-2 select-none hover:text-fg">
        Earlier summaries ({versions.length - 1})
      </summary>
      <ol className="mt-2 flex flex-col gap-2.5 border-l-2 border-edge pl-3">
        {versions.slice(1).map((v) => (
          <li key={v.id} className="flex flex-col gap-0.5">
            <time dateTime={v.at} className="text-xs text-fg-3">
              {shortDate(v.at)}
            </time>
            <p className="text-base whitespace-pre-wrap text-fg-2">{v.purpose}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

const linkClass = 'font-medium text-fg underline-offset-2 hover:underline';

/** Where the thread comes from: the thread it sits inside, its origin and who opened it. */
function Provenance({
  projectId,
  thread: t,
  parent,
  threads,
  products,
}: {
  projectId: string;
  thread: ExplorationDetail;
  parent: Exploration | undefined;
  threads: readonly Exploration[] | undefined;
  products: ProductState | undefined;
}) {
  const parentDetail = useQuery({
    ...explorationQuery(projectId, t.parent_id ?? ''),
    enabled: t.origin_type === 'question' && !!t.parent_id,
  }).data;
  const parts: { key: string; node: ReactNode }[] = [];
  if (parent) {
    parts.push({
      key: 'parent',
      node: (
        <span>
          Inside{' '}
          <Link to="/p/$projectId/threads/$explorationId" params={{ projectId, explorationId: parent.id }} className={linkClass}>
            {parent.purpose}
          </Link>
        </span>
      ),
    });
  }
  if (t.origin_type && t.origin_id && !(t.origin_type === 'exploration' && t.origin_id === t.parent_id)) {
    parts.push({ key: 'origin', node: <span>{originOf(projectId, t, threads, parentDetail?.questions, products)}</span> });
  }
  parts.push({
    key: 'who',
    node: (
      <span className="inline-flex items-center gap-1.5">
        <Who actor={t.opened_by} size={16} showName={false} />
        Opened by {t.opened_by.startsWith('human:') ? 'you' : whoName(whoOf(t.opened_by))} · {shortDate(t.created_at)}
      </span>
    ),
  });
  return (
    <p data-thread-provenance className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {parts.map((p, i) => (
        <span key={p.key} className="inline-flex min-w-0 items-center gap-2">
          {i > 0 ? <span aria-hidden>·</span> : null}
          {p.node}
        </span>
      ))}
    </p>
  );
}

function originOf(
  projectId: string,
  t: ExplorationDetail,
  threads: readonly Exploration[] | undefined,
  questions: Question[] | undefined,
  products: ProductState | undefined,
): ReactNode {
  const id = t.origin_id ?? '';
  switch (t.origin_type) {
    case 'exploration': {
      const from = threads?.find((x) => x.id === id);
      return from ? (
        <>
          From the thread{' '}
          <Link to="/p/$projectId/threads/$explorationId" params={{ projectId, explorationId: from.id }} className={linkClass}>
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
          <Link to="/p/$projectId/records/$code" params={{ projectId, code: row.code }} search={{ v: n }} className={linkClass}>
            {row.title}
          </Link>{' '}
          <Code>
            {row.code} v{n}
          </Code>
        </>
      );
    }
    case 'proposal':
      return 'From a proposal';
    default:
      return null;
  }
}
