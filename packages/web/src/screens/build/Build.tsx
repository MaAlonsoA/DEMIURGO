// The project's Build page (FDR-BUI-002): the tasks that can be built now, in the server's build
// order (never re-sorted here), with their size, checks and brief; "Start build" records a request
// after one confirmation (nothing is launched), "Withdraw" closes it. Below, Waiting lists the approved
// tasks that cannot be built yet with the server's reasons, and the open requests that went stale.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useCommand } from "../../api/commands.ts";
import { buildQueueQuery, projectsQuery } from "../../api/queries.ts";
import type { BuildQueue, DeliveryMetrics, QueueTask } from "../../api/types.ts";
import { Code } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/Dialog.tsx";
import { Checkbox, Field, Select, TextArea, TextInput } from "../../components/Field.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { PlayIcon } from "../../components/icons.tsx";
import { ErrorNotice, Notice } from "../../components/Notice.tsx";
import {
  PageBody,
  PageHeader,
  Section,
  usePageTitle,
} from "../../components/Page.tsx";
import { Bone, Skeleton } from "../../components/Spinner.tsx";
import { RelativeTime } from "../../components/Time.tsx";
import { Who } from "../../components/Who.tsx";
import { announce } from "../../components/announce.tsx";
import { useMessages } from "../../i18n/define.ts";
import { useProjectId } from "../../lib/hooks.ts";
import { AgentBuildButton, BuilderFailure } from "../record/AgentBuild.tsx";
import { AGENT_BUILD } from "../record/agentBuild.i18n.ts";
import { CopyBriefButton } from "../record/CopyBrief.tsx";
import { TestabilityLines } from "../record/Testability.tsx";
import { TouchesLine } from "../record/Touches.tsx";
import { Bounces } from "./Bounces.tsx";
import { BuildTimelineView } from "./Timeline.tsx";
import { groupModuleWaiting, itemLabel, kindsOf } from "./moduleWaitingLogic.ts";
import { sharesLine } from "./timelineLogic.ts";
import { workKind } from "./technical.ts";
import { BUILD } from "./words.i18n.ts";

type Words = typeof BUILD.en;

const runningStage = (task: QueueTask) => task.stage?.outcome === 'started' || task.stage?.outcome === 'waiting';

function TaskLine({
  projectId,
  task,
  t,
}: {
  projectId: string;
  task: QueueTask;
  t: Words;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          to="/p/$projectId/records/$code"
          params={{ projectId, code: task.code }}
          className="font-medium text-fg hover:underline"
        >
          {task.title}
          <span className="ml-2 font-mono text-xs text-fg-3">{task.code}</span>
        </Link>
        <span className="text-sm tabular-nums text-fg-2" data-size>
          {task.size && task.points !== null
            ? t.size(task.size, task.points)
            : t.noSize}
        </span>
        <span className="text-sm tabular-nums text-fg-3" data-checks>
          {t.checks(task.checks)}
        </span>
      </div>
      <p className="flex flex-wrap gap-x-2 text-sm text-fg-2">
        {task.feature ? (
          <span>
            {t.feature} <Code>{task.feature.code}</Code> {task.feature.title}
          </span>
        ) : null}
        {workKind(task) === "technical" && task.technical ? (
          <span data-technical-work>
            {t.technicalWork} · {t.basedOn} <Code>{task.technical.code}</Code> {task.technical.title}
          </span>
        ) : null}
        {task.epic ? (
          <>
            <span aria-hidden>·</span>
            <span>
              {t.epic} <Code>{task.epic.code}</Code> {task.epic.title}
            </span>
          </>
        ) : null}
      </p>
      <TouchesLine touches={task.touches} />
      <TestabilityLines flags={task.testability} />
    </div>
  );
}

function RequestState({ task, t }: { task: QueueTask; t: Words }) {
  const a = useMessages(AGENT_BUILD);
  const r = task.request;
  if (!r) return <span className="text-sm font-medium text-fg">{t.ready}</span>;
  return (
    <span className="flex flex-col gap-0.5 text-sm text-fg-2" data-requested>
      <span className="flex flex-wrap items-center gap-x-1.5">
        <Who actor={r.requested_by} size={16} prefix={t.requested} />
        <span aria-hidden>,</span>
        <RelativeTime iso={r.requested_at} />
        {r.state === "in_review" ? (
          <span className="font-medium text-fg">· {t.inReview}</span>
        ) : null}
      </span>
      {task.stage ? (
        <span className="font-medium text-fg" data-stage>
          {a[`s_${task.stage.stage}` as const]} · {a[`o_${task.stage.outcome}` as const]}
        </span>
      ) : null}
      {task.stage?.outcome === "failed" ? (
        <BuilderFailure kind={task.stage.failure?.kind} excerpt={task.stage.failure?.excerpt} />
      ) : null}
      {r.pr_url ? (
        <a
          href={r.pr_url}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-fg-2 underline"
          data-pr-url
        >
          {r.pr_url}
        </a>
      ) : null}
      {r.stale ? (
        <span className="font-medium text-fg" data-stale>
          {t.staleNote} {r.stale_reasons.join(" ")}
        </span>
      ) : null}
    </span>
  );
}

function Actions({
  projectId,
  task,
  t,
  canStart,
}: {
  projectId: string;
  task: QueueTask;
  t: Words;
  canStart: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  const request = useCommand(projectId);
  const agent = useCommand(projectId);
  const withdraw = useCommand(projectId);
  const review = useCommand(projectId);
  const [pr, setPr] = useState("");
  const client = useQueryClient();
  const a = useMessages(AGENT_BUILD);
  // The queue changes with the request: refresh it now, not only when the live event arrives.
  const refresh = () =>
    void client.invalidateQueries({
      queryKey: buildQueueQuery(projectId).queryKey,
    });
  // With an agent able to build (GitHub connected) one click records the request and starts the build.
  const agentCanBuild = !!task.github;
  const start = () => {
    if (request.isPending || agent.isPending) return;
    request.mutate(
      { command: "build_request.request", data: { task: task.code } },
      {
        onSuccess: () => {
          refresh();
          announce(t.requestedDone(task.code));
          if (!agentCanBuild) {
            setConfirming(false);
            return;
          }
          agent.mutate(
            { command: "build.start", data: { task: task.code } },
            {
              onSuccess: () => {
                void client.invalidateQueries({ queryKey: ["p", projectId] });
                announce(a.build);
              },
              // The request is recorded: the dialog closes and «Build with an agent» offers the retry.
              onSettled: () => setConfirming(false),
            },
          );
        },
      },
    );
  };
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {canStart ? (
          <CopyBriefButton projectId={projectId} code={task.code} size="sm" />
        ) : null}
        {task.request?.state === "requested" ? (
          <form
            className="flex items-center gap-2"
            data-pr-form
            onSubmit={(ev) => {
              ev.preventDefault();
              if (!pr.trim() || review.isPending) return;
              review.mutate(
                {
                  command: "build_request.submit_review",
                  entityId: task.request?.id,
                  data: { pr_url: pr.trim() },
                },
                {
                  onSuccess: () => {
                    setPr("");
                    refresh();
                    announce(t.inReviewDone(task.code));
                  },
                },
              );
            }}
          >
            <TextInput
              aria-label={t.prUrlLabel(task.code)}
              placeholder={t.prUrl}
              value={pr}
              maxLength={500}
              onChange={(x) => setPr(x.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              pending={review.isPending}
              disabled={!pr.trim()}
            >
              {t.toReview}
            </Button>
          </form>
        ) : null}
        {task.request?.state === "in_review" ? (
          <Button
            size="sm"
            variant="primary"
            pending={review.isPending}
            aria-label={t.markDoneLabel(task.code)}
            data-mark-done={task.code}
            onClick={() =>
              review.mutate(
                {
                  command: "build_request.complete",
                  entityId: task.request?.id,
                },
                {
                  onSuccess: () => {
                    refresh();
                    announce(t.doneDone(task.code));
                  },
                },
              )
            }
          >
            {t.markDone}
          </Button>
        ) : null}
        {task.github && task.request && !runningStage(task) ? (
          <AgentBuildButton
            projectId={projectId}
            code={task.code}
            variant="secondary"
            size="sm"
            again={task.stage ? task.stage.outcome === 'failed' || task.stage.outcome === 'changes_requested' : false}
          />
        ) : null}
        {task.request ? (
          <Button
            size="sm"
            variant="quiet"
            pending={withdraw.isPending}
            disabled={withdraw.isPending}
            aria-label={t.withdrawLabel(task.code)}
            data-withdraw={task.code}
            onClick={() => setConfirmingWithdraw(true)}
          >
            {t.withdraw}
          </Button>
        ) : canStart ? (
          <HoldButton projectId={projectId} task={task} t={t} onDone={refresh} />
        ) : null}
        {!task.request && canStart ? (
          <Button
            size="sm"
            variant="primary"
            icon={<PlayIcon size={14} />}
            aria-label={t.startLabel(task.code)}
            data-start-build={task.code}
            onClick={() => {
              request.reset();
              agent.reset();
              setConfirming(true);
            }}
          >
            {t.start}
          </Button>
        ) : null}
      </div>
      {review.error ? <ErrorNotice error={review.error} compact /> : null}
      {agent.error ? <ErrorNotice error={agent.error} compact /> : null}
      {withdraw.error ? <ErrorNotice error={withdraw.error} compact /> : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!request.isPending && !agent.isPending) setConfirming(open);
        }}
        title={t.confirmTitle(task.code)}
        description={<p>{agentCanBuild ? t.confirmBodyAgent : t.confirmBody}</p>}
        confirm={agentCanBuild ? t.confirmAgent : t.confirm}
        onConfirm={start}
        pending={request.isPending || agent.isPending}
        error={request.error}
      />
      {/* Withdrawing closes the pull request and drops the attempts in flight: it asks first. */}
      <ConfirmDialog
        open={confirmingWithdraw}
        onOpenChange={(open) => {
          if (!withdraw.isPending) setConfirmingWithdraw(open);
        }}
        title={t.withdrawConfirmTitle(task.code)}
        description={<p>{task.request?.pr_url ? t.withdrawConfirmBodyPr : t.withdrawConfirmBody}</p>}
        confirm={t.withdraw}
        onConfirm={() =>
          withdraw.mutate(
            { command: "build_request.withdraw", entityId: task.request?.id },
            {
              onSuccess: () => {
                setConfirmingWithdraw(false);
                refresh();
                announce(t.withdrawn(task.code));
              },
            },
          )
        }
        pending={withdraw.isPending}
        error={withdraw.error}
      />
    </div>
  );
}

/** «Put on hold»: a task that cannot be built yet (an outside prerequisite) leaves the queue with its reason. */
function HoldButton({ projectId, task, t, onDone }: { projectId: string; task: QueueTask; t: Words; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const hold = useCommand(projectId);
  const submit = () => {
    if (!reason.trim() || hold.isPending) return;
    hold.mutate(
      { command: "task.hold", entityId: projectId, data: { task: task.code, reason: reason.trim() } },
      {
        onSuccess: () => {
          setOpen(false);
          setReason("");
          onDone();
          announce(t.holdDone(task.code));
        },
      },
    );
  };
  return (
    <>
      <Button
        size="sm"
        variant="quiet"
        aria-label={t.holdLabel(task.code)}
        data-hold={task.code}
        onClick={() => {
          hold.reset();
          setOpen(true);
        }}
      >
        {t.hold}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          if (!hold.isPending) setOpen(o);
        }}
        title={t.holdTitle(task.code)}
        description={<p>{t.holdBody}</p>}
        confirm={t.holdConfirm}
        onConfirm={submit}
        pending={hold.isPending}
        error={hold.error}
      >
        <Field label={t.holdReason} hint={t.holdReasonHint} count={[reason.length, 1000]}>
          {(props) => (
            <TextArea
              {...props}
              value={reason}
              maxLength={1000}
              autoGrow
              data-hold-reason
              onChange={(ev) => setReason(ev.target.value)}
            />
          )}
        </Field>
      </ConfirmDialog>
    </>
  );
}

/** A held task: its reason, who and when, and «Release». */
function HeldLine({ projectId, task, t }: { projectId: string; task: BuildQueue["held"][number]; t: Words }) {
  const release = useCommand(projectId);
  const client = useQueryClient();
  return (
    <li data-held-task={task.code} className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="flex min-w-0 flex-col gap-1">
        <TaskLine projectId={projectId} task={task} t={t} />
        <p className="text-sm text-fg" data-hold-reason-text>
          {task.hold.reason}
        </p>
        <span className="flex flex-wrap items-center gap-x-1.5 text-sm text-fg-2">
          <Who actor={task.hold.held_by} size={16} prefix={t.heldBy} />
          <span aria-hidden>,</span>
          <RelativeTime iso={task.hold.held_at} />
        </span>
      </div>
      <div className="ml-auto flex flex-col items-end gap-2">
        <Button
          size="sm"
          variant="secondary"
          pending={release.isPending}
          aria-label={t.releaseLabel(task.code)}
          data-release={task.code}
          onClick={() =>
            release.mutate(
              { command: "task.release", entityId: projectId, data: { task: task.code } },
              {
                onSuccess: () => {
                  void client.invalidateQueries({ queryKey: buildQueueQuery(projectId).queryKey });
                  announce(t.released(task.code));
                },
              },
            )
          }
        >
          {t.release}
        </Button>
        {release.error ? <ErrorNotice error={release.error} compact /> : null}
      </div>
    </li>
  );
}

/** «Build the queue»: the person's switch and what the queue is doing (the server decides; nothing is computed here). */
function AutoQueue({ projectId, auto, t }: { projectId: string; auto: NonNullable<BuildQueue["auto"]>; t: Words }) {
  const command = useCommand(projectId);
  const client = useQueryClient();
  const s = auto.stopped;
  const waitingSchema = auto.schema_waiting && auto.schema_waiting.length > 0 ? ` ${t.autoSchemaWaiting(auto.schema_waiting)}` : "";
  const waitingTestability = auto.testability_waiting && auto.testability_waiting.length > 0 ? ` ${t.autoTestabilityWaiting(auto.testability_waiting)}` : "";
  const base = !auto.on
    ? null
    : s
      ? s.kind === "needs_you"
        ? t.autoNeedsYou(s.code, s.tried)
        : s.kind === "waiting"
          ? t.autoWaiting(s.code)
          : s.kind === "main_red"
          ? t.autoMainRed(s.code)
          : s.kind === "ended"
          ? t.autoEnded(s.code)
          : s.kind === "stale"
            ? t.autoStale(s.code)
            : t.autoManual(s.code)
      : auto.builds.length
        ? t.autoBuilding(auto.builds, auto.next)
        : auto.next
          ? t.autoNext(auto.next)
          : t.autoIdle;
  const status = base !== null && !s ? `${base}${waitingSchema}${waitingTestability}` : base;
  return (
    <section className="flex flex-col gap-2" data-auto-queue data-auto-on={auto.on ? "true" : "false"}>
      <Checkbox
        checked={auto.on}
        disabled={command.isPending}
        label={<span className="font-medium">{t.auto}</span>}
        onChange={(on) =>
          command.mutate(
            { command: "build.queue_auto", entityId: projectId, data: { on } },
            {
              onSuccess: () => {
                void client.invalidateQueries({ queryKey: buildQueueQuery(projectId).queryKey });
                announce(on ? t.autoOn : t.autoOff);
              },
            },
          )
        }
      />
      <p className="text-sm text-fg-2">{t.autoText}</p>
      <label className="flex items-center gap-2 text-sm text-fg-2" title={t.autoParallelText}>
        <span>{t.autoParallel}</span>
        <span className="w-20">
          <Select
            aria-label={t.autoParallel}
            value={auto.parallel}
            disabled={command.isPending}
            onChange={(e) =>
              command.mutate(
                { command: "build.queue_auto", entityId: projectId, data: { parallel: Number(e.target.value) } },
                { onSuccess: () => void client.invalidateQueries({ queryKey: buildQueueQuery(projectId).queryKey }) },
              )
            }
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </span>
      </label>
      {status ? (
        s ? (
          <Notice tone="warning" title={status} />
        ) : (
          <p className="text-sm font-medium text-fg" data-auto-status>
            {status}
          </p>
        )
      ) : null}
      {auto.on && !s && auto.module_waiting && auto.module_waiting.length > 0 ? <ModuleWaiting projectId={projectId} entries={auto.module_waiting} t={t} /> : null}
      {auto.quarantined && auto.quarantined.length > 0 ? (
        <p className="text-sm text-fg-2" data-quarantined>
          {t.quarantined(auto.quarantined.join(", "))}
        </p>
      ) : null}
      {command.error ? <ErrorNotice error={command.error} compact /> : null}
    </section>
  );
}

function TaskLink({ projectId, code }: { projectId: string; code: string }) {
  return (
    <Link to="/p/$projectId/records/$code" params={{ projectId, code }} className="hover:underline">
      <Code>{code}</Code>
    </Link>
  );
}

/** What the queue holds back because two builds would change the same thing, grouped by what blocks (the server decides). */
function ModuleWaiting({ projectId, entries, t }: { projectId: string; entries: NonNullable<NonNullable<BuildQueue["auto"]>["module_waiting"]>; t: Words }) {
  const groups = groupModuleWaiting(entries);
  return (
    <div className="flex flex-col gap-2 text-sm text-fg-2" data-module-waiting>
      <p className="font-medium text-fg">{t.moduleWaitingTitle(kindsOf(groups).map((k) => t.moduleKind(k)))}</p>
      {groups.map((g) => (
        <div key={`${g.item}|${g.with}`} className="flex flex-col gap-0.5" data-module-group={g.item}>
          <span>
            <Code>{itemLabel(g.item)}</Code> {t.moduleKind(g.kind)}
            {g.hotspot ? ` · ${t.moduleHotspot(g.hotspot)}` : ""}
          </span>
          <span>
            {t.moduleHeldBy} <TaskLink projectId={projectId} code={g.with} /> ({g.source === "actual" ? t.moduleHeldActual : t.moduleHeldPredicted})
          </span>
          <span>
            {t.moduleWaitingTasks}{" "}
            {g.waiting.map((c, i) => (
              <span key={c}>
                {i > 0 ? ", " : ""}
                <TaskLink projectId={projectId} code={c} />
              </span>
            ))}
          </span>
          <span>{t.moduleStartsWhen(g.waiting.length, g.with)}</span>
        </div>
      ))}
      <p className="text-fg-3">{t.moduleWhy}</p>
    </div>
  );
}

const fmt = (n: number | null) => (n === null ? "–" : String(n));
const th = "px-3 py-2 text-xs font-medium text-fg-2 whitespace-nowrap";
const td = "px-3 py-2 tabular-nums";

function Delivery({ d, t, hotspots, bounces }: { d: DeliveryMetrics; t: Words; hotspots?: { path: string; tasks: number; of: number }[]; bounces?: BuildQueue["bounces"] }) {
  const a = useMessages(AGENT_BUILD);
  const s = d.last10;
  const models = d.by_model_last10;
  return (
    <Section id="build-delivery" title={t.delivery} note={t.deliveryHint}>
      {s.first_pass === null ? (
        <p className="text-sm text-fg-2">{t.deliveryNone}</p>
      ) : (
        <div className="flex flex-col gap-3" data-build-delivery>
          <p className="text-sm font-medium text-fg tabular-nums" data-delivery-summary>
            {t.deliverySummary({
              n: s.tasks,
              lead: fmt(s.lead_median),
              builder: fmt(s.builder_median),
              ci: fmt(s.ci_median),
              review: fmt(s.review_median),
              first: s.first_pass.merged_first_try,
              of: s.first_pass.of,
            })}
          </p>
          {s.flow_median !== null ? (
            <p className="text-sm text-fg-2 tabular-nums" data-delivery-flow>
              {t.flowSummary({ shares: sharesLine(s.flow_median, { build: t.flowBuild, ci: t.flowCi, review: t.flowReview, wait: t.flowWait }), trend: d.lead_trend.join(", ") })}
            </p>
          ) : null}
          {d.context.recall !== null && d.context.precision !== null ? (
            <p className="text-sm text-fg-2 tabular-nums" data-delivery-context>
              {t.contextSummary({ n: d.context.tasks, recall: d.context.recall, precision: d.context.precision })}
            </p>
          ) : null}
          {hotspots && hotspots.length > 0 ? (
            <div className="flex flex-col gap-0.5 text-sm text-fg-2 tabular-nums" data-delivery-hotspots>
              <span className="text-xs font-medium text-fg-3">{t.hotspots}</span>
              {hotspots.map((h) => (
                <span key={h.path}>{t.hotspotLine(h)}</span>
              ))}
            </div>
          ) : null}
          <Bounces bounces={bounces} t={t} />
          {models.length > 0 ? (
            <div className="flex flex-col gap-0.5 text-sm text-fg-2 tabular-nums" data-delivery-models>
              <span className="text-xs font-medium text-fg-3">{t.deliveryByModel}</span>
              {models.map((m) => (
                <span key={m.model}>
                  {t.deliveryModelLine({
                    model: m.model,
                    n: m.tasks,
                    lead: fmt(m.lead_median),
                    builder: fmt(m.builder_median),
                    ci: fmt(m.ci_median),
                    review: fmt(m.review_median),
                  })}
                </span>
              ))}
            </div>
          ) : null}
          <div tabIndex={0} className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left text-sm">
              <caption className="sr-only">{t.deliveryCaption}</caption>
              <thead>
                <tr className="border-b border-edge-subtle">
                  <th scope="col" className={th}>{t.colTask}</th>
                  <th scope="col" className={`${th} text-right`}>{t.colLead}</th>
                  <th scope="col" className={`${th} text-right`}>{t.colAttempts}</th>
                  <th scope="col" className={`${th} text-right`}>{t.colBuilder}</th>
                  <th scope="col" className={`${th} text-right`}>{t.colCi}</th>
                  <th scope="col" className={`${th} text-right`}>{t.colReview}</th>
                  <th scope="col" className={th}>{t.colModel}</th>
                </tr>
              </thead>
              <tbody>
                {d.merged.map((m) => (
                  <tr key={m.code} className="border-b border-edge-subtle last:border-b-0" data-delivery-task={m.code}>
                    <th scope="row" className="px-3 py-2 font-normal">
                      <Code>{m.code}</Code>
                    </th>
                    <td className={`${td} text-right`}>{m.lead_minutes}</td>
                    <td className={`${td} text-right`}>{m.attempts}</td>
                    <td className={`${td} text-right text-fg-2`}>{m.stage_minutes.builder}</td>
                    <td className={`${td} text-right text-fg-2`}>{m.stage_minutes.ci}</td>
                    <td className={`${td} text-right text-fg-2`}>{m.stage_minutes.review}</td>
                    <td className="px-3 py-2 text-fg-2">{m.model ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {d.running.map((r) => (
        <p key={r.code} className="text-sm text-fg-2 tabular-nums" data-delivery-running={r.code}>
          {t.deliveryRunning(r.code, Math.round(r.elapsed_minutes), a[`s_${r.stage}` as keyof typeof a] as string)}
        </p>
      ))}
    </Section>
  );
}

export function BuildScreen() {
  const t = useMessages(BUILD);
  const projectId = useProjectId();
  // While an automatic build runs the server moves on its own: look again every 10 s.
  const queue = useQuery({
    ...buildQueueQuery(projectId),
    refetchInterval: (q) =>
      q.state.data?.auto?.on ||
      [...(q.state.data?.ready ?? []), ...(q.state.data?.waiting ?? []), ...(q.state.data?.stale ?? [])].some(runningStage)
        ? 10_000
        : false,
  });
  const project = (useQuery(projectsQuery).data ?? []).find(
    (p) => p.id === projectId,
  );
  usePageTitle([t.title, project?.name]);
  const q = queue.data;

  return (
    <>
      <PageHeader title={t.title} meta={t.meta} />
      <PageBody className="flex flex-col gap-8">
        {queue.error ? <ErrorNotice error={queue.error} /> : null}
        {!q ? (
          queue.isPending ? (
            <Skeleton label={t.loading}>
              <Bone className="h-6 w-64" />
              <Bone className="h-16 w-full" />
            </Skeleton>
          ) : null
        ) : (
          <>
            <BuildTimelineView projectId={projectId} timeline={q.timeline} needsYou={q.auto?.stopped?.kind === 'needs_you' ? q.auto.stopped.code : null} t={t} />
            {q.auto ? <AutoQueue projectId={projectId} auto={q.auto} t={t} /> : null}
            <Section
              id="build-queue"
              title={t.queue}
              note={
                <span
                  className="flex flex-wrap gap-x-2 tabular-nums"
                  data-build-totals
                >
                  <span>{t.totals(q.totals.tasks, q.totals.points)}</span>
                  {q.totals.unsized > 0 ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className="text-fg-3">
                        {t.unsized(q.totals.unsized)}
                      </span>
                    </>
                  ) : null}
                  <span aria-hidden>·</span>
                  <span className="text-fg-3">
                    {t.repository(q.repository.path, q.repository.branch)}
                  </span>
                  {q.repository.merge_rule_by_demiurgo ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className="text-fg-3">{t.mergeRule}</span>
                    </>
                  ) : null}
                </span>
              }
            >
              {q.ready.length === 0 ? (
                <EmptyState title={t.empty} />
              ) : (
                <ol
                  className="flex flex-col divide-y divide-edge-subtle rounded-lg border border-edge bg-panel px-4"
                  data-build-queue
                >
                  {q.ready.map((task) => (
                    <li
                      key={task.code}
                      data-queue-task={task.code}
                      className="flex flex-wrap items-start justify-between gap-3 py-3"
                    >
                      <TaskLine projectId={projectId} task={task} t={t} />
                      <div className="ml-auto flex flex-col items-end gap-2">
                        <RequestState task={task} t={t} />
                        <Actions
                          projectId={projectId}
                          task={task}
                          t={t}
                          canStart
                        />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Section>

            {q.delivery ? <Delivery d={q.delivery} t={t} hotspots={q.hotspots} bounces={q.bounces} /> : null}

            {(q.held ?? []).length > 0 ? (
              <Section id="build-held" title={t.held((q.held ?? []).length)} note={t.heldNote}>
                <ul className="flex flex-col divide-y divide-edge-subtle" data-build-held>
                  {(q.held ?? []).map((task) => (
                    <HeldLine key={task.code} projectId={projectId} task={task} t={t} />
                  ))}
                </ul>
              </Section>
            ) : null}

            <Section id="build-waiting" title={t.waiting} note={t.waitingNote}>
              {q.waiting.length === 0 ? (
                <p className="text-sm text-fg-2">{t.noWaiting}</p>
              ) : (
                <ul
                  className="flex flex-col divide-y divide-edge-subtle"
                  data-build-waiting
                >
                  {q.waiting.map((task) => (
                    <li
                      key={task.code}
                      data-waiting-task={task.code}
                      className="flex flex-wrap items-start justify-between gap-3 py-3"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <TaskLine projectId={projectId} task={task} t={t} />
                        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm text-fg-2">
                          {task.reasons.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      </div>
                      {task.request ? (
                        <div className="ml-auto flex flex-col items-end gap-2">
                          <RequestState task={task} t={t} />
                          <Actions
                            projectId={projectId}
                            task={task}
                            t={t}
                            canStart={false}
                          />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {q.built.length > 0 ? (
              <Section id="build-built" title={t.built}>
                <details data-build-built>
                  <summary className="cursor-pointer text-sm text-fg-2">
                    {t.builtNote(q.built.length)}
                  </summary>
                  <ul className="flex flex-col divide-y divide-edge-subtle">
                    {q.built.map((task) => (
                      <li
                        key={task.code}
                        data-built-task={task.code}
                        className="flex flex-wrap items-start justify-between gap-3 py-3"
                      >
                        <TaskLine projectId={projectId} task={task} t={t} />
                        {task.pr_url ? (
                          <a
                            className="ml-auto text-sm text-accent-text underline"
                            href={task.pr_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t.pullRequest}
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              </Section>
            ) : null}

            {q.stale.length > 0 ? (
              <Section id="build-stale" title={t.stale} note={t.staleSection}>
                <ul
                  className="flex flex-col divide-y divide-edge-subtle"
                  data-build-stale
                >
                  {q.stale.map((task) => (
                    <li
                      key={task.code}
                      className="flex flex-wrap items-start justify-between gap-3 py-3"
                    >
                      <TaskLine projectId={projectId} task={task} t={t} />
                      <div className="ml-auto flex flex-col items-end gap-2">
                        <RequestState task={task} t={t} />
                        <Actions
                          projectId={projectId}
                          task={task}
                          t={t}
                          canStart={false}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}
          </>
        )}
      </PageBody>
    </>
  );
}
