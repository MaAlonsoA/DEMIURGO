// Origins (spec §4.4, canvas S2B): a left-to-right tree, thread → decision → feature or tech
// decision, with their based_on and origin links. Each element is the design system's Node (the
// size of the card template for trees) with its mark, and under it who, when and why it exists.
// Pointing at a node (or focusing it) lights its trace and says why it exists; the trace stays
// until "Clear trace". Static HTML and SVG.

import { type Certainty, Node } from '@demiurgo/design-system';
import { type UseQueryResult, useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { explorationsQuery, recordQuery, stateQuery } from '../../api/queries.ts';
import type { RecordDetail } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { shortDate } from '../../lib/time.ts';
import { Button } from '../../ui/Button.tsx';
import { Code } from '../../ui/Card.tsx';
import { RECORD_TYPE } from '../../ui/icons.tsx';
import { EmptyState, Page, Skeleton } from '../../ui/layout.tsx';
import { Mark } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { StageBars } from '../../ui/signals.tsx';
import { EPISTEMIC_MARK, type MarkKind, TYPE_WORDS, stateWord, whoOf } from '../../words.ts';
import { ProductTabs } from '../shell/Header.tsx';
import {
  type Box,
  type OriginNode,
  type OriginsTree,
  type Segment,
  buildOrigins,
  edgePath,
  geometryFor,
  traceOf,
  whyOf,
} from './tree.ts';

const HEADERS = ['Where it started', 'Decisions', 'Features and tech decisions'];

export function OriginsScreen() {
  const projectId = useProjectId();
  const state = useQuery(stateQuery(projectId));
  const explorations = useQuery(explorationsQuery(projectId));
  const codes = useMemo(
    () => [...(state.data?.decisions ?? []), ...(state.data?.designs ?? [])].map((r) => r.code),
    [state.data],
  );
  const records = useQueries({ queries: codes.map((code) => recordQuery(projectId, code)), combine: combineRecords });

  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1360);
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const geometry = useMemo(() => geometryFor(width), [width]);

  const tree = useMemo(
    () =>
      state.data && explorations.data && records.ready
        ? buildOrigins({ state: state.data, explorations: explorations.data, records: records.details }, geometry)
        : null,
    [state.data, explorations.data, records, geometry],
  );

  const failed = state.error ?? explorations.error ?? records.error;
  const [traced, setTraced] = useState<string | null>(null);
  const current = traced && tree?.nodes.some((n) => n.key === traced) ? traced : null;
  const trace = useMemo(() => (tree && current ? traceOf(tree, current) : null), [tree, current]);

  return (
    <Page className="pb-0">
      <ProductTabs active="origins" />
      <div className="-mx-10 min-h-[calc(100vh-150px)] px-10 pb-16" style={DOTS}>
        <div className="flex items-baseline gap-3 pt-1 pb-4">
          <h1 className="dm-text-title leading-tight font-semibold">Origins</h1>
          <p className="dm-text-body text-ink-3">Where each decision, feature and tech decision comes from.</p>
        </div>
        {tree && tree.nodes.length > 0 && (
          <WhyPanel projectId={projectId} tree={tree} traced={current} onClear={() => setTraced(null)} />
        )}
        <div ref={frame} className="mt-5">
          {failed ? (
            <Reasons error={failed} />
          ) : !tree ? (
            <TreeSkeleton />
          ) : tree.nodes.length === 0 ? (
            <EmptyState className="bg-surface/60">
              Nothing here yet. Threads, decisions and designs appear here as they are created.
            </EmptyState>
          ) : (
            <Tree projectId={projectId} tree={tree} trace={trace} current={current} onTrace={setTraced} />
          )}
        </div>
      </div>
    </Page>
  );
}

/** All the records at once: the tree is drawn when every one has arrived, so it does not jump. */
function combineRecords(results: UseQueryResult<RecordDetail>[]): {
  ready: boolean;
  details: RecordDetail[];
  error: Error | null;
} {
  return {
    ready: results.every((r) => r.data !== undefined),
    details: results.flatMap((r) => (r.data ? [r.data] : [])),
    error: results.find((r) => r.error)?.error ?? null,
  };
}

const DOTS = {
  backgroundImage: 'radial-gradient(var(--line-strong) 1px, transparent 1px)',
  backgroundSize: '20px 20px',
};

function Tree({
  projectId,
  tree,
  trace,
  current,
  onTrace,
}: {
  projectId: string;
  tree: OriginsTree;
  trace: { nodes: Set<string>; edges: Set<string> } | null;
  current: string | null;
  onTrace: (key: string) => void;
}) {
  const g = geometryFor(tree.width);
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
          <span
            key={h}
            className="dm-text-caption absolute top-0 font-semibold text-muted"
            style={{ left: g.columns[i]?.x ?? 0 }}
          >
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
          <g fill="none" strokeWidth="1.5">
            {drawn
              .filter((e) => !e.lit)
              .map((e) => (
                <path
                  key={e.key}
                  d={e.d}
                  stroke="var(--inactive-soft)"
                  strokeDasharray={e.type === 'link_origin' || e.type === 'start' ? '5 4' : undefined}
                />
              ))}
          </g>
          <g fill="none" strokeWidth="2.5" stroke="var(--needs)">
            {drawn
              .filter((e) => e.lit)
              .map((e) => (
                <path key={e.key} d={e.d} strokeDasharray={e.type === 'link_origin' ? '5 4' : undefined} />
              ))}
          </g>
        </svg>
        <ul aria-label="Origins" className="relative">
          {tree.nodes.map((n) => {
            const b = box(n.key);
            if (!b) return null;
            return (
              <li key={n.key} className="absolute" style={{ left: b.x, top: b.y, width: b.w, height: b.h + g.noteHeight }}>
                <OriginCard
                  projectId={projectId}
                  node={n}
                  traced={trace?.nodes.has(n.key) ?? false}
                  focused={current === n.key}
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

/** The node's own mark decides its border (the design system's rule): dashed when open, faded when parked. */
const nodeState = (kind: MarkKind): Certainty | 'parked' =>
  kind === 'parked' || kind === 'confirmed' || kind === 'assumed' || kind === 'proposed' || kind === 'open' ? kind : 'unknown';

/** The lit trace: a 2px needs border on each of its nodes; the pointed one is also selected (its ring). */
const lit = (traced: boolean) =>
  traced ? '[&_.dm-node]:border-2 [&_.dm-node]:border-needs' : 'hover:[&_.dm-node]:border-line-strong';

/** An element of the tree: its Node, then its lines. */
const ELEMENT =
  'flex h-full w-full flex-col gap-1 text-left text-ink outline-none [&_.dm-node]:transition [&_.dm-node]:duration-100';

/** The lines under a node, aligned with its title and clear of the lines that run down a column. */
const NOTE = 'dm-text-caption flex min-w-0 flex-col pl-14 text-muted';

function OriginCard({
  projectId,
  node,
  traced,
  focused,
  onTrace,
}: {
  projectId: string;
  node: OriginNode;
  traced: boolean;
  focused: boolean;
  onTrace: () => void;
}) {
  const events = { onPointerEnter: onTrace, onFocus: onTrace, 'data-traced': traced ? 'true' : undefined };

  if (node.kind === 'start') {
    return (
      <div className={ELEMENT}>
        <div className="dm-node dm-faded">
          <span className="font-semibold">Not from a thread</span>
        </div>
        <span className={cn(NOTE, 'pl-3')}>
          <span className="truncate text-ink-3">What follows doesn’t come from a conversation.</span>
        </span>
      </div>
    );
  }

  if (node.kind === 'thread') {
    const e = node.exploration;
    const who = whoOf(e.opened_by);
    const state = stateWord('exploration', e.state);
    return (
      <Link
        to="/p/$projectId/threads/$explorationId"
        params={{ projectId, explorationId: e.id }}
        className={cn(ELEMENT, lit(traced))}
        {...events}
      >
        {/* The icon says what it is; the word is for whoever doesn't see it. */}
        <span className="sr-only">Thread</span>
        <Node
          type="thread"
          state={nodeState(state.mark)}
          mark={<Mark kind={state.mark} label={state.word} />}
          title={e.purpose}
          selected={focused}
        />
        <span className={NOTE}>
          <span className="truncate">
            {who.kind === 'you' ? 'you' : who.name}, {shortDate(e.created_at)}
            {node.parent ? ' · inside a thread' : ''}
          </span>
          {node.phrase && <Phrase text={node.phrase} />}
        </span>
      </Link>
    );
  }

  const row = node.row;
  const who = whoOf(row.updated_by);
  const n = node.version?.n ?? row.latest.n;
  const kind = EPISTEMIC_MARK[row.epistemic_status] ?? 'unknown';
  return (
    <Link
      to="/p/$projectId/records/$code"
      params={{ projectId, code: row.code }}
      className={cn(ELEMENT, lit(traced))}
      {...events}
    >
      <span className="sr-only">{TYPE_WORDS[row.type]}</span>
      <Node
        type={RECORD_TYPE[row.type] ?? 'feature'}
        state={nodeState(kind)}
        mark={<Mark kind={kind} />}
        title={row.title}
        trailing={row.type === 'fdr' ? <StageBars stage={row.readiness?.ready ? 'ready' : 'not-ready'} /> : undefined}
        selected={focused}
      />
      <span className={NOTE}>
        <span className="flex items-baseline gap-3">
          <span className="min-w-0 flex-1 truncate">
            {who.kind === 'you' ? 'you' : who.name}, {shortDate(row.updated_at)}
          </span>
          <Code className="shrink-0">
            {row.code} v{n}
          </Code>
        </span>
        {node.phrase && <Phrase text={node.phrase} />}
      </span>
    </Link>
  );
}

function Phrase({ text }: { text: string }) {
  return (
    <span className="truncate text-ink-3" title={text}>
      “{text}”
    </span>
  );
}

/** "Why does this exist?": the sentence of the trace, with its links, and the phrases along it. */
function WhyPanel({
  projectId,
  tree,
  traced,
  onClear,
}: {
  projectId: string;
  tree: OriginsTree;
  traced: string | null;
  onClear: () => void;
}) {
  const why = traced ? whyOf(tree, traced) : null;
  const panel = useRef<HTMLElement>(null);
  // A fixed height: tracing never moves the tree under the pointer.
  return (
    <section
      ref={panel}
      tabIndex={-1}
      aria-labelledby="why-title"
      className={cn(
        'outline-none',
        'sticky top-[68px] z-10 flex h-[120px] items-center justify-between gap-6 overflow-hidden rounded-card-md border bg-surface px-5 py-2.5 shadow-raised',
        why ? 'border-needs-ring' : 'border-line',
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="why-title" className={cn('dm-text-caption font-semibold', why ? 'text-needs-strong' : 'text-muted')}>
          Why does this exist?
        </h2>
        {why ? (
          <>
            <p className="dm-text-body line-clamp-2 leading-5" aria-live="polite">
              {why.sentence.map((s, i) => (
                <SegmentText key={`${i}-${s.text}`} projectId={projectId} segment={s} />
              ))}
            </p>
            {why.phrases.length > 0 ? (
              <ul className="flex flex-col">
                {why.phrases.slice(0, 2).map((p) => (
                  <li key={p.label} className="dm-text-small truncate text-ink-2" title={p.text}>
                    <span className="font-semibold text-muted">{p.label}:</span> “{p.text}”
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dm-text-small text-muted">No thread conclusion or change note says why yet.</p>
            )}
          </>
        ) : (
          <p className="dm-text-body text-ink-3">
            Point at a thread, a decision or a feature to trace where it comes from and why it exists.
          </p>
        )}
      </div>
      {why && (
        <Button
          variant="secondary"
          className="shrink-0"
          onClick={() => {
            // The button goes away with the trace: the focus stays on the panel.
            panel.current?.focus();
            onClear();
          }}
        >
          Clear trace
        </Button>
      )}
    </section>
  );
}

function SegmentText({ projectId, segment }: { projectId: string; segment: Segment }) {
  const to = segment.to;
  if (!to) return <>{segment.text}</>;
  const cls = 'font-semibold text-needs-strong underline underline-offset-2 hover:no-underline';
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
  const g = geometryFor(1360);
  const step = g.nodeHeight + g.noteHeight + g.gap;
  return (
    <div role="status" aria-label="Loading the origins" className="relative h-[420px]">
      {[0, 1, 2, 3].map((row) =>
        g.columns.map((c, col) =>
          col <= row % 3 || row === 0 ? (
            <div
              key={`${row}-${c.x}`}
              className="absolute flex flex-col gap-2"
              style={{ left: `${(c.x / g.width) * 100}%`, width: `${(c.w / g.width) * 100}%`, top: row * step }}
            >
              <div className="dm-node">
                <Skeleton className="h-3.5 w-4/5" />
              </div>
              <Skeleton className="ml-14 h-2.5 w-2/5" />
            </div>
          ) : null,
        ),
      )}
    </div>
  );
}
