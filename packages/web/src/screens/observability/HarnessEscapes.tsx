// «Escapes from design» (core queries/harness-health.ts, harness/escapes.ts): what design did not see and building or
// the person found later, by rule, each with a link to the record or the build path. Sober tables.

import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { get } from "../../api/client.ts";
import { buttonClass } from "../../components/Button.tsx";
import { ErrorNotice } from "../../components/Notice.tsx";
import { Section } from "../../components/Page.tsx";
import { RowsSkeleton } from "../../components/Spinner.tsx";
import { useMessages } from "../../i18n/define.ts";
import { useSafeLocale } from "../../words.ts";
import { num } from "./format.ts";
import { HARNESS_ESCAPES } from "./words.i18n.ts";

export type EscapeCase = {
  id: string;
  rule: string;
  introduced_phase: string;
  found_phase: string;
  record_code: string | null;
  criterion_code: string | null;
  build_request_id: string | null;
  subject: string | null;
  occurred_at: string | null;
};
export type HarnessEscapesData = {
  rules_version: string | null;
  pending_rules: string[];
  total: number;
  by_rule: { rule: string; n: number }[];
  rows: EscapeCase[];
};

const escapesUrl = (projectId: string) =>
  `/api/projects/${projectId}/observability/harness/escapes`;
export const escapesQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["p", projectId, "observability", "harness", "escapes"] as const,
    queryFn: () => get<HarnessEscapesData>(`${escapesUrl(projectId)}.json`),
  });

const th = "px-3 py-2 text-xs font-medium text-fg-2 whitespace-nowrap";
const td = "px-3 py-2 align-top";

function RuleCases({
  projectId,
  rule,
  rows,
}: {
  projectId: string;
  rule: string;
  rows: EscapeCase[];
}) {
  const t = useMessages(HARNESS_ESCAPES);
  return (
    <div className="overflow-x-auto py-2">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{t.caption(rule)}</caption>
        <thead>
          <tr className="border-b border-edge">
            <th scope="col" className={th}>
              {t.colRecord}
            </th>
            <th scope="col" className={th}>
              {t.colCriterion}
            </th>
            <th scope="col" className={th}>
              {t.colPhases}
            </th>
            <th scope="col" className={th}>
              {t.colSubject}
            </th>
            <th scope="col" className={th}>
              {t.colBuild}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge">
          {rows.map((r) => (
            <tr key={r.id} data-escape={r.id}>
              <td className={td}>
                {r.record_code ? (
                  <Link
                    to="/p/$projectId/records/$code"
                    params={{ projectId, code: r.record_code }}
                    className="font-mono text-xs text-fg hover:underline"
                  >
                    {r.record_code}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td className={`${td} font-mono text-xs text-fg-2`}>
                {r.criterion_code ?? "—"}
              </td>
              <td
                className={`${td} font-mono text-xs text-fg-2`}
              >{`${r.introduced_phase} → ${r.found_phase}`}</td>
              <td className={`${td} break-words text-fg-2`}>
                {r.subject ?? "—"}
              </td>
              <td className={td}>
                {r.build_request_id && r.record_code ? (
                  <Link
                    to="/p/$projectId/build"
                    params={{ projectId }}
                    search={{
                      task: r.record_code,
                      request: r.build_request_id,
                    }}
                    aria-label={t.openBuild(r.record_code)}
                    className="font-mono text-xs text-fg hover:underline"
                  >
                    {r.record_code}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HarnessEscapesView({
  projectId,
  data,
}: {
  projectId: string;
  data: HarnessEscapesData;
}) {
  const t = useMessages(HARNESS_ESCAPES);
  const locale = useSafeLocale();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {data.by_rule.length === 0 ? (
        <p className="text-sm text-fg-2">{t.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">{t.title}</caption>
            <thead>
              <tr className="border-b border-edge">
                <th scope="col" className={th}>
                  {t.colRule}
                </th>
                <th scope="col" className={`${th} text-right`}>
                  {t.colCount}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {data.by_rule.map((r) => {
                const expanded = open === r.rule;
                const rows = data.rows.filter((x) => x.rule === r.rule);
                return (
                  <Fragment key={r.rule}>
                    <tr data-rule={r.rule}>
                      <th scope="row" className={`${td} font-normal`}>
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={
                            expanded
                              ? t.hideRule(r.rule)
                              : t.showRule(r.rule, r.n)
                          }
                          onClick={() => setOpen(expanded ? null : r.rule)}
                          className="text-left text-fg hover:underline"
                        >
                          <span className="font-mono text-xs">{r.rule}</span>{" "}
                          <span>{t.rule(r.rule)}</span>
                        </button>
                      </th>
                      <td className={`${td} text-right tabular-nums`}>
                        {num(locale, r.n, 0)}
                      </td>
                    </tr>
                    {expanded ? (
                      <tr>
                        <td colSpan={2} className="bg-sunken px-3">
                          <RuleCases
                            projectId={projectId}
                            rule={r.rule}
                            rows={rows}
                          />
                          {rows.length < r.n ? (
                            <p className="pb-2 text-xs text-fg-3">
                              {t.cut(rows.length, r.n)}
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data.pending_rules.length > 0 ? (
        <p className="text-xs text-fg-3">
          {t.pending(data.pending_rules.join(", "))}
        </p>
      ) : null}
    </div>
  );
}

export function HarnessEscapesSection({ projectId }: { projectId: string }) {
  const t = useMessages(HARNESS_ESCAPES);
  const q = useQuery(escapesQuery(projectId));
  const base = escapesUrl(projectId);
  return (
    <Section
      title={t.title}
      id="harness-escapes"
      note={q.data ? t.note(q.data.total, q.data.rules_version) : undefined}
      actions={
        <div className="flex gap-2">
          <a href={`${base}.csv`} download className={buttonClass()}>
            {t.downloadCsv}
          </a>
          <a
            href={`${base}.json`}
            download="harness-escapes.json"
            className={buttonClass()}
          >
            {t.downloadJson}
          </a>
        </div>
      }
    >
      {q.isPending ? (
        <RowsSkeleton label={t.loading} rows={3} />
      ) : q.error || !q.data ? (
        <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <HarnessEscapesView projectId={projectId} data={q.data} />
      )}
    </Section>
  );
}
