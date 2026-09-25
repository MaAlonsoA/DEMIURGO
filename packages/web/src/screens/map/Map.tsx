// Product → Map (FDR-INT-002; canvas S2A, S3D and S3H): a canvas with one lane per area, features as
// cards and the rules they follow as nodes, the relations their links declare drawn between them,
// the questions waiting on the person and the parked ideas. Pointing lights up an element's
// connections; a click (or Enter) keeps it in the panel; −, 100%, + and Fit zoom.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProductRow } from '../../api/types.ts';
import { type MapRelation, type ProductMap, mapQuery } from '../../api/views.ts';
import { cn } from '../../lib/cn.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { buttonStyles } from '../../ui/Button.tsx';
import { Card, Detail, Node } from '../../ui/Card.tsx';
import { RECORD_ICON, TypeIcon } from '../../ui/icons.tsx';
import { EmptyState, Page, Skeleton } from '../../ui/layout.tsx';
import { MarkWord } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { StageBars } from '../../ui/signals.tsx';
import { EPISTEMIC_MARK, MARKS, TYPE_WORDS } from '../../words.ts';
import { rowStage } from '../record/logic.ts';
import { ProductTabs } from '../shell/Header.tsx';
import { connectedTo, lanesOf, relationStroke, relationWord, waitingOn } from './layout.ts';

const SCALES = [0.5, 0.6, 0.75, 0.9, 1, 1.15, 1.3];

export function MapScreen() {
  const projectId = useProjectId();
  const map = useQuery(mapQuery(projectId));
  const [selected, setSelected] = useState<string | null>(null);
  const [pointed, setPointed] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const data = map.data;
  const focus = pointed ?? selected;
  const lit = useMemo(() => (focus && data ? connectedTo(focus, data.relations) : null), [focus, data]);
  const record = selected ? data?.records.find((r) => r.code === selected) : undefined;

  const fit = () => {
    const v = viewport.current;
    const c = content.current;
    if (!v || !c) return;
    const natural = c.scrollWidth;
    const best = Math.min(1, (v.clientWidth - 16) / natural);
    setScale(Math.max(SCALES[0] ?? 0.5, Number(best.toFixed(2))));
  };
  const step = (dir: 1 | -1) =>
    setScale((s) => {
      const i = SCALES.findIndex((x) => x >= s - 0.001);
      const next = SCALES[Math.min(SCALES.length - 1, Math.max(0, (i < 0 ? SCALES.length - 1 : i) + dir))];
      return next ?? s;
    });

  return (
    <Page
      aside={
        record && data ? (
          <MapPanel projectId={projectId} row={record} map={data} onClose={() => setSelected(null)} />
        ) : (
          <MapLegend />
        )
      }
    >
      <ProductTabs active="map" />
      {map.error ? <Reasons error={map.error} /> : null}
      {map.isPending ? (
        <Skeleton className="h-[520px] w-full" />
      ) : !data || data.records.length === 0 ? (
        <EmptyState>Nothing on the map yet: records appear here as soon as the product has them.</EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-[13px] text-ink-2">
              {data.records.length} records in {data.areas.length} {data.areas.length === 1 ? 'area' : 'areas'} ·{' '}
              {data.relations.length} {data.relations.length === 1 ? 'relation' : 'relations'}
              {data.questions.length > 0 && (
                <span className="font-semibold text-needs">
                  {' '}
                  · {data.questions.length} {data.questions.length === 1 ? 'question waits' : 'questions wait'} on you
                </span>
              )}
            </p>
            <div role="group" aria-label="Zoom" className="flex items-center gap-1">
              <ZoomButton label="Zoom out" onClick={() => step(-1)}>
                −
              </ZoomButton>
              <button
                type="button"
                onClick={() => setScale(1)}
                aria-label="Actual size"
                className="h-7 min-w-14 rounded-md px-2 text-xs font-semibold text-ink-2 tabular-nums hover:bg-line-soft"
              >
                {Math.round(scale * 100)}%
              </button>
              <ZoomButton label="Zoom in" onClick={() => step(1)}>
                +
              </ZoomButton>
              <button
                type="button"
                onClick={fit}
                className="ml-1 h-7 rounded-md px-2 text-xs font-semibold text-ink-2 hover:bg-line-soft"
              >
                Fit
              </button>
            </div>
          </div>
          <div
            ref={viewport}
            data-map
            className="relative h-[calc(100vh-230px)] min-h-[420px] overflow-auto rounded-[var(--radius-panel)] border border-line bg-[radial-gradient(var(--color-line)_1px,transparent_1px)] [background-size:20px_20px]"
          >
            <div
              ref={content}
              data-map-scale={scale}
              style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}
              className="relative flex w-max gap-10 p-8"
            >
              <Lines map={data} contentRef={content} scale={scale} lit={lit} />
              {lanesOf(data).map((lane) => (
                <section
                  key={lane.area}
                  aria-label={`Area: ${lane.area}`}
                  data-lane={lane.area}
                  className="relative z-10 flex w-[290px] flex-col gap-3"
                >
                  <h2 className="border-b border-line pb-1.5 text-[13px] font-semibold tracking-[0.04em] text-ink-2 uppercase">
                    {lane.area}
                  </h2>
                  {lane.features.map((row) => (
                    <MapElement
                      key={row.code}
                      row={row}
                      map={data}
                      selected={selected === row.code}
                      dimmed={!!lit && !lit.has(row.code)}
                      onPoint={setPointed}
                      onSelect={setSelected}
                    />
                  ))}
                  {lane.rules.length > 0 && (
                    <h3 className="mt-2 text-xs font-semibold text-muted">
                      {lane.features.length > 0 ? 'Rules it follows' : 'Rules'}
                    </h3>
                  )}
                  {lane.rules.map((row) => (
                    <MapElement
                      key={row.code}
                      row={row}
                      map={data}
                      selected={selected === row.code}
                      dimmed={!!lit && !lit.has(row.code)}
                      onPoint={setPointed}
                      onSelect={setSelected}
                    />
                  ))}
                </section>
              ))}
              {data.ideas.length > 0 && (
                <section aria-label="Parked ideas" className="relative z-10 flex w-[260px] flex-col gap-3">
                  <h2 className="border-b border-dashed border-inactive pb-1.5 text-[13px] font-semibold tracking-[0.04em] text-muted uppercase">
                    Parked ideas
                  </h2>
                  {data.ideas.map((i) => (
                    <Link key={i.id} to="/p/$projectId/threads/$explorationId" params={{ projectId, explorationId: i.id }}>
                      <Node icon="idea" type="Idea" title={i.purpose} line="Parked" shape="faded" />
                    </Link>
                  ))}
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-line-strong bg-surface text-[15px] text-ink hover:border-ink-3"
    >
      {children}
    </button>
  );
}

function Status({ row }: { row: ProductRow }) {
  const kind = EPISTEMIC_MARK[row.epistemic_status] ?? 'unknown';
  return <MarkWord kind={kind} word={MARKS[kind].name} />;
}

function MapElement({
  row,
  map,
  selected,
  dimmed,
  onPoint,
  onSelect,
}: {
  row: ProductRow;
  map: ProductMap;
  selected: boolean;
  dimmed: boolean;
  onPoint: (code: string | null) => void;
  onSelect: (code: string | null) => void;
}) {
  const waiting = waitingOn(row.code, map.questions).length;
  const common = {
    icon: RECORD_ICON[row.type] ?? 'feature',
    type: TYPE_WORDS[row.type] ?? row.type,
    title: row.title,
    code: row.code,
    dimmed,
    shape: selected ? ('selected' as const) : row.epistemic_status === 'confirmed' ? ('solid' as const) : ('dashed' as const),
    ...(waiting > 0
      ? { needs: waiting, needsDetail: `${waiting} ${waiting === 1 ? 'question waits' : 'questions wait'} on you` }
      : {}),
  };
  return (
    <button
      type="button"
      data-map-node={row.code}
      aria-pressed={selected}
      aria-label={`${TYPE_WORDS[row.type] ?? row.type}: ${row.title} (${row.code})`}
      onMouseEnter={() => onPoint(row.code)}
      onMouseLeave={() => onPoint(null)}
      onFocus={() => onPoint(row.code)}
      onBlur={() => onPoint(null)}
      onClick={() => onSelect(selected ? null : row.code)}
      className="block w-full rounded-[var(--radius-card)] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needs"
    >
      {row.type === 'fdr' ? (
        <Card
          {...common}
          status={<Status row={row} />}
          bars={<StageBars stage={rowStage(row)} />}
          line={row.summary}
          signals={
            row.checks > 0 ? (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <TypeIcon kind="check" size={13} />
                {row.checks}
              </span>
            ) : undefined
          }
          who={<span className="font-mono text-[11px]">{row.code}</span>}
          className="min-h-[120px]"
        />
      ) : (
        <Node {...common} status={<Status row={row} />} />
      )}
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
  contentRef: React.RefObject<HTMLDivElement | null>;
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
        d = `M${a.right} ${ay} C${mid} ${ay} ${mid} ${by} ${b.left} ${by}`;
      } else if (a.left >= b.right) {
        const mid = (b.right + a.left) / 2;
        d = `M${a.left} ${ay} C${mid} ${ay} ${mid} ${by} ${b.right} ${by}`;
      } else {
        // Same lane: a curve along the right side.
        const x = Math.max(a.right, b.right);
        d = `M${a.right} ${ay} C${x + 36} ${ay} ${x + 36} ${by} ${b.right} ${by}`;
      }
      out.push({ key: `${rel.from}-${rel.to}-${i}`, d, relation: rel });
    }
    setSegments(out);
    setSize({ w: c.offsetWidth, h: c.offsetHeight });
  }, [map, contentRef, scale]);

  // A passive effect, not a layout one: the parent's ref is attached after its children's layout
  // effects run, so only now is the content there to measure.
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
      {segments.map((s) => {
        const stroke = relationStroke(s.relation);
        const on = !lit || (lit.has(s.relation.from) && lit.has(s.relation.to));
        return (
          <path
            key={s.key}
            d={s.d}
            data-relation={s.relation.kind}
            fill="none"
            stroke={stroke.color}
            strokeWidth={on && lit ? stroke.width + 0.75 : stroke.width}
            strokeDasharray={stroke.dash}
            opacity={on ? 1 : 0.15}
          />
        );
      })}
    </svg>
  );
}

function LegendLine({ kind, label }: { kind: MapRelation['kind']; label: string }) {
  const s = relationStroke({ from: '', to: '', kind, link: '', under_review: false });
  return (
    <li className="flex items-center gap-2 text-[13px] text-ink-2">
      <svg width="36" height="8" aria-hidden="true">
        <path d="M1 4 H35" stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash} />
      </svg>
      {label}
    </li>
  );
}

function MapLegend() {
  return (
    <section aria-labelledby="map-legend" className="flex flex-col gap-3">
      <h2 id="map-legend" className="text-[13px] font-semibold text-ink-2">
        How to read the map
      </h2>
      <p className="text-[13px] text-ink-3">
        One column per area. Features are cards; the decisions they follow are below them. Point at something to light up what it
        is connected to; click it to see it here.
      </p>
      <ul className="flex flex-col gap-1.5">
        <LegendLine kind="needs" label="Needs another feature" />
        <LegendLine kind="follows" label="Follows a rule" />
        <LegendLine kind="conflicts" label="Conflicts" />
        <LegendLine kind="affects" label="Affects (derived from)" />
      </ul>
      <p className="text-xs text-muted">Only the links the records declare are drawn: nothing is guessed.</p>
    </section>
  );
}

function MapPanel({
  projectId,
  row,
  map,
  onClose,
}: {
  projectId: string;
  row: ProductRow;
  map: ProductMap;
  onClose: () => void;
}) {
  const title = (code: string) => map.records.find((r) => r.code === code)?.title ?? code;
  const out = map.relations.filter((r) => r.from === row.code);
  const inbound = map.relations.filter((r) => r.to === row.code);
  const groups = new Map<string, string[]>();
  for (const r of out) groups.set(relationWord(r.kind, 'from'), [...(groups.get(relationWord(r.kind, 'from')) ?? []), r.to]);
  for (const r of inbound) groups.set(relationWord(r.kind, 'to'), [...(groups.get(relationWord(r.kind, 'to')) ?? []), r.from]);
  const waiting = waitingOn(row.code, map.questions);
  return (
    <section data-map-panel aria-label={`Selected: ${row.title}`} className="flex flex-col gap-4">
      <Detail
        icon={RECORD_ICON[row.type] ?? 'feature'}
        type={TYPE_WORDS[row.type] ?? row.type}
        status={<Status row={row} />}
        {...(row.type === 'fdr' ? { bars: <StageBars stage={rowStage(row)} /> } : {})}
        code={`${row.code} · v${row.current ?? row.latest.n}`}
        title={row.title}
        line={row.summary}
        actions={
          <>
            <button type="button" onClick={onClose} className={buttonStyles({ variant: 'ghost', size: 'sm' })}>
              Close
            </button>
            <Link
              to="/p/$projectId/records/$code"
              params={{ projectId, code: row.code }}
              className={buttonStyles({ variant: 'ink', size: 'sm' })}
            >
              Open
            </Link>
          </>
        }
      />
      {row.origin_exploration && (
        <PanelBlock title="Comes from">
          <Link
            to="/p/$projectId/threads/$explorationId"
            params={{ projectId, explorationId: row.origin_exploration }}
            className="text-[13px] font-medium text-ink underline-offset-2 hover:underline"
          >
            Its thread
          </Link>
        </PanelBlock>
      )}
      {[...groups.entries()].map(([word, codes]) => (
        <PanelBlock key={word} title={word}>
          <ul className="flex flex-col gap-1">
            {codes.map((c) => (
              <li key={c}>
                <Link
                  to="/p/$projectId/records/$code"
                  params={{ projectId, code: c }}
                  className="flex items-baseline gap-2 text-[13px] text-ink underline-offset-2 hover:underline"
                >
                  {title(c)} <span className="font-mono text-[11px] text-muted">{c}</span>
                </Link>
              </li>
            ))}
          </ul>
        </PanelBlock>
      ))}
      {waiting.length > 0 && (
        <PanelBlock title="Waiting on you" tone="needs">
          <ul className="flex flex-col gap-2">
            {waiting.map((q) => (
              <li key={q.id} className="flex items-start justify-between gap-3 text-[13px]">
                <span className="text-ink">{q.question}</span>
                <Link
                  to="/p/$projectId/threads/$explorationId"
                  params={{ projectId, explorationId: q.exploration_id }}
                  className={buttonStyles({ variant: 'needs', size: 'sm' })}
                >
                  Answer
                </Link>
              </li>
            ))}
          </ul>
        </PanelBlock>
      )}
      {row.type === 'fdr' && (
        <PanelBlock title="How we'll know it works">
          <p className="text-[13px] text-ink-2">
            {row.checks} {row.checks === 1 ? 'check' : 'checks'} · none has run: nothing is built yet.
          </p>
        </PanelBlock>
      )}
    </section>
  );
}

function PanelBlock({ title, tone, children }: { title: string; tone?: 'needs'; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-line-soft pt-3">
      <h3 className={cn('text-xs font-semibold', tone === 'needs' ? 'text-needs' : 'text-muted')}>{title}</h3>
      {children}
    </div>
  );
}
