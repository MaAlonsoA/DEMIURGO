// «Lanes» of the Build page: what the queue did over the last hours. One row per task, one bar per attempt,
// each bar split into its stages (filled = work, hollow = waiting for CI); a red mark where an attempt ended
// badly, a triangle where it merged, a line for «main» and one for «now». A bar is a button: choosing it shows
// that attempt's path below. Inline SVG with the semantic tokens only; it scrolls sideways inside its own box.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { TextInput } from "../../components/Field.tsx";
import { cn } from "../../lib/cn.ts";
import { useLocale } from "../../i18n/locale.ts";
import type { BuildTimeline, TimelineAttempt, TimelineRequest, TimelineSegment } from "../../api/types.ts";
import {
  CHART_TAIL,
  MAX_PX_PER_MIN,
  type Selection,
  clampPx,
  compact,
  filterRows,
  fitPx,
  fitRange,
  ms,
  reviewOverlapsCi,
  rowWindow,
  sharesLine,
  ticksOf,
  visibleRange,
  windowOf,
  zoomScroll,
} from "./timelineLogic.ts";
import { ForensicDot, LaneForensicMark } from "./ForensicStep.tsx";
import type { BUILD } from "./words.i18n.ts";

type Words = typeof BUILD.en;

const HEAD_H = 26;
const ROW_H = 48;
/** The bars are drawn in a 40-high lane centred in the row. */
const LANE_H = 40;
const LANE_PAD = (ROW_H - LANE_H) / 2;
const MAIN_H = 40;
const LABEL_W = 176;
const MIN_PX = 1.5;

/** Bar geometry per kind: [offset from the row top, height]. */
const GEOMETRY: Record<TimelineSegment["kind"], [number, number]> = {
  builder: [12, 16],
  prep: [16, 8],
  light: [16, 8],
  review: [14, 12],
  wait: [12, 16],
  main: [15, 10],
};

/** While CI and review overlap they share the lane: CI in the upper half, review in the lower (trace waterfall of Jaeger: overlapping spans stacked, not painted over each other). */
const SPLIT_CI: [number, number] = [11, 8];
const SPLIT_REVIEW: [number, number] = [21, 8];

function segmentClass(seg: TimelineSegment): string {
  const live = seg.outcome === "running";
  switch (seg.kind) {
    case "builder":
      return live ? "fill-info" : "fill-fg";
    case "prep":
      return live ? "fill-info" : "fill-edge-strong";
    case "light":
    case "review":
      return live ? "fill-info" : "fill-fg-3";
    case "wait":
      return cn("fill-none", live ? "stroke-info" : "stroke-edge-control");
    case "main":
      return cn("fill-none", live ? "stroke-info" : "stroke-edge-control");
  }
}

const timeFormat = (locale: string) => new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-GB", { hour: "2-digit", minute: "2-digit" });

function Attempt({
  request,
  attempt,
  row,
  x,
  selected,
  previous,
  t,
  onSelect,
}: {
  request: TimelineRequest;
  attempt: TimelineAttempt;
  row: number;
  x: (t: number) => number;
  selected: boolean;
  previous: TimelineAttempt | undefined;
  t: Words;
  onSelect: () => void;
}) {
  const top = HEAD_H + row * ROW_H + LANE_PAD;
  const x0 = x(ms(attempt.start));
  const x1 = Math.max(x(ms(attempt.end)), x0 + 6);
  const result = t[`tlResult_${attempt.result}` as const];
  const end = attempt.result === "failed" ? "fill-danger" : attempt.result === "changes_requested" ? "fill-warning" : null;
  const split = reviewOverlapsCi(attempt);
  return (
    <g>
      {previous ? (
        <line
          x1={x(ms(previous.end))}
          x2={x0}
          y1={top + LANE_H / 2}
          y2={top + LANE_H / 2}
          className="stroke-edge-strong"
          strokeWidth={1}
          strokeDasharray="1 3"
        >
          <title>{t.tlGap}</title>
        </line>
      ) : null}
      <g
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={t.tlAttemptLabel(request.task_code, attempt.n, result, compact(ms(attempt.end) - ms(attempt.start)))}
        data-attempt={`${request.task_code}:${attempt.n}`}
        className="group cursor-pointer outline-none"
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        <rect x={x0 - 3} y={top + 3} width={x1 - x0 + 6} height={LANE_H - 6} rx={3} className="fill-transparent" />
        <rect
          x={x0 - 3}
          y={top + 5}
          width={x1 - x0 + 6}
          height={LANE_H - 10}
          rx={3}
          className={cn(
            "fill-none",
            selected ? "stroke-accent" : "stroke-focus opacity-0 group-focus-visible:opacity-100",
          )}
          strokeWidth={selected ? 1.5 : 2}
        />
        {attempt.segments.map((seg, i) => {
          const [dy, h] = split && seg.stage === "ci" ? SPLIT_CI : split && seg.stage === "review" ? SPLIT_REVIEW : GEOMETRY[seg.kind];
          const sx = x(ms(seg.start));
          const w = Math.max(MIN_PX, x(ms(seg.end)) - sx);
          const hollow = seg.kind === "wait" || seg.kind === "main";
          const cancelled = seg.stage === "ci" && seg.outcome === "cancelled";
          const cx = sx + w;
          const cy = top + dy + h / 2;
          return (
            <g key={`${seg.stage}-${i}`}>
              <rect
                x={sx}
                y={top + dy}
                width={w}
                height={h}
                rx={1}
                className={segmentClass(seg)}
                strokeWidth={hollow ? 1 : 0}
                strokeDasharray={seg.kind === "main" ? "3 2" : undefined}
              />
              {cancelled ? (
                <path d={`M ${cx - 3} ${cy - 3} l 6 6 M ${cx + 3} ${cy - 3} l -6 6`} className="stroke-fg-2" strokeWidth={1.5} fill="none">
                  <title>{t.tlLgCancelledCi}</title>
                </path>
              ) : null}
            </g>
          );
        })}
        {end ? <rect x={x1 - 3} y={top + 9} width={3} height={22} className={end} /> : null}
        {attempt.merged_at ? (
          <path
            d={`M ${x(ms(attempt.merged_at)) - 4} ${top + 32} l 4 6 l 4 -6 z`}
            className="fill-fg"
          />
        ) : null}
        {request.attempts.length > 1 ? (
          <text x={x0} y={top + 10} className={cn("text-xs", selected ? "fill-fg font-semibold" : "fill-fg-3")}>
            {attempt.n}
          </text>
        ) : null}
      </g>
    </g>
  );
}

function Legend({ t }: { t: Words }) {
  const item = (swatch: React.ReactNode, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <svg width="16" height="12" aria-hidden="true" className="shrink-0">
        {swatch}
      </svg>
      {label}
    </span>
  );
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2" aria-label={t.tlLegend} data-lanes-legend>
      {item(<rect x="0" y="2" width="16" height="8" className="fill-edge-strong" />, t.tlLgPrep)}
      {item(<rect x="0" y="0" width="16" height="12" className="fill-fg" />, t.tlLgBuilder)}
      {item(<rect x="0" y="2" width="16" height="8" className="fill-fg-3" />, t.tlLgLight)}
      {item(<rect x="0.5" y="0.5" width="15" height="11" className="fill-none stroke-edge-control" />, t.tlLgWait)}
      {item(
        <>
          <rect x="0.5" y="0.5" width="15" height="4" className="fill-none stroke-edge-control" />
          <rect x="0" y="7" width="16" height="4" className="fill-fg-3" />
        </>,
        t.tlLgReview,
      )}
      {item(<path d="M 5 3 l 6 6 M 11 3 l -6 6" className="stroke-fg-2" strokeWidth={1.5} fill="none" />, t.tlLgCancelledCi)}
      {item(<rect x="0.5" y="1.5" width="15" height="9" className="fill-none stroke-edge-control" strokeDasharray="3 2" />, t.tlLgMain)}
      {item(<rect x="0" y="0" width="16" height="12" className="fill-info" />, t.tlLgLive)}
      {item(<rect x="6" y="0" width="3" height="12" className="fill-danger" />, t.tlLgEnd)}
      {item(<rect x="6" y="0" width="3" height="12" className="fill-warning" />, t.tlLgChanges)}
      {item(<path d="M 4 1 l 4 8 l 4 -8 z" className="fill-fg" />, t.tlLgMerge)}
      <span className="inline-flex items-center gap-1.5">
        <ForensicDot kind="done" />
        {t.tlLgForensicDone}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <ForensicDot kind="pending" />
        {t.tlLgForensicPending}
      </span>
    </p>
  );
}

export function Lanes({
  projectId,
  timeline,
  selection,
  needsYou,
  onSelect,
  hours,
  t,
}: {
  projectId: string;
  timeline: BuildTimeline;
  selection: Selection | null;
  needsYou: string | null;
  onSelect: (s: Selection) => void;
  hours: number;
  t: Words;
}) {
  const locale = useLocale();
  const scroller = useRef<HTMLDivElement>(null);
  const { from, to } = windowOf(timeline);
  const span = (to - from) / 60_000;
  const [viewW, setViewW] = useState(0);
  const [viewH, setViewH] = useState(0);
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  // Filter bar (Jaeger, Grafana, Honeycomb, GitHub Actions style): text, status toggles and the zoomed-to task.
  const [text, setText] = useState("");
  const [onlyRunning, setOnlyRunning] = useState(false);
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const zoomRef = useRef<number | null>(null);
  const pendingScroll = useRef<number | null>(null);
  const pointers = useRef(new Map<number, number>());
  const pinch = useRef<{ dist: number } | null>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  // The chart area is what is left of the box after the fixed label column.
  const availablePx = Math.max(0, viewW - LABEL_W - CHART_TAIL);
  const minPx = fitPx(span, availablePx);
  const pxPerMin = clampPx(zoom ?? Math.max(4, 720 / span), minPx);
  const width = Math.round(span * pxPerMin) + CHART_TAIL;
  const pxNow = useRef(pxPerMin);
  pxNow.current = pxPerMin;
  const minNow = useRef(minPx);
  minNow.current = minPx;
  // What happened before the window starts is cut at its left edge.
  const x = (time: number) => Math.max(0, ((time - from) / 60_000) * pxPerMin);
  const allRows = timeline.requests;
  // Rows follow the visible range (and the filters); the row chosen in the Path stays so its path keeps a lane.
  const focus = focusId && selection?.request === focusId ? focusId : null;
  const chartPx = Math.max(0, viewW - LABEL_W);
  const rows = filterRows(allRows, {
    range: viewW > 0 ? visibleRange(from, scroll.left, chartPx, pxPerMin) : null,
    text,
    running: onlyRunning,
    attention: onlyAttention,
    needsYou,
    pinned: selection?.request ?? null,
    focus,
  });
  const hidden = allRows.length - rows.length;
  // Only the rows in the vertical viewport are drawn: the lane stays cheap with thousands of tasks.
  const win = rowWindow(rows.length, scroll.top, viewH || 384, ROW_H, HEAD_H);
  const drawn = rows.slice(win.start, win.end);
  const height = HEAD_H + rows.length * ROW_H + MAIN_H;
  const clock = timeFormat(locale);
  const nowX = x(ms(timeline.now));
  const requestKey = allRows.map((r) => r.id).join();

  const syncScroll = useCallback(() => {
    const el = scroller.current;
    if (el) setScroll((s) => (s.left === el.scrollLeft && s.top === el.scrollTop ? s : { left: el.scrollLeft, top: el.scrollTop }));
  }, []);

  // Start looking at the present: the right edge, where «now» is, and the most recent rows at the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the set of rows changes
  useEffect(() => {
    const el = scroller.current;
    if (el) {
      el.scrollLeft = el.scrollWidth;
      el.scrollTop = 0;
      syncScroll();
    }
  }, [requestKey]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      setViewW(el.clientWidth);
      setViewH(el.clientHeight);
      syncScroll();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncScroll]);

  // After a zoom, put the scroll where the anchored time stays under the pointer.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pendingScroll.current !== null) {
      el.scrollLeft = pendingScroll.current;
      pendingScroll.current = null;
      syncScroll();
    }
  }, [pxPerMin, syncScroll]);

  /** Zoom to `next` px per minute keeping the time at `anchorX` (px from the chart's left edge) still. */
  const zoomTo = useCallback((next: number, anchorX: number) => {
    const el = scroller.current;
    if (!el) return;
    setFocusId(null);
    const old = pxNow.current;
    const target = clampPx(next, minNow.current);
    if (target === old && zoomRef.current !== null) return;
    pendingScroll.current = zoomScroll(pendingScroll.current ?? el.scrollLeft, anchorX, old, target);
    pxNow.current = target;
    zoomRef.current = target;
    setZoom(target);
  }, []);

  const centre = () => Math.max(0, (scroller.current?.clientWidth ?? 0) - LABEL_W) / 2;
  const setRange = (range: { px: number; scrollLeft: number }, focusRow: string | null = null) => {
    setFocusId(focusRow);
    pendingScroll.current = range.scrollLeft;
    pxNow.current = range.px;
    zoomRef.current = range.px;
    setZoom(range.px);
  };
  const fitAll = () => {
    setFocusId(null);
    pendingScroll.current = 0;
    pxNow.current = minNow.current;
    zoomRef.current = minNow.current;
    setZoom(minNow.current);
  };
  const lastHours = (h: number) => setRange(fitRange(from, to - h * 3_600_000, to, availablePx, minPx));
  const chosenRequest = selection ? allRows.find((r) => r.id === selection.request) : undefined;
  const chosen = chosenRequest?.attempts.find((a) => a.n === selection?.attempt);
  // «Zoom to attempt» shows only that task (and the main line).
  const zoomAttempt = () => {
    if (chosen && chosenRequest) setRange(fitRange(from, Math.max(from, ms(chosen.start)), ms(chosen.end), availablePx, minPx), chosenRequest.id);
  };
  const showAll = () => {
    setText("");
    setOnlyRunning(false);
    setOnlyAttention(false);
    fitAll();
  };

  // Ctrl/⌘ + wheel (and a trackpad pinch, which arrives the same way) zooms around the pointer.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const anchorX = e.clientX - el.getBoundingClientRect().left - LABEL_W;
      zoomTo(pxNow.current * Math.exp(-e.deltaY * 0.01), Math.max(0, anchorX));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, e.clientX);
    if (pointers.current.size === 2) {
      const [a = 0, b = 0] = [...pointers.current.values()];
      pinch.current = { dist: Math.abs(a - b) };
      drag.current = null;
    } else if (e.pointerType === "mouse" && e.button === 0 && !(e.target as Element).closest("[role=button],button")) {
      drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft, moved: false };
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, e.clientX);
    const el = e.currentTarget;
    if (pinch.current && pointers.current.size === 2) {
      const [a = 0, b = 0] = [...pointers.current.values()];
      const dist = Math.abs(a - b);
      if (pinch.current.dist > 8 && dist > 8) {
        const anchorX = (a + b) / 2 - el.getBoundingClientRect().left - LABEL_W;
        zoomTo((pxNow.current * dist) / pinch.current.dist, Math.max(0, anchorX));
        pinch.current = { dist };
      }
    } else if (drag.current) {
      const dx = e.clientX - drag.current.x;
      if (!drag.current.moved && Math.abs(dx) > 4) {
        drag.current.moved = true;
        el.setPointerCapture(e.pointerId);
      }
      if (drag.current.moved) el.scrollLeft = drag.current.left - dx;
    }
  };
  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    drag.current = null;
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "+" || e.key === "=") zoomTo(pxNow.current * 1.5, centre());
    else if (e.key === "-" || e.key === "_") zoomTo(pxNow.current / 1.5, centre());
    else if (e.key === "0") fitAll();
    else return;
    e.preventDefault();
  };

  if (allRows.length === 0) return <p className="text-sm text-fg-2">{t.tlEmpty}</p>;
  return (
    <div className="flex flex-col gap-2" data-build-lanes>
      <div role="toolbar" aria-label={t.tlZoomTools} className="flex flex-wrap items-center gap-2" data-lanes-zoom>
        <Button size="sm" variant="secondary" aria-label={t.tlZoomOut} title={t.tlZoomOut} disabled={pxPerMin <= minPx} onClick={() => zoomTo(pxPerMin / 1.5, centre())}>
          −
        </Button>
        <Button size="sm" variant="secondary" aria-label={t.tlZoomIn} title={t.tlZoomIn} disabled={pxPerMin >= MAX_PX_PER_MIN} onClick={() => zoomTo(pxPerMin * 1.5, centre())}>
          +
        </Button>
        <Button size="sm" variant="secondary" onClick={fitAll}>
          {t.tlFit}
        </Button>
        {[1, 3].filter((h) => h * 60 < span).map((h) => (
          <Button key={h} size="sm" variant="secondary" onClick={() => lastHours(h)}>
            {t.tlLastHours(h)}
          </Button>
        ))}
        {chosen && chosenRequest ? (
          <Button size="sm" variant="secondary" onClick={zoomAttempt}>
            {t.tlZoomAttempt(chosenRequest.task_code, chosen.n)}
          </Button>
        ) : null}
      </div>
      <div role="toolbar" aria-label={t.tlFilterTools} className="flex flex-wrap items-center gap-2" data-lanes-filter>
        <TextInput
          type="search"
          aria-label={t.tlFilterLabel}
          placeholder={t.tlFilterPlaceholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-8 min-w-0 flex-1 basis-48 text-sm"
        />
        <Button size="sm" variant={onlyRunning ? "primary" : "secondary"} aria-pressed={onlyRunning} onClick={() => setOnlyRunning((v) => !v)}>
          {t.tlFilterRunning}
        </Button>
        <Button size="sm" variant={onlyAttention ? "primary" : "secondary"} aria-pressed={onlyAttention} onClick={() => setOnlyAttention((v) => !v)}>
          {t.tlFilterAttention}
        </Button>
      </div>
      {hidden > 0 ? (
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-3" role="status" data-lanes-count>
          {t.tlShowing(rows.length, allRows.length)}
          <Button size="sm" variant="quiet" onClick={showAll}>
            {t.tlShowAll}
          </Button>
        </p>
      ) : null}
      <div
        ref={scroller}
        onScroll={syncScroll}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        tabIndex={0}
        role="group"
        aria-label={t.tlScroll}
        className="flex max-h-96 touch-pan-x touch-pan-y overflow-auto overscroll-x-contain rounded-xs focus-visible:outline-2 focus-visible:outline-focus"
      >
        <div className="sticky left-0 z-10 shrink-0 self-start bg-panel" style={{ width: LABEL_W }}>
          <div style={{ height: HEAD_H + win.start * ROW_H }} />
          {drawn.map((r) => {
            const last = r.attempts[r.attempts.length - 1];
            const chosen = selection?.request === r.id;
            return (
              <div key={r.id} className="relative" style={{ height: ROW_H }}>
              <button
                type="button"
                aria-pressed={chosen}
                aria-label={t.tlTaskLabel(r.task_code, r.task_title)}
                onClick={() => last && onSelect({ request: r.id, attempt: last.n })}
                className="box-border flex w-full flex-col items-start justify-center overflow-hidden pr-2 text-left leading-4 outline-none focus-visible:outline-2 focus-visible:outline-focus"
                style={{ height: ROW_H }}
                data-lane-task={r.task_code}
              >
                <span className="flex max-w-full items-baseline gap-2 truncate font-code text-xs">
                  <span className={cn(chosen ? "font-semibold" : "", needsYou === r.task_code ? "text-accent-text" : "text-fg")}>{r.task_code}</span>
                  {r.feature ? <span className="text-fg-3">{r.feature.code}</span> : null}
                </span>
                {r.flow ? (
                  <span className="line-clamp-2 text-xs tabular-nums text-fg-3" title={t.flowTitle} data-lane-flow={r.task_code}>
                    {sharesLine(r.flow.pct, { build: t.flowBuild, ci: t.flowCi, review: t.flowReview, wait: t.flowWait })}
                  </span>
                ) : null}
              </button>
              <span className="absolute right-2 top-2 flex">
                <LaneForensicMark projectId={projectId} request={r} doneLabel={t.tlLgForensicDone} pendingLabel={t.tlLgForensicPending} />
              </span>
              </div>
            );
          })}
          <div style={{ height: (rows.length - win.end) * ROW_H }} />
          <div className="flex items-center font-code text-xs text-fg-3" style={{ height: MAIN_H }}>
            {t.tlMain}
          </div>
        </div>
        <svg width={width} height={height} className="shrink-0" role="presentation" data-lanes-svg>
          {ticksOf(from, to, pxPerMin).map((tick) => (
            <g key={tick}>
              <line x1={x(tick)} x2={x(tick)} y1={HEAD_H - 4} y2={height} className="stroke-edge-subtle" strokeWidth={1} />
              <text x={x(tick)} y={HEAD_H - 10} textAnchor="middle" className="fill-fg-3 text-xs tabular-nums">
                {clock.format(tick)}
              </text>
            </g>
          ))}
          {drawn.map((r, i) => {
            const row = win.start + i;
            return (
            <g key={r.id}>
              <line
                x1={0}
                x2={width}
                y1={HEAD_H + (row + 1) * ROW_H}
                y2={HEAD_H + (row + 1) * ROW_H}
                className="stroke-edge-subtle"
                strokeWidth={1}
              />
              {r.attempts.map((a, i) => ms(a.end) < from ? null : (
                <Attempt
                  key={a.n}
                  request={r}
                  attempt={a}
                  row={row}
                  x={x}
                  previous={r.attempts[i - 1]}
                  selected={selection?.request === r.id && selection.attempt === a.n}
                  t={t}
                  onSelect={() => onSelect({ request: r.id, attempt: a.n })}
                />
              ))}
            </g>
            );
          })}
          <line x1={0} x2={width} y1={HEAD_H + rows.length * ROW_H + MAIN_H / 2} y2={HEAD_H + rows.length * ROW_H + MAIN_H / 2} className="stroke-edge-strong" strokeWidth={1} />
          {timeline.merges.map((m) => {
            const mx = x(ms(m.at));
            const my = HEAD_H + rows.length * ROW_H + MAIN_H / 2;
            return (
              <g key={`${m.task_code}-${m.at}`}>
                <title>{t.tlMergeLabel(m.task_code, m.pr_number)}</title>
                <path d={`M ${mx - 5} ${my + 5} l 5 -10 l 5 10 z`} className="fill-fg" />
                {m.pr_number ? (
                  <text x={mx} y={my + 17} textAnchor="middle" className="fill-fg-3 text-xs tabular-nums">
                    {`#${m.pr_number}`}
                  </text>
                ) : null}
              </g>
            );
          })}
          <line x1={nowX} x2={nowX} y1={HEAD_H - 4} y2={height} className="stroke-info" strokeWidth={1.5} />
          <text x={nowX + 5} y={HEAD_H - 10} className="fill-info-text text-xs font-semibold tabular-nums">
            {`${t.tlNow} ${clock.format(ms(timeline.now))}`}
          </text>
        </svg>
      </div>
      {rows.length === 0 ? <p className="text-sm text-fg-2">{t.tlNoRows}</p> : null}
      <Legend t={t} />
      <p className="text-xs text-fg-3">{t.tlNote(hours)}</p>
      <p className="text-xs text-fg-3">{t.tlZoomHint}</p>
      {timeline.truncated ? <p className="text-xs text-fg-3">{t.tlTruncated(rows.length)}</p> : null}
    </div>
  );
}

