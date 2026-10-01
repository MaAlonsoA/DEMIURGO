// Build requests (FDR-BUI-002): a person asks for a ready task to be built. The request records the
// task version, its feature version, the brief composed by the server at that moment (frozen), and
// the person and time fixed by the server. It launches nothing: no process, container, worktree or
// agent. Only a person runs these commands (capability matrix): an agent gets 403.

import { DomainError, formatActor } from "@demiurgo/domain";
import { z } from "zod";
import { advanceBuildQueue, queueAutoOn, queueParallelOf } from "../build/auto.ts";
import { openHoldOf } from "../build/holds.ts";
import { composeBrief } from "../build/queue.ts";
import { githubConfig } from "../github/client.ts";
import { mergedBuildOf } from "../queries/read.ts";
import { handler, registerHandlers } from "../bus/handlers.ts";
import { buildRunning } from "./build-steps.ts";

registerHandlers({
  // «Build the queue» on or off for the project. Turning it on needs GitHub (agents build through it) and
  // asks the queue to start the first ready task right after the commit. Only a person runs it.
  "build.queue_auto": handler({
    data: z
      .object({ on: z.boolean().optional(), parallel: z.number().int().min(1).max(3).optional() })
      .strict()
      .refine((d) => d.on !== undefined || d.parallel !== undefined, "Say «on» or «parallel»."),
    async apply(ctx, data, e) {
      const before = await queueAutoOn(ctx.trx, ctx.projectId);
      const beforeParallel = await queueParallelOf(ctx.trx, ctx.projectId);
      if (data.on && githubConfig() === null)
        throw new DomainError(
          "conflict",
          "Connect GitHub first: set DEMIURGO_GITHUB_TOKEN and DEMIURGO_GITHUB_OWNER.",
        );
      const by = formatActor(ctx.actor);
      const auto = data.on ?? before;
      const parallel = data.parallel ?? beforeParallel;
      await ctx.trx
        .insertInto("build_queue_settings")
        .values({ project_id: ctx.projectId, auto, parallel, set_by: by })
        .onConflict((oc) =>
          oc.column("project_id").doUpdateSet({ auto, parallel, set_by: by, set_at: new Date() }),
        )
        .execute();
      const projectId = ctx.projectId;
      // Turning it on, or allowing more builds at once, asks the queue to start what fits (a no-op when it is off).
      if (auto) ctx.afterCommit(async () => void (await advanceBuildQueue(ctx.services, projectId)));
      return {
        entityId: e?.id ?? projectId,
        before: { auto: before, parallel: beforeParallel },
        after: { auto, parallel, set_by: by },
        result: { on: auto, parallel },
      };
    },
  }),

  // «On hold»: a person puts a task on hold with the reason it cannot be built yet, and takes it off later.
  "task.hold": handler({
    data: z.object({ task: z.string().trim().min(1).max(40), reason: z.string().trim().min(1).max(1000) }).strict(),
    async apply(ctx, data, e) {
      const task = await ctx.trx
        .selectFrom("records")
        .select(["id", "code", "type"])
        .where("project_id", "=", ctx.projectId)
        .where("code", "=", data.task)
        .forUpdate()
        .executeTakeFirst();
      if (!task) throw new DomainError("not_found", `Task ${data.task} does not exist.`);
      if (task.type !== "task") throw new DomainError("validation", `${data.task} is not a task.`);
      if (await mergedBuildOf(ctx.trx, task.id))
        throw new DomainError("guard", `${task.code} is already built: its pull request was merged.`);
      if (await openHoldOf(ctx.trx, task.id)) throw new DomainError("conflict", `${task.code} is already on hold.`);
      const open = await ctx.trx
        .selectFrom("build_requests")
        .select("id")
        .where("task_id", "=", task.id)
        .where("state", "in", ["requested", "in_review"])
        .executeTakeFirst();
      if (open && (await buildRunning(ctx.trx, open.id)))
        throw new DomainError("conflict", `A build of ${task.code} is running: withdraw it before putting the task on hold.`);
      const by = formatActor(ctx.actor);
      await ctx.trx
        .insertInto("task_holds")
        .values({ project_id: ctx.projectId, task_id: task.id, reason: data.reason, held_by: by })
        .execute();
      return {
        entityId: e?.id ?? ctx.projectId,
        after: { task: task.code, reason: data.reason, held_by: by },
        result: { task: task.code },
      };
    },
  }),

  "task.release": handler({
    data: z.object({ task: z.string().trim().min(1).max(40) }).strict(),
    async apply(ctx, data, e) {
      const task = await ctx.trx
        .selectFrom("records")
        .select(["id", "code"])
        .where("project_id", "=", ctx.projectId)
        .where("code", "=", data.task)
        .where("type", "=", "task")
        .forUpdate()
        .executeTakeFirst();
      if (!task) throw new DomainError("not_found", `Task ${data.task} does not exist.`);
      const hold = await openHoldOf(ctx.trx, task.id);
      if (!hold) throw new DomainError("conflict", `${task.code} is not on hold.`);
      const by = formatActor(ctx.actor);
      await ctx.trx
        .updateTable("task_holds")
        .set({ released_by: by, released_at: new Date() })
        .where("task_id", "=", task.id)
        .where("released_at", "is", null)
        .execute();
      // A task that is ready again makes room in «Build the queue» (a no-op with the flag off).
      const projectId = ctx.projectId;
      ctx.afterCommit(async () => void (await advanceBuildQueue(ctx.services, projectId)));
      return {
        entityId: e?.id ?? projectId,
        before: { task: task.code, reason: hold.reason, held_by: hold.held_by },
        after: { task: task.code, released_by: by },
        result: { task: task.code },
      };
    },
  }),

  "build_request.request": handler({
    data: z.object({ task: z.string().trim().min(1).max(40) }).strict(),
    async apply(ctx, data, _e, to) {
      // Lock the task: concurrent requests for it run one after the other (the unique index backs it).
      const task = await ctx.trx
        .selectFrom("records")
        .select(["id", "code", "type"])
        .where("project_id", "=", ctx.projectId)
        .where("code", "=", data.task)
        .forUpdate()
        .executeTakeFirst();
      if (!task)
        throw new DomainError("not_found", `Task ${data.task} does not exist.`);
      if (task.type !== "task")
        throw new DomainError("validation", `${data.task} is not a task.`);
      const merged = await mergedBuildOf(ctx.trx, task.id);
      if (merged) {
        throw new DomainError(
          "guard",
          `${task.code} is already built: its pull request was merged.`,
          merged.pr_url ? [`Merged pull request: ${merged.pr_url}.`] : [],
        );
      }
      const hold = await openHoldOf(ctx.trx, task.id);
      if (hold)
        throw new DomainError("guard", `${task.code} is on hold.`, [`Reason: ${hold.reason}`]);
      const open = await ctx.trx
        .selectFrom("build_requests")
        .select(["requested_by", "requested_at"])
        .where("task_id", "=", task.id)
        .where("state", "in", ["requested", "in_review"])
        .executeTakeFirst();
      if (open) {
        throw new DomainError(
          "conflict",
          `${task.code} already has an open build request.`,
          [
            `Requested by ${open.requested_by} at ${new Date(open.requested_at as unknown as Date).toISOString()}.`,
          ],
        );
      }
      const current = await ctx.trx
        .selectFrom("record_versions")
        .select(["id", "n"])
        .where("record_id", "=", task.id)
        .where("state", "=", "approved")
        .orderBy("n", "desc")
        .executeTakeFirst();
      if (!current)
        throw new DomainError("guard", `${task.code} is not approved.`);
      // Eligibility again, on the state this transaction sees: the brief refuses a task that is not
      // ready with its reasons, and a built task is not built twice.
      const brief = await composeBrief(ctx.trx, ctx.projectId, task.code, {
        forBuild: true,
      });
      const feature = await ctx.trx
        .selectFrom("links")
        .innerJoin("record_versions as t", "t.id", "links.to_id")
        .innerJoin("records as rd", "rd.id", "t.record_id")
        .select(["t.id", "t.n", "rd.code"])
        .where("links.from_id", "=", current.id)
        .where("links.type", "=", "based_on")
        .where("rd.type", "=", "fdr")
        .executeTakeFirst();
      const requestedBy = formatActor(ctx.actor);
      const row = await ctx.trx
        .insertInto("build_requests")
        .values({
          project_id: ctx.projectId,
          task_id: task.id,
          task_version_id: current.id,
          feature_version_id: feature?.id ?? null,
          brief,
          requested_by: requestedBy,
          state: to,
        })
        .returning(["id", "requested_at"])
        .executeTakeFirstOrThrow();
      const at = new Date(row.requested_at as unknown as Date).toISOString();
      return {
        entityId: row.id,
        version: current.n,
        after: {
          task: task.code,
          task_version: current.n,
          feature: feature ? `${feature.code} v${feature.n}` : null,
          requested_by: requestedBy,
          requested_at: at,
          brief,
        },
        result: {
          id: row.id,
          task: task.code,
          requested_by: requestedBy,
          requested_at: at,
        },
      };
    },
  }),

  "build_request.submit_review": handler({
    data: z.object({ pr_url: z.string().trim().url().max(500) }).strict(),
    async apply(ctx, data, e, to) {
      const id = e?.id as string;
      const by = formatActor(ctx.actor);
      await ctx.trx
        .updateTable("build_requests")
        .set({
          state: to,
          pr_url: data.pr_url,
          in_review_by: by,
          in_review_at: new Date(),
        })
        .where("id", "=", id)
        .execute();
      const task = await ctx.trx
        .selectFrom("records")
        .select("code")
        .where("id", "=", String(e?.row.task_id))
        .executeTakeFirstOrThrow();
      return {
        entityId: id,
        before: { task: task.code, state: "requested" },
        after: {
          task: task.code,
          state: to,
          pr_url: data.pr_url,
          in_review_by: by,
        },
        result: { id, task: task.code },
      };
    },
  }),

  "build_request.complete": handler({
    data: z.object({}).strict(),
    async apply(ctx, _data, e, to) {
      const id = e?.id as string;
      const by = formatActor(ctx.actor);
      await ctx.trx
        .updateTable("build_requests")
        .set({ state: to, done_by: by, done_at: new Date() })
        .where("id", "=", id)
        .execute();
      const task = await ctx.trx
        .selectFrom("records")
        .select("code")
        .where("id", "=", String(e?.row.task_id))
        .executeTakeFirstOrThrow();
      // «Build the queue»: a merged task makes room for the next ready one (a no-op with the flag off).
      const projectId = ctx.projectId;
      ctx.afterCommit(async () => void (await advanceBuildQueue(ctx.services, projectId)));
      return {
        entityId: id,
        before: { task: task.code, state: "in_review" },
        after: { task: task.code, state: to, done_by: by },
        result: { id, task: task.code },
      };
    },
  }),

  "build_request.withdraw": handler({
    data: z.object({ reason: z.string().trim().min(1).max(1000).optional() }).strict(),
    async apply(ctx, data, e, to) {
      const id = e?.id as string;
      const by = formatActor(ctx.actor);
      // A build still running is stopped: its builder and workflow are cancelled after the commit, and the
      // journal says why. (The check comes first: the cancelled step ends the attempt.)
      const running = await buildRunning(ctx.trx, id);
      const latest = await ctx.trx
        .selectFrom("build_steps")
        .select((eb) => eb.fn.max("attempt").as("attempt"))
        .where("build_request_id", "=", id)
        .executeTakeFirst();
      if (running && latest?.attempt != null) {
        const attempt = Number(latest.attempt);
        await ctx.trx
          .insertInto("build_steps")
          .values({
            project_id: ctx.projectId,
            build_request_id: id,
            attempt,
            stage: "withdraw",
            outcome: "cancelled",
            detail: JSON.stringify({ reason: "The build request was withdrawn.", withdrawn_by: by }),
          })
          .execute();
        ctx.afterCommit(() => ctx.services.engine.cancelBuild(id, attempt));
      }
      await ctx.trx
        .updateTable("build_requests")
        .set({ state: to, withdrawn_by: by, withdrawn_at: new Date() })
        .where("id", "=", id)
        .execute();
      // An open pull request is closed on GitHub with the reason, and its branch deleted (after the commit).
      if (e?.row.pr_number != null) {
        const reason = data.reason;
        ctx.afterCommit(() => ctx.services.engine.closeBuildPullRequest(id, reason));
      }
      const task = await ctx.trx
        .selectFrom("records")
        .select("code")
        .where("id", "=", String(e?.row.task_id))
        .executeTakeFirstOrThrow();
      return {
        entityId: id,
        before: { task: task.code, state: String(e?.row.state) },
        after: { task: task.code, state: to, withdrawn_by: by },
        result: { id, task: task.code },
      };
    },
  }),
});
