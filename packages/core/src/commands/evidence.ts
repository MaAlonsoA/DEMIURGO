// Evidence of an acceptance criterion: the person records how they checked that it holds (a note and,
// optionally, a commit, PR or URL). Append-only: a criterion's evidence is its latest row. It is
// recorded on a criterion of the record's current approved version; an automatic criterion admits it
// too, shown as checked by hand until the runner records its own.

import { formatActor, system } from "@demiurgo/domain";
import { z } from "zod";
import { field, registerGuards } from "../bus/guards.ts";
import { handler, registerHandlers } from "../bus/handlers.ts";

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
      })
      .strict(),
    async apply(ctx, data) {
      const groups = groupByCriterion(parseJunit(data.junit));
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
      const notRun = (data.expected ?? []).filter((code) => {
        const g = groups.byCode.get(code);
        return !g || g.passed + g.failed === 0;
      });
      const result = { recorded, unknown, ignored, not_run: notRun };
      return { entityId: lastId ?? ctx.projectId, after: result, result };
    },
  }),
});

type TestCase = { name: string; outcome: "pass" | "fail" | "skipped" };
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
    out.push({ name: decodeEntities(raw).trim(), outcome });
  }
  return out;
}

function groupByCriterion(cases: TestCase[]): { byCode: Map<string, Group>; ignored: number } {
  const byCode = new Map<string, Group>();
  let ignored = 0;
  for (const t of cases) {
    const code = /^AC-[A-Z]{3}-\d{3}-\d{2}/.exec(t.name)?.[0];
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
