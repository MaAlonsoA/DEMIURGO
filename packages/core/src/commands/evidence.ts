// Evidence of an acceptance criterion: the person records how they checked that it holds (a note and,
// optionally, a commit, PR or URL). Append-only: a criterion's evidence is its latest row. It is
// recorded on a criterion of the record's current approved version; an automatic criterion admits it
// too, shown as checked by hand until the runner records its own.

import { formatActor, system } from "@demiurgo/domain";
import { z } from "zod";
import { field, registerGuards } from "../bus/guards.ts";
import { handler, registerHandlers } from "../bus/handlers.ts";
import { automaticCriteriaOf } from "../queries/sizes.ts";

const text = (max: number) => z.string().trim().min(1).max(max);

registerGuards({
  async ac_manual({ ctx, data }) {
    const id = field(data, "criterion_id");
    const c =
      typeof id === "string"
        ? await ctx.trx
            .selectFrom("criteria")
            .innerJoin(
              "record_versions as v",
              "v.id",
              "criteria.record_version_id",
            )
            .select(["criteria.project_id", "v.record_id", "v.n", "v.state"])
            .where("criteria.id", "=", id)
            .executeTakeFirst()
        : undefined;
    if (!c || c.project_id !== ctx.projectId)
      return "The criterion does not exist in this project.";
    const current = await ctx.trx
      .selectFrom("record_versions")
      .select("n")
      .where("record_id", "=", c.record_id)
      .where("state", "=", "approved")
      .orderBy("n", "desc")
      .executeTakeFirst();
    if (c.state !== "approved" || current?.n !== c.n) {
      return "Evidence is recorded on a criterion of the current approved version.";
    }
    return null;
  },
});

registerHandlers({
  "evidence.record_manual": handler({
    data: z
      .object({
        criterion_id: z.string().uuid(),
        note: text(2000),
        reference: text(500).optional(),
        pr_url: text(500).optional(),
        test_name: text(300).optional(),
      })
      .strict(),
    async apply(ctx, data, _e, to) {
      const c = await ctx.trx
        .selectFrom("criteria")
        .select(["code", "record_version_id"])
        .where("id", "=", data.criterion_id)
        .executeTakeFirstOrThrow();
      const { id } = await ctx.trx
        .insertInto("evidence")
        .values({
          project_id: ctx.projectId,
          criterion_id: data.criterion_id,
          record_version_id: c.record_version_id,
          kind: "manual",
          note: data.note,
          reference: data.reference ?? null,
          pr_url: data.pr_url ?? null,
          test_name: data.test_name ?? null,
          state: to,
          recorded_by: formatActor(ctx.actor),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return {
        entityId: id,
        after: {
          criterion: c.code,
          kind: "manual",
          reference: data.reference ?? null,
          pr_url: data.pr_url ?? null,
          test_name: data.test_name ?? null,
        },
      };
    },
  }),

  "evidence.record": handler({
    data: z
      .object({
        criterion_id: z.string().uuid(),
        result: z.enum(["pass", "fail"]),
        test_name: text(500),
        note: text(2000),
        pr_url: z.string().trim().url().max(500).optional(),
        reference: text(500).optional(),
      })
      .strict(),
    async apply(ctx, data, _e, to) {
      const c = await ctx.trx
        .selectFrom("criteria")
        .select(["code", "record_version_id"])
        .where("id", "=", data.criterion_id)
        .executeTakeFirstOrThrow();
      const { id } = await ctx.trx
        .insertInto("evidence")
        .values({
          project_id: ctx.projectId,
          criterion_id: data.criterion_id,
          record_version_id: c.record_version_id,
          kind: "system",
          result: data.result,
          note: data.note,
          reference: data.reference ?? null,
          pr_url: data.pr_url ?? null,
          test_name: data.test_name,
          state: to,
          recorded_by: formatActor(ctx.actor),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return {
        entityId: id,
        after: {
          criterion: c.code,
          kind: "system",
          result: data.result,
          reference: data.reference ?? null,
          pr_url: data.pr_url ?? null,
          test_name: data.test_name,
        },
      };
    },
  }),

  "evidence.ingest_junit": handler({
    data: z
      .object({
        junit: z.string().min(1).max(5_000_000),
        pr_url: z.string().trim().url().max(500).optional(),
        reference: text(500).optional(),
        /** The criteria the task covers: any of them with no passing or failing case in the JUnit is reported `not_run`. */
        expected: z.array(text(40)).max(200).optional(),
        /** Where the report comes from, for the test history. `head_sha` defaults to `reference` (the CI gatherer passes the SHA there). */
        head_sha: text(80).optional(),
        ci_run_id: text(80).optional(),
        build_request_id: z.string().uuid().optional(),
        attempt: z.number().int().min(1).max(1000).optional(),
      })
      .strict(),
    async apply(ctx, data) {
      const cases = parseJunit(data.junit);
      const groups = groupByCriterion(cases);
      // The JUnit of several CI runs on one commit is concatenated: a test that passed in one run and failed in
      // another on the same SHA is flaky.
      const outcomes = new Map<string, Set<string>>();
      for (const t of cases) outcomes.set(t.name, (outcomes.get(t.name) ?? new Set()).add(t.outcome));
      const flaky = [
        ...new Set(
          [...outcomes]
            .filter(([, o]) => o.has("pass") && o.has("fail"))
            .map(([name]) => criterionCodeOf(name) ?? name),
        ),
      ];
      await storeTestRuns(ctx, cases, {
        buildRequestId: data.build_request_id ?? null,
        attempt: data.attempt ?? null,
        headSha: data.head_sha ?? data.reference ?? null,
        ciRunId: data.ci_run_id ?? null,
      });
      const recorded: { code: string; result: "pass" | "fail"; tests: number }[] = [];
      const unknown: string[] = [];
      let ignored = groups.ignored;
      let lastId: string | null = null;
      for (const [code, g] of groups.byCode) {
        if (g.passed + g.failed === 0) {
          ignored += g.skipped;
          continue;
        }
        const criterion = await currentCriterion(ctx, code);
        if (!criterion) {
          unknown.push(code);
          continue;
        }
        const result = g.failed > 0 ? "fail" : "pass";
        const tests = g.passed + g.failed;
        const failing = g.failedNames.slice(0, 5).join("; ");
        const note = `CI: ${g.passed} passed, ${g.failed} failed${failing ? ` (${failing})` : ""}.`.slice(0, 2000);
        const r = await ctx.execute({
          command: "evidence.record",
          actor: system("ci-junit", "1"),
          data: {
            criterion_id: criterion,
            result,
            test_name: (g.failedNames[0] ?? g.names[0] ?? code).slice(0, 500),
            note,
            ...(data.pr_url ? { pr_url: data.pr_url } : {}),
            ...(data.reference ? { reference: data.reference } : {}),
          },
        });
        lastId = r.entityId;
        recorded.push({ code, result, tests });
      }
      // A covered criterion with no JUnit case, or only skipped ones, did not run: no evidence is recorded for it.
      // Only automatic criteria expect a case (the orchestrator already passes just those); a manual or release one
      // is never `not_run`: it is listed in `not_automated` for information.
      const { automatic, notAutomated } = await automaticCriteriaOf(ctx.trx, ctx.projectId, data.expected ?? []);
      const notRun = automatic.filter((code) => {
        const g = groups.byCode.get(code);
        return !g || g.passed + g.failed === 0;
      });
      const result = { recorded, unknown, ignored, not_run: notRun, not_automated: notAutomated, flaky, failures: failuresOf(cases) };
      return { entityId: lastId ?? ctx.projectId, after: result, result };
    },
  }),
});

type TestCase = { name: string; outcome: "pass" | "fail" | "skipped"; file?: string | null; durationMs?: number | null; failure?: string | null };
type Group = { passed: number; failed: number; skipped: number; names: string[]; failedNames: string[] };

const decodeEntities = (t: string): string =>
  t.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_m, e: string) => {
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "amp") return "&";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const n = e[1] === "x" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  });

/** Per failing test and in total, how much failure text is kept (convención nuestra: enough for the cause, not whole logs). */
export const FAILURE_TEXT_MAX = 1500;
export const FAILURES_TOTAL_MAX = 6000;

/** One failing test as the command returns it and the next build attempt reads it. */
export type CiFailure = { code: string | null; test: string; file: string | null; message: string };

/** The message and text of the first <failure> or <error> child, trimmed and capped; null when there is none. */
function failureTextOf(body: string): string | null {
  const m = /<(?:failure|error)\b((?:"[^"]*"|'[^']*'|[^>"'])*?)(?:\/>|>([\s\S]*?)<\/(?:failure|error)\s*>)/.exec(body);
  if (!m) return null;
  const msg = /\bmessage\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m[1] ?? "");
  const message = decodeEntities(msg?.[1] ?? msg?.[2] ?? "").trim();
  const inner = (m[2] ?? "").replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
  const text = decodeEntities(inner.replace(/<[^>]+>/g, "")).trim();
  const joined = message && text && !text.startsWith(message) ? `${message}\n${text}` : text || message;
  return joined ? joined.slice(0, FAILURE_TEXT_MAX) : null;
}

/** The failing cases of a report as a capped list (tests with and without a criterion code), first occurrence per test. */
export function failuresOf(cases: TestCase[]): CiFailure[] {
  const out: CiFailure[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const t of cases) {
    if (t.outcome !== "fail" || seen.has(t.name)) continue;
    seen.add(t.name);
    const message = (t.failure ?? "(no failure message in the report)").slice(0, Math.max(0, FAILURES_TOTAL_MAX - total));
    total += message.length;
    out.push({ code: criterionCodeOf(t.name) ?? null, test: t.name, file: t.file ?? null, message });
  }
  return out;
}

/** A tolerant reader of JUnit XML: every <testcase name=…> with a failure, error or skipped child. */
export function parseJunit(xml: string): TestCase[] {
  const out: TestCase[] = [];
  const re = /<testcase\b((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/>|>([\s\S]*?)<\/testcase\s*>)/g;
  for (const m of xml.matchAll(re)) {
    const name = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m[1] ?? "");
    const raw = name?.[1] ?? name?.[2];
    if (raw === undefined) continue;
    const body = m[3] ?? "";
    const outcome = /<(failure|error)\b/.test(body) ? "fail" : /<skipped\b/.test(body) ? "skipped" : "pass";
    const attr = (key: string) => {
      const a = new RegExp(`\\b${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(m[1] ?? "");
      const v = a?.[1] ?? a?.[2];
      return v === undefined ? null : decodeEntities(v).trim() || null;
    };
    const seconds = Number.parseFloat(attr("time") ?? "");
    out.push({
      name: decodeEntities(raw).trim(),
      outcome,
      file: (attr("file") ?? attr("classname"))?.slice(0, 500) ?? null,
      durationMs: Number.isFinite(seconds) && seconds >= 0 ? Math.min(Math.round(seconds * 1000), 2_000_000_000) : null,
      failure: outcome === "fail" ? failureTextOf(body) : null,
    });
  }
  return out;
}

/** Every case of the report goes to `test_runs`, tied to a criterion or not, in the command's transaction. */
async function storeTestRuns(
  ctx: { trx: import("../bus/types.ts").Tx; projectId: string },
  cases: TestCase[],
  from: { buildRequestId: string | null; attempt: number | null; headSha: string | null; ciRunId: string | null },
): Promise<void> {
  const rows = cases.map((t) => ({
    project_id: ctx.projectId,
    build_request_id: from.buildRequestId,
    attempt: from.attempt,
    head_sha: from.headSha,
    ci_run_id: from.ciRunId,
    test_name: t.name.slice(0, 1000),
    file: t.file ?? null,
    criterion_code: criterionCodeOf(t.name) ?? null,
    outcome: (t.outcome === "skipped" ? "skip" : t.outcome) as "pass" | "fail" | "skip",
    duration_ms: t.durationMs ?? null,
    failure: t.failure ?? null,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await ctx.trx.insertInto("test_runs").values(rows.slice(i, i + 500)).execute();
  }
}

/**
 * The criterion a test case checks: the code its own title starts with. JUnit reporters put the enclosing suites
 * first (Vitest «suite > title», Playwright «suite › title»), so the title is the last segment of the name.
 */
export function criterionCodeOf(name: string): string | undefined {
  const title = name.split(/\s+[>›]\s+/).pop() ?? name;
  return /^AC-[A-Z]{3}-\d{3}-\d{2}/.exec(title)?.[0] ?? /^AC-[A-Z]{3}-\d{3}-\d{2}/.exec(name)?.[0];
}

function groupByCriterion(cases: TestCase[]): { byCode: Map<string, Group>; ignored: number } {
  const byCode = new Map<string, Group>();
  let ignored = 0;
  for (const t of cases) {
    const code = criterionCodeOf(t.name);
    if (!code) {
      ignored++;
      continue;
    }
    const g = byCode.get(code) ?? { passed: 0, failed: 0, skipped: 0, names: [], failedNames: [] };
    g.names.push(t.name);
    if (t.outcome === "fail") {
      g.failed++;
      g.failedNames.push(t.name);
    } else if (t.outcome === "pass") g.passed++;
    else g.skipped++;
    byCode.set(code, g);
  }
  return { byCode, ignored };
}

/** The criterion with this code in the current approved version of its record, in this project. */
async function currentCriterion(ctx: { trx: import("../bus/types.ts").Tx; projectId: string }, code: string): Promise<string | null> {
  const rows = await ctx.trx
    .selectFrom("criteria")
    .innerJoin("record_versions as v", "v.id", "criteria.record_version_id")
    .select(["criteria.id", "v.record_id", "v.n"])
    .where("criteria.project_id", "=", ctx.projectId)
    .where("criteria.code", "=", code)
    .where("v.state", "=", "approved")
    .execute();
  for (const r of rows) {
    const current = await ctx.trx
      .selectFrom("record_versions")
      .select("n")
      .where("record_id", "=", r.record_id)
      .where("state", "=", "approved")
      .orderBy("n", "desc")
      .executeTakeFirst();
    if (current?.n === r.n) return r.id;
  }
  return null;
}
