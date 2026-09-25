// Product → Map (DESIGN.md §3.7, FDR-INT-002): one lane per area with its features as cards and the
// rules they follow below them, the relations their links declare drawn between them, what waits on
// the person and the parked ideas. Pointing or focusing lights an element's connections without
// dimming anything else (contrast stays whole); a click or Enter keeps it selected in the side panel,
// Esc clears it. Zoom has buttons and keys (+, −, 0), the canvas scrolls with the arrow keys, and the
// legend is always visible and names every line style, "under review" included (INV-MAP-01…13).

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type KeyboardEvent, type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { projectsQuery } from '../../api/queries.ts';
import type { ProductRow } from '../../api/types.ts';
import { type MapRelation, type ProductMap, mapQuery } from '../../api/views.ts';
import { announce } from '../../components/announce.tsx';
import { Code, Count } from '../../components/Badge.tsx';
import { Button, IconButton, buttonClass } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ArrowRightIcon, ChecksIcon, CloseIcon, MapIcon, PlusIcon, ProductIcon } from '../../components/icons.tsx';
import { Readiness } from '../../components/Meter.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, WithAside, usePageTitle } from '../../components/Page.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { Certainty, EntityState, StateIcon, StatusBadge } from '../../components/status.tsx';
import { RelativeTime } from '../../components/Time.tsx';
import { TypeIcon, typeWord } from '../../components/types.tsx';
import { Who } from '../../components/Who.tsx';
import { cn } from '../../lib/cn.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { ProductTabs } from '../../shell/ProductTabs.tsx';
import { EPISTEMIC_MARK, MARKS } from '../../words.ts';
import { rowStage } from '../record/logic.ts';
import { LINE_STYLES, RELATION_KINDS, UNDER_REVIEW, connectedTo, lanesOf, relationWord, waitingOn } from './layout.ts';

const SCALES = [0.5, 0.6, 0.75, 0.9, 1, 1.15, 1.3];
const MIN_SCALE = SCALES[0] ?? 0.5;
const MAX_SCALE = SCALES.at(-1) ?? 1.3;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function MapScreen() {
  const projectId = useProjectId();
  const map = useQuery(mapQuery(projectId));
  const project = (useQuery(projectsQuery).data ?? []).find((p) => p.id === projectId);
  usePageTitle(['Map', project?.name]);
  const data = map.data;
  const [selected, setSelected] = useState<string | null>(null);
  const [pointed, setPointed] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  // A selection that the live data no longer has is dropped.
  const record = selected ? data?.records.find((r) => r.code === selected) : undefined;
  useEffect(() => {
    if (selected && data && !record) setSelected(null);
  }, [selected, data, record]);

  const focus = pointed ?? selected;
  const lit = useMemo(() => (focus && data ? connectedTo(focus, data.relations) : null), [focus, data]);

  const select = (code: string | null) => {
    setSelected(code);
    const row = code ? data?.records.find((r) => r.code === code) : undefined;
    announce(row ? `Selected ${row.title}. Its connections are in the side panel.` : 'Selection cleared.');
  };
  const clear = () => {
    const code = selected;
    select(null);
    if (code) document.querySelector<HTMLElement>(`[data-map-node="${CSS.escape(code)}"]`)?.focus();
  };

  const step = (dir: 1 | -1) =>
    setScale((s) => {
      const i = SCALES.findIndex((x) => x >= s - 0.001);
      const next = SCALES[Math.min(SCALES.length - 1, Math.max(0, (i < 0 ? SCALES.length - 1 : i) + dir))];
      return next ?? s;
    });
  const fit = () => {
    const v = viewport.current;
    const c = content.current;
    if (!v || !c) return;
    const best = (v.clientWidth - 16) / c.offsetWidth;
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(best.toFixed(2)))));
  };

  // Keys of the map, wherever the focus is inside it (never while typing): + and − zoom, 0 goes
  // back to actual size, Esc clears the selection.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (e.ctrlKey || e.metaKey || e.altKey || t.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (e.key === '+' || e.key === '=') step(1);
    else if (e.key === '-' || e.key === '_' || e.key === '−') step(-1);
    else if (e.key === '0') setScale(1);
    else if (e.key === 'Escape' && selected) clear();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const hasContent = !!data && (data.records.length > 0 || data.ideas.length > 0);

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <ProductIcon size={15} className="text-fg-3" />
            <span>{project?.name ?? 'Product'}</span>
          </>
        }
        title="Map"
        meta={data ? <Summary map={data} /> : 'Each area with its features, the rules they follow and how they connect.'}
        tabs={<ProductTabs active="map" />}
      />
      <PageBody width="full">
        {map.error ? (
          <ErrorNotice error={map.error} onRetry={() => void map.refetch()} />
        ) : map.isPending ? (
          <MapSkeleton />
        ) : !hasContent || !data ? (
          <EmptyState icon={<MapIcon size={28} />} title="Nothing on the map yet" size="spacious">
            Records appear here as soon as the product has them.
          </EmptyState>
        ) : (
          // The keys of the map are heard anywhere inside it: the canvas, the toolbar and the side panel.
          <div onKeyDown={onKey}>
            <WithAside
              asideLabel="Map details"
              asideWidth="lg"
              aside={
                <>
                  {record ? (
                    <MapPanel projectId={projectId} row={record} map={data} onClear={clear} />
                  ) : (
                    <p className="rounded-lg border border-dashed border-edge-strong px-4 py-3 text-sm text-fg-2">
                      Select a feature or a rule to see what it is connected to, where it comes from and what waits on you.
                    </p>
                  )}
                  <MapLegend />
                </>
              }
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-fg-2">
                    Point at something to light up what it is connected to; select it to keep it in the side panel.
                  </p>
                  <ZoomControls
                    scale={scale}
                    onOut={() => step(-1)}
                    onIn={() => step(1)}
                    onActual={() => setScale(1)}
                    onFit={fit}
                  />
                </div>
                <Canvas
                  projectId={projectId}
                  map={data}
                  scale={scale}
                  selected={selected}
                  lit={lit}
                  viewport={viewport}
                  content={content}
                  onPoint={setPointed}
                  onSelect={(code) => select(code === selected ? null : code)}
                />
              </div>
            </WithAside>
          </div>
        )}
      </PageBody>
    </>
  );
}

/** "12 records in 4 areas · 9 relations · 2 questions wait on you" (INV-MAP-02). */
function Summary({ map }: { map: ProductMap }) {
  const waiting = map.questions.length;
  return (
    <>
      <span>
        {plural(map.records.length, 'record', 'records')} in {plural(map.areas.length, 'area', 'areas')} ·{' '}
        {plural(map.relations.length, 'relation', 'relations')}
      </span>
      {waiting > 0 ? (
        <span className="font-medium text-accent-text">{plural(waiting, 'question waits', 'questions wait')} on you</span>
      ) : null}
    </>
  );
}

function ZoomControls({
  scale,
  onOut,
  onIn,
  onActual,
  onFit,
}: {
  scale: number;
  onOut: () => void;
  onIn: () => void;
  onActual: () => void;
  onFit: () => void;
}) {
  const pct = Math.round(scale * 100);
  return (
    <div role="group" aria-label="Zoom" className="flex items-center gap-1 rounded-md border border-edge bg-panel p-0.5">
      <IconButton label="Zoom out" size="sm" aria-keyshortcuts="-" onClick={onOut} disabled={scale <= MIN_SCALE}>
        <span aria-hidden className="text-lg leading-none">
          −
        </span>
      </IconButton>
      <Button
        size="sm"
        variant="quiet"
        aria-label={`${pct}%: back to actual size`}
        aria-keyshortcuts="0"
        onClick={onActual}
        className="min-w-14 tabular-nums"
      >
        {pct}%
      </Button>
      <IconButton label="Zoom in" size="sm" aria-keyshortcuts="+" onClick={onIn} disabled={scale >= MAX_SCALE}>
        <PlusIcon size={15} />
      </IconButton>
      <span aria-hidden className="mx-0.5 h-4 w-px bg-edge" />
      <Button size="sm" variant="quiet" onClick={onFit}>
        Fit
      </Button>
    </div>
  );
}

function Canvas({
  projectId,
  map,
  scale,
  selected,
  lit,
  viewport,
  content,
  onPoint,
  onSelect,
}: {
  projectId: string;
  map: ProductMap;
  scale: number;
  selected: string | null;
  lit: Set<string> | null;
  viewport: RefObject<HTMLDivElement | null>;
  content: RefObject<HTMLDivElement | null>;
  onPoint: (code: string | null) => void;
  onSelect: (code: string) => void;
}) {
  // The content is scaled with a transform; the sizer gives the scroll area the scaled size.
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const c = content.current;
    if (!c) return;
    const measure = () => setNatural({ w: c.offsetWidth, h: c.offsetHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(c);
    return () => observer.disconnect();
  }, [content]);

  const element = (row: ProductRow) => (
    <MapElement
      key={row.code}
      row={row}
      map={map}
      selected={selected === row.code}
      lit={!!lit && lit.has(row.code)}
      onPoint={onPoint}
      onSelect={onSelect}
    />
  );

  return (
    <div
      ref={viewport}
      data-map
      role="region"
      aria-label="Map canvas: arrow keys scroll it"
      tabIndex={0}
      className="relative h-[calc(100vh-290px)] min-h-[420px] overflow-auto rounded-lg border border-edge bg-sunken"
      style={{ backgroundImage: 'radial-gradient(var(--c-edge-strong) 1px, transparent 1px)', backgroundSize: '20px 20px' }}
    >
      <div style={{ width: natural.w * scale || undefined, height: natural.h * scale || undefined }}>
        <div
          ref={content}
          data-map-scale={scale}
          style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}
          className="relative flex w-max items-start gap-10 p-8"
        >
          <Lines map={map} contentRef={content} scale={scale} lit={lit} />
          {lanesOf(map).map((lane) => (
            <section
              key={lane.area}
              aria-label={`Area: ${lane.area}`}
              data-lane={lane.area}
              className="relative z-10 flex w-[300px] flex-col gap-2.5"
            >
              <h2 className="flex items-center justify-between gap-2 border-b border-edge-strong pb-1.5 text-sm font-semibold text-fg">
                <span className="truncate">{lane.area}</span>
                <span className="text-xs font-normal text-fg-3 tabular-nums">
                  {plural(lane.features.length + lane.rules.length, 'record', 'records')}
                </span>
              </h2>
              {lane.features.map(element)}
              {lane.rules.length > 0 ? (
                <h3 className="mt-2 text-xs font-medium text-fg-2">{lane.features.length > 0 ? 'Rules it follows' : 'Rules'}</h3>
              ) : null}
              {lane.rules.map(element)}
            </section>
          ))}
          {map.ideas.length > 0 ? (
            <section aria-label="Parked ideas" className="relative z-10 flex w-[260px] flex-col gap-2.5">
              <h2 className="border-b border-dashed border-edge-strong pb-1.5 text-sm font-semibold text-fg-2">Parked ideas</h2>
              {map.ideas.map((i) => (
                <Link
                  key={i.id}
                  to="/p/$projectId/threads/$explorationId"
                  params={{ projectId, explorationId: i.id }}
                  data-map-idea={i.id}
                  className="flex items-start gap-2 rounded-md border border-dashed border-edge-strong bg-panel px-2.5 py-2 text-sm text-fg hover:border-edge-control"
                >
                  <TypeIcon type="idea" size={15} className="mt-0.5 shrink-0 text-fg-3" />
                  <span className="min-w-0 flex-1">
                    <span className="sr-only">Parked idea: </span>
                    {i.purpose}
                  </span>
                  <StatusBadge kind="parked" />
                </Link>
              ))}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MapElement({
  row,
  map,
  selected,
  lit,
  onPoint,
  onSelect,
}: {
  row: ProductRow;
  map: ProductMap;
  selected: boolean;
  lit: boolean;
  onPoint: (code: string | null) => void;
  onSelect: (code: string) => void;
}) {
  const waiting = waitingOn(row.code, map.questions).length;
  const certainty = MARKS[EPISTEMIC_MARK[row.epistemic_status] ?? 'unknown'].name;
  const feature = row.type === 'fdr';
  const stage = rowStage(row);
  const stageWord = stage === 'ready' ? 'Ready to build' : stage === 'doubt' ? 'In doubt' : 'Not ready';
  const name = [
    `${typeWord(row.type)}: ${row.title} (${row.code})`,
    certainty,
    feature ? stageWord : null,
    waiting > 0 ? `${plural(waiting, 'question waits', 'questions wait')} on you` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const frame = cn(
    'w-full cursor-pointer rounded-lg border bg-panel text-left transition-colors duration-[var(--m-fast)]',
    selected
      ? 'border-accent bg-accent-soft ring-1 ring-accent'
      : lit
        ? 'border-accent-edge bg-accent-soft'
        : 'border-edge hover:border-edge-control',
  );
  const events = {
    'data-map-node': row.code,
    'data-lit': lit ? 'true' : undefined,
    'aria-pressed': selected,
    'aria-label': name,
    onMouseEnter: () => onPoint(row.code),
    onMouseLeave: () => onPoint(null),
    onFocus: () => onPoint(row.code),
    onBlur: () => onPoint(null),
    onClick: () => onSelect(row.code),
  };
  if (feature) {
    return (
      <button type="button" {...events} className={cn(frame, 'flex flex-col gap-2 p-3')}>
        <span className="flex items-center gap-1.5 text-xs text-fg-2">
          <TypeIcon type="fdr" size={14} className="text-fg-3" />
          Feature
          <span className="ml-auto">
            <Count n={waiting} label={`${plural(waiting, 'question waits', 'questions wait')} on you`} />
          </span>
        </span>
        <span className="line-clamp-2 text-base font-medium text-fg">{row.title}</span>
        {row.summary ? <span className="line-clamp-2 text-sm text-fg-2">{row.summary}</span> : null}
        <span className="flex flex-wrap items-center gap-1.5">
          <Certainty status={row.epistemic_status} />
          <Readiness stage={stage} track={false} />
        </span>
        <span className="flex items-center gap-2 text-xs text-fg-3">
          <Who actor={row.updated_by} size={16} className="min-w-0" />
          <RelativeTime iso={row.updated_at} className="shrink-0" />
          {row.checks > 0 ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1">
              <ChecksIcon size={13} />
              {plural(row.checks, 'check', 'checks')}
            </span>
          ) : null}
        </span>
      </button>
    );
  }
  return (
    <button type="button" {...events} className={cn(frame, 'flex items-center gap-2 px-2.5 py-2')}>
      <TypeIcon type={row.type} size={15} className="shrink-0 text-fg-3" />
      <span className="line-clamp-2 min-w-0 flex-1 text-sm text-fg">{row.title}</span>
      <StateIcon kind={EPISTEMIC_MARK[row.epistemic_status] ?? 'unknown'} size={14} />
      <Count n={waiting} label={`${plural(waiting, 'question waits', 'questions wait')} on you`} />
    </button>
  );
}

type Segment = { key: string; d: string; relation: MapRelation };

/** The relations as lines, measured over the elements in the content's own (unscaled) coordinates. */
function Lines({
  map,
  contentRef,
  scale,
  lit,
}: {
  map: ProductMap;
  contentRef: RefObject<HTMLDivElement | null>;
  scale: number;
  lit: Set<string> | null;
}) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const measure = useCallback(() => {
    const c = contentRef.current;
    if (!c) return;
    const box = c.getBoundingClientRect();
    const rect = (code: string) => {
      const el = c.querySelector<HTMLElement>(`[data-map-node="${CSS.escape(code)}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: (r.left - box.left) / scale,
        right: (r.right - box.left) / scale,
        top: (r.top - box.top) / scale,
        bottom: (r.bottom - box.top) / scale,
      };
    };
    const out: Segment[] = [];
    for (const [i, rel] of map.relations.entries()) {
      const a = rect(rel.from);
      const b = rect(rel.to);
      if (!a || !b) continue;
      const ay = (a.top + a.bottom) / 2;
      const by = (b.top + b.bottom) / 2;
      let d: string;
      if (b.left >= a.right) {
        const mid = (a.right + b.left) / 2;
        d = `M${a.right} ${ay} C${mid} ${ay} ${mid} ${by} ${b.left - 2} ${by}`;
      } else if (a.left >= b.right) {
        const mid = (b.right + a.left) / 2;
        d = `M${a.left} ${ay} C${mid} ${ay} ${mid} ${by} ${b.right + 2} ${by}`;
      } else {
        // Same lane: a loop along the right side.
        const x = Math.max(a.right, b.right);
        d = `M${a.right} ${ay} C${x + 36} ${ay} ${x + 36} ${by} ${b.right + 2} ${by}`;
      }
      out.push({ key: `${rel.from}-${rel.to}-${i}`, d, relation: rel });
    }
    setSegments(out);
    setSize({ w: c.offsetWidth, h: c.offsetHeight });
  }, [map, contentRef, scale]);

  // A passive effect: the parent's ref is attached after its children's layout effects run, so only
  // now is the content there to measure.
  useEffect(() => {
    const frame = requestAnimationFrame(measure);
    const c = contentRef.current;
    if (!c || typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(frame);
    const observer = new ResizeObserver(() => measure());
    observer.observe(c);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [measure, contentRef]);

  return (
    <svg
      aria-hidden="true"
      data-map-lines
      width={size.w}
      height={size.h}
      className="pointer-events-none absolute top-0 left-0 z-0 overflow-visible"
    >
      <Arrowheads />
      {segments.map((s) => {
        const style = LINE_STYLES[s.relation.kind];
        const on = !lit || (lit.has(s.relation.from) && lit.has(s.relation.to));
        const strong = on && !!lit;
        return (
          <g
            key={s.key}
            opacity={on ? 1 : 0.2}
            data-relation={s.relation.kind}
            data-under-review={s.relation.under_review || undefined}
          >
            {s.relation.under_review ? (
              <path
                d={s.d}
                fill="none"
                className={UNDER_REVIEW.stroke}
                strokeWidth={UNDER_REVIEW.width}
                strokeOpacity={UNDER_REVIEW.opacity}
                strokeLinecap="round"
              />
            ) : null}
            <path
              d={s.d}
              data-relation={s.relation.kind}
              fill="none"
              className={style.stroke}
              strokeWidth={strong ? style.width + 1 : style.width}
              strokeDasharray={style.dash}
              strokeLinecap="round"
              markerEnd={`url(#map-arrow-${s.relation.kind})`}
            />
          </g>
        );
      })}
    </svg>
  );
}

/** One arrowhead per kind of relation: lines say which way they point (from → to). */
function Arrowheads() {
  return (
    <defs>
      {RELATION_KINDS.map((k) => (
        <marker
          key={k}
          id={`map-arrow-${k}`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path d="M0 1 L10 5 L0 9 z" className={LINE_STYLES[k].fill} />
        </marker>
      ))}
    </defs>
  );
}

function LegendSample({ kind, review }: { kind: MapRelation['kind']; review?: boolean }) {
  const s = LINE_STYLES[kind];
  return (
    <svg width="44" height="12" aria-hidden="true" className="shrink-0 overflow-visible">
      {review ? (
        <path
          d="M2 6 H40"
          className={UNDER_REVIEW.stroke}
          strokeWidth={UNDER_REVIEW.width}
          strokeOpacity={UNDER_REVIEW.opacity}
          strokeLinecap="round"
        />
      ) : null}
      <path d="M2 6 H36" fill="none" className={s.stroke} strokeWidth={s.width} strokeDasharray={s.dash} strokeLinecap="round" />
      <path d="M36 2.5 L43 6 L36 9.5 z" className={s.fill} />
    </svg>
  );
}

/** The legend (INV-MAP-10): always visible, beside the canvas, with every line style named. */
function MapLegend() {
  return (
    <section aria-labelledby="map-legend" className="flex flex-col gap-3 rounded-lg border border-edge bg-panel p-4">
      <h2 id="map-legend" className="text-base font-semibold text-fg">
        How to read the map
      </h2>
      <p className="text-sm text-fg-2">
        One column per area. Features are cards; the decisions they follow are below them. Point at something to light up what it
        is connected to; select it to see it here.
      </p>
      <ul className="flex flex-col gap-2 text-sm text-fg">
        {RELATION_KINDS.map((k) => (
          <li key={k} className="flex items-center gap-2.5" data-legend={k}>
            <LegendSample kind={k} />
            {LINE_STYLES[k].label}
          </li>
        ))}
        <li className="flex items-center gap-2.5" data-legend="under-review">
          <LegendSample kind="needs" review />
          {UNDER_REVIEW.label}
        </li>
      </ul>
      <p className="text-xs text-fg-3">Only the links the records declare are drawn: nothing is guessed.</p>
      <p className="text-xs text-fg-3">
        Keys: <Kbd>+</Kbd> and <Kbd>−</Kbd> zoom, <Kbd>0</Kbd> actual size, arrows scroll the canvas, <Kbd>Esc</Kbd> clears the
        selection.
      </p>
    </section>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-xs border border-edge bg-sunken px-1 font-ui text-xs text-fg-2">{children}</kbd>;
}

/** The selection (INV-MAP-09): what it is, where it comes from, what it connects to, what waits. */
function MapPanel({
  projectId,
  row,
  map,
  onClear,
}: {
  projectId: string;
  row: ProductRow;
  map: ProductMap;
  onClear: () => void;
}) {
  const title = (code: string) => map.records.find((r) => r.code === code)?.title ?? code;
  const groups = new Map<string, string[]>();
  const add = (word: string, code: string) => groups.set(word, [...(groups.get(word) ?? []), code]);
  for (const r of map.relations) {
    if (r.from === row.code) add(relationWord(r.kind, 'from'), r.to);
    if (r.to === row.code) add(relationWord(r.kind, 'to'), r.from);
  }
  const review = new Set(
    map.relations.filter((r) => r.under_review && (r.from === row.code || r.to === row.code)).flatMap((r) => [r.from, r.to]),
  );
  const waiting = waitingOn(row.code, map.questions);
  const feature = row.type === 'fdr';
  return (
    <section
      data-map-panel
      aria-label={`Selected: ${row.title}`}
      className="flex flex-col gap-4 rounded-lg border border-accent-edge bg-panel p-4"
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
          <TypeIcon type={row.type} size={15} className="text-fg-3" />
          {typeWord(row.type)}
          <Certainty status={row.epistemic_status} />
          {feature ? <Readiness stage={rowStage(row)} /> : null}
        </div>
        <h2 className="text-lg font-semibold text-fg">{row.title}</h2>
        <Code>
          {row.code} · v{row.current ?? row.latest.n}
        </Code>
        {row.summary ? <p className="text-sm text-fg-2">{row.summary}</p> : null}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Link
            to="/p/$projectId/records/$code"
            params={{ projectId, code: row.code }}
            className={buttonClass({ variant: 'secondary', size: 'sm' })}
          >
            Open
            <ArrowRightIcon size={14} />
          </Link>
          <Button size="sm" variant="quiet" icon={<CloseIcon size={14} />} onClick={onClear} kbd="Esc">
            Clear selection
          </Button>
        </div>
      </div>
      {row.origin_exploration ? (
        <PanelBlock title="Comes from">
          <Link
            to="/p/$projectId/threads/$explorationId"
            params={{ projectId, explorationId: row.origin_exploration }}
            className="text-sm font-medium text-accent-text underline-offset-2 hover:underline"
          >
            Its thread
          </Link>
        </PanelBlock>
      ) : null}
      {[...groups.entries()].map(([word, codes]) => (
        <PanelBlock key={word} title={word}>
          <ul className="flex flex-col gap-1.5">
            {codes.map((c) => (
              <li key={c} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <Link
                  to="/p/$projectId/records/$code"
                  params={{ projectId, code: c }}
                  className="flex min-w-0 items-baseline gap-2 text-sm text-fg underline-offset-2 hover:text-accent-text hover:underline"
                >
                  <span className="min-w-0">{title(c)}</span>
                  <Code className="shrink-0">{c}</Code>
                </Link>
                {review.has(c) ? <EntityState entity="link" state="needs_review" /> : null}
              </li>
            ))}
          </ul>
        </PanelBlock>
      ))}
      {waiting.length > 0 ? (
        <PanelBlock title="Waiting on you">
          <ul className="flex flex-col gap-2">
            {waiting.map((q) => (
              <li key={q.id} className="flex items-start justify-between gap-3 text-sm">
                <span className="text-fg">{q.question}</span>
                <Link
                  to="/p/$projectId/threads/$explorationId"
                  params={{ projectId, explorationId: q.exploration_id }}
                  className={buttonClass({ variant: 'secondary', size: 'sm' })}
                >
                  Answer
                </Link>
              </li>
            ))}
          </ul>
        </PanelBlock>
      ) : null}
      {feature ? (
        <PanelBlock title="How we'll know it works">
          <p className="text-sm text-fg-2">{plural(row.checks, 'check', 'checks')} · none has run: nothing is built yet.</p>
        </PanelBlock>
      ) : null}
    </section>
  );
}

function PanelBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-edge-subtle pt-3">
      <h3 className="text-xs font-medium text-fg-2">{title}</h3>
      {children}
    </div>
  );
}

function MapSkeleton() {
  return (
    <Skeleton label="Loading the map" className="flex gap-8">
      {[0, 1, 2].map((lane) => (
        <div key={lane} className="flex w-[300px] flex-col gap-2.5">
          <Bone className="h-4 w-28" />
          <Bone className="h-32 w-full rounded-lg" />
          <Bone className="h-24 w-full rounded-lg" />
          <Bone className="h-9 w-full rounded-md" />
        </div>
      ))}
    </Skeleton>
  );
}
