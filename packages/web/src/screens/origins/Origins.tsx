// Product → Origins (DESIGN.md §3.7, spec §4.4): a left-to-right provenance tree, thread → decision →
// feature or tech decision, with their based_on and origin links, that says why each element
// exists. The trace is pinned on click or Enter and cleared with Esc or "Clear trace": it never
// follows the pointer. The "Why does this exist?" panel grows with what it says. The tree is drawn
// as soon as the product state and the threads arrive; each record's links fill in as they come, and
// a record that fails shows an inline error instead of blanking the tree (INV-ORIG-01…12).

import { type UseQueryResult, useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type KeyboardEvent, type Ref, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { explorationsQuery, projectsQuery, recordQuery, stateQuery } from '../../api/queries.ts';
import type { RecordDetail } from '../../api/types.ts';
import { Code } from '../../components/Badge.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ArrowRightIcon, CloseIcon, OriginsIcon, ProductIcon } from '../../components/icons.tsx';
import { Meter } from '../../components/Meter.tsx';
import { ErrorNotice, Notice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, usePageTitle } from '../../components/Page.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { Certainty, EntityState } from '../../components/status.tsx';
import { TypeIcon, typeWord } from '../../components/types.tsx';
import { cn } from '../../lib/cn.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { shortDate } from '../../lib/time.ts';
import { ProductTabs } from '../../shell/ProductTabs.tsx';
import { whoOf } from '../../words.ts';
import { rowStage } from '../record/logic.ts';
import {
  type Box,
  type Geometry,
  type OriginNode,
  type OriginsTree,
  type Segment,
  buildOrigins,
  edgePath,
  geometryFor,
  traceOf,
  whyOf,
} from './tree.ts';

/** Column headers. The third holds every record that is not a decision, not only features. */
const HEADERS = ['Where it started', 'Decisions', 'Features and other records'];

/** The tree's geometry: the columns of tree.ts, with room for a two-line card and two note lines. */
function geometry(width: number): Geometry {
  return { ...geometryFor(width), nodeHeight: 62, noteHeight: 42, gap: 14, laneGap: 32 };
}

type Records = {
  details: RecordDetail[];
  loaded: number;
  failed: { code: string; error: Error }[];
  retry: () => void;
};

/** Every record's detail as it arrives; the failed ones apart, with a way to ask again. */
function combineRecords(codes: string[]) {
  return (results: UseQueryResult<RecordDetail>[]): Records => ({
    details: results.flatMap((r) => (r.data ? [r.data] : [])),
    loaded: results.filter((r) => r.data !== undefined || r.error).length,
    failed: results.flatMap((r, i) => (r.error && !r.data ? [{ code: codes[i] ?? '', error: r.error }] : [])),
    retry: () => {
      for (const r of results) if (r.error) void r.refetch();
    },
  });
}

export function OriginsScreen() {
  const projectId = useProjectId();
  const project = (useQuery(projectsQuery).data ?? []).find((p) => p.id === projectId);
  usePageTitle(['Origins', project?.name]);
  const state = useQuery(stateQuery(projectId));
  const explorations = useQuery(explorationsQuery(projectId));
  const codes = useMemo(
    () => [...(state.data?.decisions ?? []), ...(state.data?.designs ?? [])].map((r) => r.code),
    [state.data],
  );
  const combine = useMemo(() => combineRecords(codes), [codes]);
  const records = useQueries({ queries: codes.map((code) => recordQuery(projectId, code)), combine });

  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const g = useMemo(() => geometry(width), [width]);

  const tree = useMemo(
    () =>
      state.data && explorations.data
        ? buildOrigins({ state: state.data, explorations: explorations.data, records: records.details }, g)
        : null,
    [state.data, explorations.data, records.details, g],
  );

  const [traced, setTraced] = useState<string | null>(null);
  const current = traced && tree?.nodes.some((n) => n.key === traced) ? traced : null;
  const trace = useMemo(() => (tree && current ? traceOf(tree, current) : null), [tree, current]);
  const why = useRef<HTMLElement>(null);
  const clear = () => {
    // The button goes away with the trace: the focus stays on the panel (INV-ORIG-10).
    why.current?.focus();
    setTraced(null);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || !current) return;
    e.preventDefault();
    e.stopPropagation();
    setTraced(null);
  };

  const failed = state.error ?? explorations.error;
  const failedCodes = new Set(records.failed.map((f) => f.code));
  const waiting = codes.length - records.loaded;

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <ProductIcon size={15} className="text-fg-3" />
            <span>{project?.name ?? 'Product'}</span>
          </>
        }
        title="Origins"
        meta="Where each decision, feature and tech decision comes from, and why it exists."
        tabs={<ProductTabs active="origins" />}
      />
      <PageBody width="full">
        {/* Esc clears the trace wherever the focus is on the page: the tree or the Why panel. */}
        <div onKeyDown={onKey} className="flex flex-col gap-4">
          {failed ? (
            <ErrorNotice
              error={failed}
              onRetry={() => {
                void state.refetch();
                void explorations.refetch();
              }}
            />
          ) : !tree ? (
            <TreeSkeleton />
          ) : tree.nodes.length === 0 ? (
            <EmptyState icon={<OriginsIcon size={28} />} title="Nothing here yet" size="spacious">
              Threads, decisions and designs appear here as they are created.
            </EmptyState>
          ) : (
            <>
              <WhyPanel ref={why} projectId={projectId} tree={tree} traced={current} onClear={clear} />
              {waiting > 0 ? (
                <Meter
                  value={records.loaded}
                  max={codes.length}
                  tone="info"
                  label={`Reading the links of ${records.loaded} of ${codes.length} records…`}
                  className="max-w-md"
                />
              ) : null}
              {records.failed.length > 0 ? (
                <Notice
                  tone="danger"
                  role="alert"
                  title={`The links of ${records.failed.length} ${records.failed.length === 1 ? 'record' : 'records'} couldn't be read`}
                  action={
                    <Button size="sm" variant="secondary" onClick={records.retry}>
                      Retry
                    </Button>
                  }
                >
                  {records.failed.map((f) => f.code).join(', ')} {records.failed.length === 1 ? 'is' : 'are'} shown without where{' '}
                  {records.failed.length === 1 ? 'it comes' : 'they come'} from.
                </Notice>
              ) : null}
            </>
          )}
          {/* Measured even while loading, so the first drawing already has its width. */}
          <div ref={frame} className="relative overflow-x-auto pb-4">
            {tree && tree.nodes.length > 0 ? (
              <Tree
                tree={tree}
                geometry={g}
                trace={trace}
                current={current}
                failed={failedCodes}
                onTrace={(key) => setTraced((k) => (k === key ? null : key))}
              />
            ) : null}
          </div>
        </div>
      </PageBody>
    </>
  );
}

function Tree({
  tree,
  geometry: g,
  trace,
  current,
  failed,
  onTrace,
}: {
  tree: OriginsTree;
  geometry: Geometry;
  trace: { nodes: Set<string>; edges: Set<string> } | null;
  current: string | null;
  failed: Set<string>;
  onTrace: (key: string) => void;
}) {
  const box = (k: string): Box | undefined => tree.boxes.get(k);
  const drawn = tree.edges.flatMap((e) => {
    const from = box(e.from);
    const to = box(e.to);
    return from && to ? [{ ...e, d: edgePath(from, to), lit: trace?.edges.has(e.key) ?? false }] : [];
  });
  return (
    <div className="relative" style={{ width: tree.width }}>
      <div className="relative mb-3 h-5" aria-hidden="true">
        {HEADERS.map((h, i) => (
          <span key={h} className="absolute top-0 text-xs font-medium text-fg-2" style={{ left: g.columns[i]?.x ?? 0 }}>
            {h}
          </span>
        ))}
      </div>
      <div className="relative" style={{ height: tree.height }}>
        <svg
          width={tree.width}
          height={tree.height}
          viewBox={`0 0 ${tree.width} ${tree.height}`}
          aria-hidden="true"
          className="absolute top-0 left-0 overflow-visible"
        >
          <g fill="none" strokeWidth="1.5" className="stroke-edge-strong">
            {drawn
              .filter((e) => !e.lit)
              .map((e) => (
                <path key={e.key} d={e.d} strokeDasharray={dashed(e.type)} />
              ))}
          </g>
          <g fill="none" strokeWidth="2.5" className="stroke-accent">
            {drawn
              .filter((e) => e.lit)
              .map((e) => (
                <path key={e.key} d={e.d} strokeDasharray={dashed(e.type)} data-traced-edge />
              ))}
          </g>
        </svg>
        <ul aria-label="Origins" className="relative h-full">
          {tree.nodes.map((n) => {
            const b = box(n.key);
            if (!b) return null;
            return (
              <li key={n.key} className="absolute" style={{ left: b.x, top: b.y, width: b.w, height: b.h + g.noteHeight }}>
                <OriginCard
                  node={n}
                  height={g.nodeHeight}
                  traced={trace?.nodes.has(n.key) ?? false}
                  pinned={current === n.key}
                  failed={n.kind === 'record' && failed.has(n.row.code)}
                  onTrace={() => onTrace(n.key)}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** Links to a record's version and the start of the unthreaded lane are dashed. */
const dashed = (type: string) => (type === 'link_origin' || type === 'start' ? '5 4' : undefined);

/** The lines under a card: who and when (and the code), then why it exists. */
const NOTE = 'flex min-w-0 flex-col pt-1.5 pr-1 pl-3 text-xs text-fg-3';

function OriginCard({
  node,
  height,
  traced,
  pinned,
  failed,
  onTrace,
}: {
  node: OriginNode;
  height: number;
  traced: boolean;
  pinned: boolean;
  failed: boolean;
  onTrace: () => void;
}) {
  const card = cn(
    'flex flex-col justify-center gap-1 rounded-lg border px-3 transition-colors duration-[var(--m-fast)]',
    pinned
      ? 'border-accent bg-accent-soft ring-1 ring-accent'
      : traced
        ? 'border-accent bg-accent-soft'
        : 'border-edge bg-panel group-hover:border-edge-control',
  );

  if (node.kind === 'start') {
    return (
      <div className="flex h-full w-full flex-col">
        <div
          style={{ height }}
          className="flex flex-col justify-center rounded-lg border border-dashed border-edge-strong bg-sunken px-3"
        >
          <span className="text-sm font-medium text-fg-2">Not from a thread</span>
        </div>
        <span className={NOTE}>
          <span className="truncate">What follows doesn't come from a conversation.</span>
        </span>
      </div>
    );
  }

  const button = 'group flex h-full w-full cursor-pointer flex-col rounded-lg text-left';
  const common = {
    type: 'button' as const,
    'aria-pressed': pinned,
    'data-traced': traced ? 'true' : undefined,
    onClick: onTrace,
    className: button,
  };

  if (node.kind === 'thread') {
    const e = node.exploration;
    const who = whoOf(e.opened_by);
    return (
      <button {...common} data-origin-node={node.key}>
        <span style={{ height }} className={card}>
          <span className="flex items-center gap-1.5 text-xs text-fg-2">
            <TypeIcon type="thread" size={14} className="shrink-0 text-fg-3" />
            <span className="flex-1">Thread</span>
            <EntityState entity="exploration" state={e.state} />
          </span>
          <span className="truncate text-sm font-medium text-fg">{e.purpose}</span>
        </span>
        <span className={NOTE}>
          <span className="truncate">
            {who.kind === 'you' ? 'you' : who.name}, {shortDate(e.created_at)}
            {node.parent ? ' · inside a thread' : ''}
          </span>
          {node.phrase ? <span className="truncate text-fg-2">“{node.phrase}”</span> : null}
        </span>
      </button>
    );
  }

  const row = node.row;
  const who = whoOf(row.updated_by);
  const n = node.version?.n ?? row.latest.n;
  const stage = row.type === 'fdr' ? rowStage(row) : null;
  return (
    <button {...common} data-origin-node={node.key}>
      <span style={{ height }} className={card}>
        <span className="flex items-center gap-1.5 text-xs text-fg-2">
          <TypeIcon type={row.type} size={14} className="shrink-0 text-fg-3" />
          <span className="flex-1 truncate">{typeWord(row.type)}</span>
          <Certainty status={row.epistemic_status} />
        </span>
        <span className="truncate text-sm font-medium text-fg">{row.title}</span>
      </span>
      <span className={NOTE}>
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate">
            {who.kind === 'you' ? 'you' : who.name}, {shortDate(row.updated_at)}
            {stage ? ` · ${stage === 'ready' ? 'Ready to build' : stage === 'doubt' ? 'In doubt' : 'Not ready'}` : ''}
          </span>
          <Code className="shrink-0 text-fg-3">
            {row.code} v{n}
          </Code>
        </span>
        {failed ? (
          <span className="truncate font-medium text-danger-text">Its links couldn't be read</span>
        ) : node.phrase ? (
          <span className="truncate text-fg-2">“{node.phrase}”</span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * "Why does this exist?" (INV-ORIG-09): the sentence of the trace with its links, every phrase along
 * it in full, and the way to open what is traced. Sticky above the tree; it grows with its text.
 */
function WhyPanel({
  ref,
  projectId,
  tree,
  traced,
  onClear,
}: {
  ref: Ref<HTMLElement>;
  projectId: string;
  tree: OriginsTree;
  traced: string | null;
  onClear: () => void;
}) {
  const why = traced ? whyOf(tree, traced) : null;
  const node = traced ? tree.nodes.find((n) => n.key === traced) : undefined;
  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby="why-title"
      data-why
      className={cn(
        'sticky top-14 z-10 flex max-h-[45vh] flex-col gap-2 overflow-y-auto rounded-lg border bg-panel px-5 py-4 shadow-popover outline-none lg:top-2',
        why ? 'border-accent-edge' : 'border-edge',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <h2 id="why-title" className={cn('text-sm font-semibold', why ? 'text-accent-text' : 'text-fg-2')}>
          Why does this exist?
        </h2>
        {why && node && node.kind !== 'start' ? (
          <div className="flex flex-wrap items-center gap-2">
            {node.kind === 'thread' ? (
              <Link
                to="/p/$projectId/threads/$explorationId"
                params={{ projectId, explorationId: node.exploration.id }}
                className={buttonClass({ variant: 'secondary', size: 'sm' })}
              >
                Open the thread
                <ArrowRightIcon size={14} />
              </Link>
            ) : (
              <Link
                to="/p/$projectId/records/$code"
                params={{ projectId, code: node.row.code }}
                className={buttonClass({ variant: 'secondary', size: 'sm' })}
              >
                Open the {typeWord(node.row.type).toLowerCase()}
                <ArrowRightIcon size={14} />
              </Link>
            )}
            <Button size="sm" variant="quiet" icon={<CloseIcon size={14} />} kbd="Esc" onClick={onClear}>
              Clear trace
            </Button>
          </div>
        ) : null}
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {why ? (
          <>
            <p className="text-md text-fg">
              {why.sentence.map((s, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: segments of one sentence, in order
                <SegmentText key={i} projectId={projectId} segment={s} />
              ))}
            </p>
            {why.phrases.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {why.phrases.map((p) => (
                  <li key={p.label} className="text-sm text-fg-2">
                    <span className="font-medium text-fg">{p.label}:</span> “{p.text}”
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-2">No thread conclusion or change note says why yet.</p>
            )}
          </>
        ) : (
          <p className="text-base text-fg-2">
            Select a thread, a decision or a feature to trace where it comes from and why it exists. Esc clears the trace.
          </p>
        )}
      </div>
    </section>
  );
}

function SegmentText({ projectId, segment }: { projectId: string; segment: Segment }) {
  const to = segment.to;
  if (!to) return <>{segment.text}</>;
  const cls = 'font-medium text-accent-text underline underline-offset-2 hover:no-underline';
  return to.kind === 'record' ? (
    <Link to="/p/$projectId/records/$code" params={{ projectId, code: to.code }} className={cls}>
      {segment.text}
    </Link>
  ) : (
    <Link to="/p/$projectId/threads/$explorationId" params={{ projectId, explorationId: to.id }} className={cls}>
      {segment.text}
    </Link>
  );
}

function TreeSkeleton() {
  return (
    <Skeleton label="Loading the origins" className="flex flex-col gap-6">
      <Bone className="h-20 w-full rounded-lg" />
      {[0, 1, 2].map((row) => (
        <div key={row} className="grid grid-cols-3 gap-16">
          {[0, 1, 2].map((col) =>
            col <= row || row === 0 ? (
              <div key={col} className="flex flex-col gap-2">
                <Bone className="h-14 w-full rounded-lg" />
                <Bone className="h-2.5 w-2/5" />
              </div>
            ) : (
              <span key={col} />
            ),
          )}
        </div>
      ))}
    </Skeleton>
  );
}
