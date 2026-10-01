// «Path» of one attempt of a task: its stages as a flow (filled link = work, hollow = waiting for CI), what
// entered the builder (code to extend, affected tests, progress notes, session, feedback of the previous attempt)
// and what came out (pull request, CI, review, merge), and the ladder of every attempt with how it ended.
// All of it comes from the build steps the server already keeps; where a fact was not kept the view says so.

import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { TimelineAttempt, TimelineContext, TimelineRequest } from "../../api/types.ts";
import { Code } from "../../components/Badge.tsx";
import { Who } from "../../components/Who.tsx";
import { cn } from "../../lib/cn.ts";
import { useMessages } from "../../i18n/define.ts";
import { AGENT_BUILD } from "../record/agentBuild.i18n.ts";
import { type ChainBlock, PATH_COLUMNS, STAGE_COLUMN, type Selection, type StageState, chainLayout, compact, flattenSegments, ms, reviewOverlapsCi, scrollTargetFor, stageStates } from "./timelineLogic.ts";
import type { BUILD } from "./words.i18n.ts";

type Words = typeof BUILD.en;
type Stages = typeof AGENT_BUILD.en;

const NODE_W = 132;
/** Dot rows: the upper branch (CI), the lower branch (review); the single nodes sit between them. */
const DOT_Y = 18;
const BRANCH_GAP = 96;
const MID_Y = DOT_Y + BRANCH_GAP / 2;

/** A two-line label: the words split in the middle. */
function twoLines(label: string): [string, string] {
  const words = label.split(" ");
  if (words.length < 2) return [label, ""];
  const cut = Math.ceil(words.length / 2);
  return [words.slice(0, cut).join(" "), words.slice(cut).join(" ")];
}

const word = (stages: Stages, prefix: "s_" | "o_", key: string): string => {
  const v = (stages as Record<string, unknown>)[`${prefix}${key}`];
  return typeof v === "string" ? v : key;
};

function Glyph({ state, cx, cy }: { state: StageState; cx: number; cy: number }) {
  switch (state) {
    case "done":
      return <circle cx={cx} cy={cy} r={6} className="fill-fg" />;
    case "running":
      return (
        <>
          <circle cx={cx} cy={cy} r={10} className="fill-none stroke-info opacity-40" strokeWidth={2} />
          <circle cx={cx} cy={cy} r={6} className="fill-info" />
        </>
      );
    case "failed":
      return (
        <>
          <circle cx={cx} cy={cy} r={7} className="fill-panel stroke-danger" strokeWidth={2} />
          <path d={`M ${cx - 3} ${cy - 3} l 6 6 M ${cx + 3} ${cy - 3} l -6 6`} className="stroke-danger" strokeWidth={1.5} />
        </>
      );
    case "changes":
      return (
        <>
          <circle cx={cx} cy={cy} r={7} className="fill-panel stroke-warning" strokeWidth={2} />
          <circle cx={cx} cy={cy} r={2.5} className="fill-warning" />
        </>
      );
    case "cancelled":
      return (
        <>
          <circle cx={cx} cy={cy} r={7} className="fill-panel stroke-edge-control" strokeWidth={1.5} />
          <path d={`M ${cx - 3} ${cy} h 6`} className="stroke-edge-control" strokeWidth={1.5} />
        </>
      );
    case "pending":
      return <circle cx={cx} cy={cy} r={6} className="fill-none stroke-edge-control" strokeWidth={1.5} strokeDasharray="3 3" />;
  }
}

type PathStage = (typeof PATH_COLUMNS)[number][number];
type PathNode = { stage: PathStage; cx: number; cy: number; state: StageState; ms: number; wait: boolean; cancelled: boolean };

/** A link from x1 to x2 at height y: filled = work, hollow = waiting, dashed = not reached. */
function Bar({ x1, x2, y, node }: { x1: number; x2: number; y: number; node: Pick<PathNode, "state" | "wait"> }) {
  const w = Math.max(0, x2 - x1);
  if (node.state === "pending") return <line x1={x1} x2={x2} y1={y} y2={y} className="stroke-edge-control" strokeWidth={1.5} strokeDasharray="3 3" />;
  if (node.wait) return <rect x={x1} y={y - 3} width={w} height={6} rx={1} className={cn("fill-none", node.state === "running" ? "stroke-info" : "stroke-edge-control")} strokeWidth={1} />;
  return <rect x={x1} y={y - 2.5} width={w} height={5} rx={1} className={node.state === "running" ? "fill-info" : "fill-fg"} />;
}

/** The gateway where the path forks or joins: a diamond with a plus (BPMN parallel gateway). */
function Gateway({ cx }: { cx: number }) {
  return (
    <g className="stroke-edge-strong" fill="none" strokeWidth={1.5}>
      <path d={`M ${cx - 7} ${MID_Y} l 7 -7 l 7 7 l -7 7 z`} className="fill-panel" />
      <path d={`M ${cx - 3} ${MID_Y} h 6 M ${cx} ${MID_Y - 3} v 6`} />
    </g>
  );
}

const GAP = 48;
const HEAD_H = 22;
const BODY_H = 192;
const clip = (s: string, max = 22): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** The colour of the rework loop leaving an attempt: the colour of how it ended. */
const LOOP: Record<string, { stroke: string; fill: string }> = {
  failed: { stroke: "stroke-danger", fill: "fill-danger" },
  changes_requested: { stroke: "stroke-warning", fill: "fill-warning" },
};
const LOOP_DEFAULT = { stroke: "stroke-edge-control", fill: "fill-edge-control" };

/**
 * One attempt as a block: Prepare, Build, [CI and Review in parallel], Merge, CI on main. Practice: fork/join of UML
 * activity diagrams and the parallel gateway of BPMN. Attempts from before the parallel run have the same layout:
 * their two branches just do not overlap in time. CI on main comes after the merge and does not hold the queue.
 * An attempt that ended early is cut after its last reached stage (`cols` columns).
 */
function AttemptBlock({ attempt, cols, t }: { attempt: TimelineAttempt; cols: number; t: Words }) {
  const states = stageStates(attempt);
  const node = (stage: PathStage, col: number, cy: number): PathNode => {
    const st = states.get(stage);
    const cancelled = stage === "ci" && attempt.segments.some((x) => x.stage === "ci" && x.outcome === "cancelled");
    return { stage, cx: col * NODE_W + NODE_W / 2, cy, state: (st?.state ?? "pending") as StageState, ms: st?.ms ?? 0, wait: st?.wait ?? false, cancelled };
  };
  const [prepare, builder, ci, review, merge, main] = [node("prepare", 0, MID_Y), node("builder", 1, MID_Y), node("ci", 2, DOT_Y), node("review", 2, DOT_Y + BRANCH_GAP), node("merge", 3, MID_Y), node("main", 4, MID_Y)] as [PathNode, PathNode, PathNode, PathNode, PathNode, PathNode];
  const all = [prepare, builder, ci, review, merge, main];
  const nodes = all.filter((n) => (STAGE_COLUMN[n.stage] ?? 0) < cols);
  // The end node of an attempt that did not get through: the stage where it stopped shows how it ended.
  const endResult = attempt.result === "failed" ? "failed" : attempt.result === "changes_requested" ? "changes" : attempt.result === "cancelled" ? "cancelled" : null;
  const endStage = attempt.ended_by?.stage;
  const endNode = endResult ? (cols === 3 ? (endStage === "review" ? review : ci) : nodes.find((n) => STAGE_COLUMN[n.stage] === cols - 1)) : undefined;
  if (endNode && endResult && (endNode.state === "done" || endNode.state === "pending")) endNode.state = endResult;
  const forkX = builder.cx + NODE_W / 2;
  const joinX = merge.cx - NODE_W / 2;
  const mergeStarted = merge.state !== "pending";
  const reason = endNode ? attempt.ended_by?.reason ?? null : null;
  const label = (n: PathNode) => (
    <>
      <text x={n.cx} y={n.cy + 28} textAnchor="middle" className={cn("text-xs", n.state === "pending" ? "fill-fg-3" : "fill-fg")}>
        {t[`tpStage_${n.stage}` as const]}
      </text>
      {n.ms >= 1000 ? (
        <text x={n.cx} y={n.cy + 42} textAnchor="middle" className="fill-fg-3 text-xs tabular-nums">
          {compact(n.ms)}
        </text>
      ) : null}
    </>
  );
  const note = (n: PathNode, text: string, extra = 0) =>
    twoLines(text).map((line, i) =>
      line ? (
        <text key={`${n.stage}-${i}-${extra}`} x={n.cx} y={n.cy + (n.ms >= 1000 ? 56 : 42) + extra + i * 13} textAnchor="middle" className="fill-fg-3 text-xs">
          {clip(line)}
        </text>
      ) : null,
    );
  const showCancelled = (n: PathNode) => n.cancelled && n.state === "cancelled";
  return (
    <>
      <Bar x1={prepare.cx + 12} x2={builder.cx - 12} y={MID_Y} node={builder} />
      {cols >= 3 ? (
        <>
          <Bar x1={builder.cx + 12} x2={forkX - 8} y={MID_Y} node={ci.state === "pending" && review.state === "pending" ? ci : { state: "done", wait: false }} />
          {/* fork: the two branches leave the gateway together */}
          <line x1={forkX} x2={forkX} y1={ci.cy} y2={review.cy} className="stroke-edge-strong" strokeWidth={1.5} />
          <Bar x1={forkX} x2={ci.cx - 12} y={ci.cy} node={ci} />
          <Bar x1={forkX} x2={review.cx - 12} y={review.cy} node={review} />
          <Gateway cx={forkX} />
        </>
      ) : null}
      {cols >= 4 ? (
        <>
          {/* join: Merge starts when both are done */}
          <Bar x1={ci.cx + 12} x2={joinX} y={ci.cy} node={ci} />
          <Bar x1={review.cx + 12} x2={joinX} y={review.cy} node={review} />
          <line x1={joinX} x2={joinX} y1={ci.cy} y2={review.cy} className="stroke-edge-strong" strokeWidth={1.5} />
          <Bar x1={joinX + 8} x2={merge.cx - 12} y={MID_Y} node={mergeStarted ? { state: merge.state, wait: false } : { state: "pending", wait: false }} />
          <Gateway cx={joinX} />
        </>
      ) : null}
      {/* CI on main: after the merge, a dashed link whatever its state */}
      {cols >= 5 ? <line x1={merge.cx + 12} x2={main.cx - 12} y1={MID_Y} y2={MID_Y} className="stroke-edge-control" strokeWidth={1.5} strokeDasharray="3 3" /> : null}
      {nodes.map((n) => (
        <g key={n.stage} data-stage={n.stage} data-state={n.state}>
          <Glyph state={n.state} cx={n.cx} cy={n.cy} />
          {label(n)}
          {n.stage === "main" ? note(n, t.tpAfterMerge) : null}
          {showCancelled(n) ? note(n, t.tpCancelledReason) : null}
          {n === endNode && reason && !showCancelled(n) ? note(n, reason) : null}
        </g>
      ))}
    </>
  );
}

/**
 * Every attempt of the task as one chain: attempt 1, then 2, … up to the merge, with the rework loop between them.
 * Practice: a value-stream map shows each loop back of rework (Rother & Shook, «Learning to See»).
 */
function Chain({ request, selected, onSelect, t }: { request: TimelineRequest; selected: number; onSelect: (n: number) => void; t: Words }) {
  const ref = useRef<HTMLDivElement>(null);
  const { blocks, width } = chainLayout(request.attempts, NODE_W, GAP);
  const sel = blocks.find((b) => b.n === selected);
  const selX = sel?.x;
  const selW = sel?.width;
  useEffect(() => {
    const el = ref.current;
    if (!el || selX === undefined || selW === undefined) return;
    el.scrollLeft = scrollTargetFor(selX, selW, el.scrollLeft, el.clientWidth);
  }, [selected, selX, selW]);
  const height = HEAD_H + BODY_H;
  return (
    <div className="flex flex-col gap-2">
      <div ref={ref} tabIndex={0} role="group" aria-label={t.tpChainLabel(request.task_code, request.attempts.length)} className="max-w-full overflow-x-auto rounded-xs focus-visible:outline-2 focus-visible:outline-focus" data-task-path>
        <svg width={width} height={height} aria-hidden="true" className="block shrink-0">
          {request.attempts.map((a, i) => {
            const b = blocks[i] as ChainBlock;
            const next = blocks[i + 1];
            const endStage = a.ended_by?.stage;
            const endY = b.cols === 3 && endStage === "review" ? DOT_Y + BRANCH_GAP : b.cols === 3 ? DOT_Y : MID_Y;
            const loop = LOOP[a.result] ?? LOOP_DEFAULT;
            const x1 = b.x + b.width - NODE_W / 2 + 12;
            const x2 = next ? next.x + NODE_W / 2 - 12 : 0;
            const xm = next ? b.x + b.width + GAP / 2 : 0;
            const dur = ms(a.end) - ms(a.start);
            return (
              <g key={a.n}>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={t.tpAttemptButton(a.n, t[`tlResult_${a.result}` as const])}
                  aria-pressed={a.n === selected}
                  data-attempt={a.n}
                  data-result={a.result}
                  className="cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-focus"
                  onClick={() => onSelect(a.n)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(a.n);
                    }
                  }}
                >
                  <rect x={b.x} y={0} width={b.width} height={height} rx={6} className={a.n === selected ? "fill-sunken stroke-edge" : "fill-transparent stroke-transparent"} />
                  <text x={b.x + 8} y={14} className={cn("text-xs tabular-nums", a.n === selected ? "fill-fg font-medium" : "fill-fg-2")}>
                    {t.tpAttemptHeader(a.n, compact(dur))}
                  </text>
                  <g transform={`translate(${b.x}, ${HEAD_H})`}>
                    <AttemptBlock attempt={a} cols={b.cols} t={t} />
                  </g>
                </g>
                {next ? (
                  <g data-rework={a.n} aria-hidden="true">
                    <path d={`M ${x1} ${HEAD_H + endY} H ${xm} V ${HEAD_H + MID_Y} H ${x2 - 5}`} fill="none" className={loop.stroke} strokeWidth={1.25} />
                    <path d={`M ${x2} ${HEAD_H + MID_Y} l -6 -3.5 v 7 z`} className={loop.fill} />
                  </g>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <ol className="sr-only">
        {request.attempts.map((a, i) => {
          const b = blocks[i] as ChainBlock;
          const states = stageStates(a);
          return (
            <li key={a.n}>
              {t.tpAttemptButton(a.n, t[`tlResult_${a.result}` as const])}
              {a.ended_by?.reason ? `, ${a.ended_by.reason}` : ""}
              {reviewOverlapsCi(a) ? `. ${t.tpParallel}` : ""}
              <ol>
                {PATH_COLUMNS.slice(0, b.cols)
                  .flat()
                  .map((stage) => {
                    const st = states.get(stage);
                    return (
                      <li key={stage}>
                        {t.tpStageLabel(t[`tpStage_${stage}` as const], t[`tpState_${(st?.state ?? "pending") as StageState}` as const], st && st.ms >= 1000 ? compact(st.ms) : "")}
                        {stage === "main" ? `, ${t.tpAfterMerge}` : ""}
                      </li>
                    );
                  })}
              </ol>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The mechanical steps as one quiet line; a problem opens it up with the stage and its error. */
function Checkpoint({ attempt, t, stages }: { attempt: TimelineAttempt; t: Words; stages: Stages }) {
  const c = attempt.checkpoint;
  return (
    <div className="flex flex-col gap-0.5 text-sm" data-checkpoint={c.problems.length > 0 ? "problem" : c.reached ? "ok" : "none"}>
      <p className={c.problems.length > 0 ? "text-fg" : "text-fg-2"}>
        {t.tpCheckpoint}
        <span aria-hidden="true">{c.reached && c.problems.length === 0 ? " ✓" : ""}</span>
        <span className="sr-only">{c.reached && c.problems.length === 0 ? ` ${t.tpCheckpointOk}` : ""}</span>
        {!c.reached && c.problems.length === 0 ? <span className="text-fg-3">{` · ${t.tpCheckpointNot}`}</span> : null}
      </p>
      {c.problems.length > 0 ? (
        <ul className="flex flex-col gap-0.5 border-l-2 border-danger pl-3 text-danger-text">
          {c.problems.map((p, i) => (
            <li key={`${p.stage}-${i}`} className="min-w-0 break-words">
              {t.tpProblem(word(stages, "s_", p.stage), p.error)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-fg-3">{label}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </>
  );
}

const Dl = ({ children, label }: { children: ReactNode; label: string }) => (
  <dl aria-label={label} className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-[11rem_1fr] [&>dt]:mt-2 sm:[&>dt]:mt-0">
    {children}
  </dl>
);

function Entered({ attempt, previous, t, stages }: { attempt: TimelineAttempt; previous: TimelineAttempt | undefined; t: Words; stages: Stages }) {
  const b = attempt.builder;
  const cte = b?.code_to_extend ?? null;
  const prev = previous?.ended_by ?? null;
  return (
    <Dl label={t.tpIn}>
      <Row label={t.tpStartedBy}>
        <span className="inline-flex flex-wrap items-center gap-x-2">
          {attempt.started_by ? <Who actor={attempt.started_by} size={16} /> : null}
          {attempt.start_reason ? <span className="text-fg-2">{attempt.start_reason}</span> : null}
        </span>
        {attempt.gap_before_ms !== null && attempt.gap_before_ms >= 60_000 ? (
          <span className="block text-xs text-fg-3">{t.tpGapBefore(compact(attempt.gap_before_ms))}</span>
        ) : null}
      </Row>
      <Row label={t.tpModel}>{b?.model ? [b.provider, b.model].filter(Boolean).join(" · ") : t.tpNotKept}</Row>
      <Row label={t.tpSession}>
        {b?.session ? (
          <>
            {b.session.mode === "resumed" ? t.tpSessionResumed : t.tpSessionFresh}
            {b.session.reason ? <span className="text-fg-2">{` · ${b.session.reason}`}</span> : null}
          </>
        ) : (
          t.tpNotKept
        )}
      </Row>
      <Row label={t.tpCode}>
        {cte ? (
          <>
            {t.tpCodeValue({ files: cte.files, chars: cte.section_chars, jev: cte.ordered_by_jev, commit: cte.commit })}
            {cte.first_files.length > 0 ? <span className="block break-all font-code text-xs text-fg-2">{cte.first_files.join(" · ")}</span> : null}
          </>
        ) : (
          <span className="text-fg-2">{t.tpNotKept}</span>
        )}
      </Row>
      <Row label={t.tpAffected}>
        {b?.affected_tests ? (
          <span className="break-all font-code text-xs">{t.tpAffectedValue(b.affected_tests.count, b.affected_tests.first.join(", "))}</span>
        ) : (
          <span className="text-fg-2">{t.tpNotKept}</span>
        )}
      </Row>
      {b?.test_reuse ? (
        <Row label={t.tpReuse}>
          <span className="break-all font-code text-xs">{t.tpReuseValue(b.test_reuse.count, b.test_reuse.first.map((x) => `${x.criterion} ${x.path}`).join(", "))}</span>
        </Row>
      ) : null}
      <Row label={t.tpProgress}>
        {b && b.progress_chars > 0 ? (
          <>
            {t.tpProgressValue(b.progress_chars)}
            {b.progress ? <span className="block text-xs text-fg-2">{b.progress}</span> : null}
          </>
        ) : (
          <span className="text-fg-2">{b ? t.tpNone : t.tpNotKept}</span>
        )}
      </Row>
      {b && b.wip_files > 0 ? <Row label={t.tpWip}>{t.tpWipValue(b.wip_files)}</Row> : null}
      <Row label={t.tpFeedback}>
        {prev && previous ? (
          t.tpFeedbackLine({
            n: previous.n,
            stage: word(stages, "s_", prev.stage),
            outcome: word(stages, "o_", prev.outcome),
            reason: prev.reason,
            comments: prev.comments,
            blocking: prev.blocking,
            behind: prev.behind_by,
          })
        ) : (
          <span className="text-fg-2">{t.tpFeedbackNone}</span>
        )}
      </Row>
    </Dl>
  );
}

function Came({ request, attempt, t }: { request: TimelineRequest; attempt: TimelineAttempt; t: Words }) {
  const b = attempt.builder;
  const o = attempt.out;
  const any = b || o.pr_number || o.ci || o.review || attempt.merged_at;
  const dash = <span className="text-fg-2">{t.tpOutNone}</span>;
  return (
    <Dl label={t.tpOut}>
      {!any ? <Row label={t.tpOut}>{dash}</Row> : null}
      <Row label={t.tpBuilderRun}>
        {b ? (
          <>
            <span className="text-fg-2">{t.tpBuilderRan(compact(b.duration_ms ?? 0), b.exit_code)}</span>
            {b.error ? <span className="block text-xs text-danger-text">{b.error}</span> : null}
          </>
        ) : (
          <span className="text-fg-2">{t.tpNoBuilder}</span>
        )}
      </Row>
      {b?.notes ? <Row label={t.tpSaid}>{b.notes}</Row> : null}
      {b?.tests_written ? <Row label={t.tpTests}>{b.tests_written}</Row> : null}
      <Row label={t.tpPr}>
        {o.pr_number ? (
          request.pr_url ? (
            <a href={request.pr_url} target="_blank" rel="noreferrer" className="text-accent-text underline">
              {`#${o.pr_number}`}
            </a>
          ) : (
            `#${o.pr_number}`
          )
        ) : (
          dash
        )}
        {o.head_sha ? <Code className="ml-2">{o.head_sha}</Code> : null}
      </Row>
      <Row label={t.tpCi}>{o.ci ? t.tpCiValue(o.ci, o.updated_from_base) : dash}</Row>
      <Row label={t.tpReview}>{o.review ? t.tpReviewValue((o.review.verdict ?? "").replace(/_/g, " "), o.review.comments) : dash}</Row>
      <Row label={t.tpMerge}>
        {attempt.merged_at ? (
          <time dateTime={attempt.merged_at}>{new Date(attempt.merged_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        ) : o.behind_by ? (
          t.tpMergeBehind(o.behind_by)
        ) : (
          dash
        )}
        {o.merge ? (
          <span className="block text-xs text-fg-2">
            {(o.merge.recheck === false ? t.tpMergeSkipped : t.tpMergeRerun)(o.merge.behind_by, t.tpReason(o.merge.reason ?? ""))}
          </span>
        ) : null}
      </Row>
      {o.main ? <Row label={t.tpMain}>{o.main.conclusion ?? ""}</Row> : null}
    </Dl>
  );
}

/** File names, compact: the first few and how many more. */
function Names({ files, total, t }: { files: string[]; total: number; t: Words }) {
  if (total === 0) return <span className="text-fg-2">{t.tpContextNone}</span>;
  return (
    <span className="break-all font-code text-xs">
      {files.join(" · ")}
      {total > files.length ? <span className="text-fg-3">{` · ${t.tpContextMore(total - files.length)}`}</span> : null}
    </span>
  );
}

/** What the merged attempt's builder was given against what the pull request touched. */
function Context({ context, t }: { context: TimelineContext; t: Words }) {
  const c = context.counts;
  return (
    <section className="flex flex-col gap-2" aria-label={t.tpContext} data-task-context>
      <h4 className="text-xs font-medium text-fg-3">{t.tpContext}</h4>
      <Dl label={t.tpContext}>
        <Row label={`${t.tpContextHits} (${c.hits})`}>
          <Names files={context.hits} total={c.hits} t={t} />
        </Row>
        <Row label={`${t.tpContextMissed} (${c.touched - c.hits})`}>
          <Names files={context.missed} total={c.touched - c.hits} t={t} />
        </Row>
        <Row label={`${t.tpContextUnused} (${c.given - c.hits})`}>
          <Names files={context.unused} total={c.given - c.hits} t={t} />
        </Row>
        {context.reuse ? <Row label={t.tpReuse}>{t.tpContextReuse(context.reuse.suggested, context.reuse.touched)}</Row> : null}
      </Dl>
    </section>
  );
}

/** One attempt against the one before: what it received, what changed and how it ended. Only what the steps kept. */
function Compare({ attempt, previous, t, stages }: { attempt: TimelineAttempt; previous: TimelineAttempt | undefined; t: Words; stages: Stages }) {
  const b = attempt.builder;
  const pb = previous?.builder ?? null;
  const prev = previous?.ended_by ?? null;
  const changes: string[] = [];
  if (previous) {
    const model = (x: TimelineAttempt["builder"]) => (x?.model ? [x.provider, x.model].filter(Boolean).join(" · ") : null);
    if (model(b) && model(pb) && model(b) !== model(pb)) changes.push(t.tpCmpModel(model(pb) as string, model(b) as string));
    if (b?.session && pb?.session && b.session.mode !== pb.session.mode) {
      const label = (m: string) => (m === "resumed" ? t.tpSessionResumed : t.tpSessionFresh);
      changes.push(t.tpCmpSession(label(pb.session.mode), label(b.session.mode)));
    }
    if (b?.code_to_extend && pb?.code_to_extend && b.code_to_extend.files !== pb.code_to_extend.files) changes.push(t.tpCmpFiles(pb.code_to_extend.files, b.code_to_extend.files));
  }
  if (b && b.wip_file_names.length > 0) changes.push(t.tpCmpWip(b.wip_file_names.join(", ")));
  const e = attempt.ended_by;
  return (
    <div className="flex flex-col gap-1 pb-3 pl-9 text-sm" data-attempt-compare={attempt.n}>
      {!previous ? <p className="text-fg-3">{t.tpCmpFirst}</p> : null}
      {previous ? (
        <p>
          <span className="text-fg-3">{t.tpCmpFeedback}: </span>
          {prev
            ? t.tpFeedbackLine({
                n: previous.n,
                stage: word(stages, "s_", prev.stage),
                outcome: word(stages, "o_", prev.outcome),
                reason: prev.reason,
                comments: prev.comments,
                blocking: prev.blocking,
                behind: prev.behind_by,
              })
            : t.tpFeedbackNone}
        </p>
      ) : null}
      {previous ? (
        <div>
          <span className="text-fg-3">{t.tpCmpChanged}: </span>
          {changes.length > 0 ? changes.join(" · ") : <span className="text-fg-2">{t.tpCmpSame}</span>}
        </div>
      ) : changes.length > 0 ? (
        <p>{changes.join(" · ")}</p>
      ) : null}
      <p>
        <span className="text-fg-3">{t.tpCmpEnded}: </span>
        {t.tpCmpEnd(t[`tlResult_${attempt.result}` as const], e ? (e.reason ?? `${word(stages, "s_", e.stage)}: ${word(stages, "o_", e.outcome)}`) : null)}
      </p>
    </div>
  );
}

/** The bar of an attempt scaled to the longest one: filled = work, hollow = waiting. */
function Ladder({ request, selected, onSelect, t, stages }: { request: TimelineRequest; selected: number; onSelect: (n: number) => void; t: Words; stages: Stages }) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const toggle = (n: number) => setOpen((o) => { const next = new Set(o); if (!next.delete(n)) next.add(n); return next; });
  const longest = Math.max(1, ...request.attempts.map((a) => ms(a.end) - ms(a.start)));
  return (
    <ol className="flex flex-col divide-y divide-edge-subtle" data-attempt-ladder>
      {request.attempts.map((a, i) => {
        const dur = ms(a.end) - ms(a.start);
        const result = t[`tlResult_${a.result}` as const];
        return (
          <li key={a.n}>
            <div className="flex items-start gap-2">
            <button
              type="button"
              aria-expanded={open.has(a.n)}
              aria-label={t.tpToggle(a.n)}
              onClick={() => toggle(a.n)}
              className="w-6 shrink-0 py-2 text-left text-fg-3 outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
            >
              <span aria-hidden="true">{open.has(a.n) ? "▾" : "▸"}</span>
            </button>
            <button
              type="button"
              aria-pressed={a.n === selected}
              aria-label={t.tpAttemptButton(a.n, result)}
              onClick={() => onSelect(a.n)}
              className={cn(
                "flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 py-2 text-left text-sm outline-none focus-visible:outline-2 focus-visible:outline-focus",
                a.n === selected ? "font-medium" : "",
              )}
            >
              <span className="w-6 tabular-nums text-fg-3">{a.n}</span>
              <span className="flex h-2 min-w-24 flex-1 basis-40 items-center" aria-hidden="true">
                <span className="flex h-2 gap-px" style={{ width: `${Math.max(4, (dur / longest) * 100)}%` }}>
                  {flattenSegments(a.segments).map((s, i) => (
                    <span
                      key={`${s.stage}-${i}`}
                      className={cn(
                        "block h-full",
                        s.outcome === "running" ? "bg-info" : "",
                        s.outcome !== "running" && s.kind === "builder" ? "bg-fg" : "",
                        s.outcome !== "running" && s.kind === "prep" ? "bg-edge-strong" : "",
                        s.outcome !== "running" && (s.kind === "light" || s.kind === "review") ? "bg-fg-3" : "",
                        s.kind === "wait" ? "border border-edge-control" : "",
                        s.kind === "main" ? "border border-dashed border-edge-control" : "",
                      )}
                      style={{ flexGrow: Math.max(1, ms(s.end) - ms(s.start)), flexBasis: 0, minWidth: 1 }}
                    />
                  ))}
                </span>
                {a.result === "failed" || a.result === "changes_requested" ? <span className={cn("ml-0.5 h-3.5 w-0.5", a.result === "failed" ? "bg-danger" : "bg-warning")} /> : null}
              </span>
              <span className="tabular-nums text-fg-2">{compact(dur)}</span>
              <span className={cn(a.result === "failed" ? "text-danger-text" : a.result === "changes_requested" ? "text-warning-text" : "text-fg-2")}>{result}</span>
              {a.builder?.model ? <span className="text-fg-3">{a.builder.model}</span> : null}
              {a.ended_by?.reason ? <span className="min-w-0 basis-full break-words text-xs text-fg-3 sm:basis-auto sm:flex-1">{a.ended_by.reason}</span> : null}
            </button>
            </div>
            {open.has(a.n) ? <Compare attempt={a} previous={request.attempts[i - 1]} t={t} stages={stages} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function TaskPath({
  projectId,
  request,
  attempt,
  onSelect,
  t,
}: {
  projectId: string;
  request: TimelineRequest;
  attempt: TimelineAttempt;
  onSelect: (s: Selection) => void;
  t: Words;
}) {
  const stages = useMessages(AGENT_BUILD);
  const previous = request.attempts.find((a) => a.n === attempt.n - 1);
  return (
    <div className="flex flex-col gap-4" data-task-path-view={request.task_code}>
      <div className="flex flex-col gap-0.5">
        <Link
          to="/p/$projectId/records/$code"
          params={{ projectId, code: request.task_code }}
          className="font-medium text-fg hover:underline"
        >
          {request.task_title ?? request.task_code}
          <span className="ml-2 font-code text-xs text-fg-3">{request.task_code}</span>
        </Link>
        {request.feature ? (
          <p className="text-sm text-fg-2">
            {t.tpFeature} <Code>{request.feature.code}</Code> {request.feature.title}
          </p>
        ) : null}
      </div>
      <Chain request={request} selected={attempt.n} onSelect={(n) => onSelect({ request: request.id, attempt: n })} t={t} />
      <Checkpoint attempt={attempt} t={t} stages={stages} />
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2">
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="8" aria-hidden="true">
            <rect x="0" y="1" width="22" height="6" className="fill-fg" />
          </svg>
          {t.tpLgWork}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="8" aria-hidden="true">
            <rect x="0.5" y="1.5" width="21" height="5" className="fill-none stroke-edge-control" />
          </svg>
          {t.tpLgWait}
        </span>
      </p>
      <div className="grid gap-x-10 gap-y-5 lg:grid-cols-2">
        <section className="flex flex-col gap-2" aria-label={t.tpIn}>
          <h4 className="text-xs font-medium text-fg-3">{t.tpIn}</h4>
          <Entered attempt={attempt} previous={previous} t={t} stages={stages} />
        </section>
        <section className="flex flex-col gap-2" aria-label={t.tpOut}>
          <h4 className="text-xs font-medium text-fg-3">{t.tpOut}</h4>
          <Came request={request} attempt={attempt} t={t} />
        </section>
      </div>
      {attempt.merged_at && request.context ? <Context context={request.context} t={t} /> : null}
      {request.attempts.length > 1 ? (
        <section className="flex flex-col gap-1" aria-label={t.tpAttempts}>
          <h4 className="text-xs font-medium text-fg-3">{t.tpAttempts}</h4>
          <p className="text-xs text-fg-3 max-w-prose">{t.tpAttemptsNote}</p>
          <Ladder request={request} selected={attempt.n} onSelect={(n) => onSelect({ request: request.id, attempt: n })} t={t} stages={stages} />
        </section>
      ) : null}
    </div>
  );
}
