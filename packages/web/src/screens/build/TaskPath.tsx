// «Path» of one attempt of a task: its stages as a flow (filled link = work, hollow = waiting for CI), what
// entered the builder (code to extend, affected tests, progress notes, session, feedback of the previous attempt)
// and what came out (pull request, CI, review, merge), and the ladder of every attempt with how it ended.
// All of it comes from the build steps the server already keeps; where a fact was not kept the view says so.

import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import type { TimelineAttempt, TimelineContext, TimelineRequest } from "../../api/types.ts";
import { Code } from "../../components/Badge.tsx";
import { Who } from "../../components/Who.tsx";
import { cn } from "../../lib/cn.ts";
import { useMessages } from "../../i18n/define.ts";
import { AGENT_BUILD } from "../record/agentBuild.i18n.ts";
import { PATH_STAGES, type Selection, type StageState, compact, ms, stageStates } from "./timelineLogic.ts";
import type { BUILD } from "./words.i18n.ts";

type Words = typeof BUILD.en;
type Stages = typeof AGENT_BUILD.en;

const NODE_W = 120;
const DOT_Y = 18;

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

function Glyph({ state, cx }: { state: StageState; cx: number }) {
  switch (state) {
    case "done":
      return <circle cx={cx} cy={DOT_Y} r={6} className="fill-fg" />;
    case "running":
      return (
        <>
          <circle cx={cx} cy={DOT_Y} r={10} className="fill-none stroke-info opacity-40" strokeWidth={2} />
          <circle cx={cx} cy={DOT_Y} r={6} className="fill-info" />
        </>
      );
    case "failed":
      return (
        <>
          <circle cx={cx} cy={DOT_Y} r={7} className="fill-panel stroke-danger" strokeWidth={2} />
          <path d={`M ${cx - 3} ${DOT_Y - 3} l 6 6 M ${cx + 3} ${DOT_Y - 3} l -6 6`} className="stroke-danger" strokeWidth={1.5} />
        </>
      );
    case "changes":
      return (
        <>
          <circle cx={cx} cy={DOT_Y} r={7} className="fill-panel stroke-danger" strokeWidth={2} />
          <circle cx={cx} cy={DOT_Y} r={2.5} className="fill-danger" />
        </>
      );
    case "cancelled":
      return (
        <>
          <circle cx={cx} cy={DOT_Y} r={7} className="fill-panel stroke-edge-control" strokeWidth={1.5} />
          <path d={`M ${cx - 3} ${DOT_Y} h 6`} className="stroke-edge-control" strokeWidth={1.5} />
        </>
      );
    case "pending":
      return <circle cx={cx} cy={DOT_Y} r={6} className="fill-none stroke-edge-control" strokeWidth={1.5} strokeDasharray="3 2" />;
  }
}

function Flow({ attempt, code, t }: { attempt: TimelineAttempt; code: string; t: Words }) {
  const states = stageStates(attempt);
  const nodes = PATH_STAGES.map((stage, i) => {
    const st = states.get(stage);
    return { stage, cx: i * NODE_W + NODE_W / 2, state: (st?.state ?? "pending") as StageState, ms: st?.ms ?? 0, wait: st?.wait ?? false };
  });
  const width = PATH_STAGES.length * NODE_W;
  const height = DOT_Y + 52;
  return (
    <div className="flex flex-col gap-2">
      <div tabIndex={0} role="group" aria-label={t.tpPathLabel(code, attempt.n)} className="overflow-x-auto rounded-xs focus-visible:outline-2 focus-visible:outline-focus" data-task-path>
        <svg width={width} height={height} aria-hidden="true" className="block shrink-0">
          {nodes.map((n, i) => {
            const prev = nodes[i - 1];
            const link = prev ? (
              n.state === "pending" ? (
                <line x1={prev.cx + 12} x2={n.cx - 12} y1={DOT_Y} y2={DOT_Y} className="stroke-edge-control" strokeWidth={1.5} strokeDasharray="3 3" />
              ) : n.wait ? (
                <rect
                  x={prev.cx + 12}
                  y={DOT_Y - 3}
                  width={Math.max(0, n.cx - prev.cx - 24)}
                  height={6}
                  rx={1}
                  className={cn("fill-none", n.state === "running" ? "stroke-info" : "stroke-edge-control")}
                  strokeWidth={1}
                />
              ) : (
                <rect
                  x={prev.cx + 12}
                  y={DOT_Y - 2.5}
                  width={Math.max(0, n.cx - prev.cx - 24)}
                  height={5}
                  rx={1}
                  className={n.state === "running" ? "fill-info" : "fill-fg"}
                />
              )
            ) : null;
            const muted = n.state === "pending";
            return (
              <g key={n.stage} data-stage={n.stage} data-state={n.state}>
                {link}
                <Glyph state={n.state} cx={n.cx} />
                <text x={n.cx} y={DOT_Y + 28} textAnchor="middle" className={cn("text-xs", muted ? "fill-fg-3" : "fill-fg")}>
                  {t[`tpStage_${n.stage}` as const]}
                </text>
                {n.ms >= 1000 ? (
                  <text x={n.cx} y={DOT_Y + 44} textAnchor="middle" className="fill-fg-3 text-xs tabular-nums">
                    {compact(n.ms)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <ol className="sr-only">
        {nodes.map((n) => (
          <li key={n.stage}>{t.tpStageLabel(t[`tpStage_${n.stage}` as const], t[`tpState_${n.state}` as const], n.ms >= 1000 ? compact(n.ms) : "")}</li>
        ))}
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
                  {a.segments.map((s, i) => (
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
                {a.result === "failed" || a.result === "changes_requested" ? <span className="ml-0.5 h-3.5 w-0.5 bg-danger" /> : null}
              </span>
              <span className="tabular-nums text-fg-2">{compact(dur)}</span>
              <span className={cn(a.result === "failed" || a.result === "changes_requested" ? "text-danger-text" : "text-fg-2")}>{result}</span>
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
      <Flow attempt={attempt} code={request.task_code} t={t} />
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
