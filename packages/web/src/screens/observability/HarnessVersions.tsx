// «By harness version» (core queries/harness-health.ts, scorecardsByVersion): the cohorts of builds per harness version
// with their period and how many pieces help, are neutral or hurt. Cohorts are observational (salud-del-harness §9.3).

import { queryOptions, useQuery } from "@tanstack/react-query";
import { get } from "../../api/client.ts";
import { ErrorNotice } from "../../components/Notice.tsx";
import { Section } from "../../components/Page.tsx";
import { RowsSkeleton } from "../../components/Spinner.tsx";
import { useMessages } from "../../i18n/define.ts";
import { useSafeLocale } from "../../words.ts";
import { num } from "./format.ts";
import { HARNESS_VERSIONS } from "./words.i18n.ts";
import { SectionHelp } from './help.tsx';

export type VersionCohort = {
  harness_version_id: string | null;
  demiurgo_sha: string | null;
  first_seen_at: string | null;
  requests: number;
  from: string | null;
  to: string | null;
  scorecards: { piece: string; verdict: "helps" | "neutral" | "hurts" | "no_data" }[];
  overlaps: (string | null)[];
  label: "observational" | "observational, not comparable";
};
export type HarnessVersionsData = { rules_version: string | null; cohorts: VersionCohort[] };

export const versionsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["p", projectId, "observability", "harness", "versions"] as const,
    queryFn: () =>
      get<HarnessVersionsData>(`/api/projects/${projectId}/observability/harness/versions.json`),
  });

const th = "px-3 py-2 text-xs font-medium text-fg-2 whitespace-nowrap";
const td = "px-3 py-2 align-top";

const day = (iso: string | null, locale: string): string =>
  iso === null ? "" : new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });

export function HarnessVersionsView({ data }: { data: HarnessVersionsData }) {
  const t = useMessages(HARNESS_VERSIONS);
  const locale = useSafeLocale();
  if (data.cohorts.length === 0) return <p className="text-sm text-fg-2">{t.empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{t.caption}</caption>
        <thead>
          <tr className="border-b border-edge">
            <th scope="col" className={th}>{t.colVersion}</th>
            <th scope="col" className={`${th} text-right`}>{t.colBuilds}</th>
            <th scope="col" className={th}>{t.colPeriod}</th>
            <th scope="col" className={th}>{t.colPieces}</th>
            <th scope="col" className={th}>{t.colReading}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge">
          {data.cohorts.map((c) => {
            const count = (v: string) => c.scorecards.filter((s) => s.verdict === v).length;
            return (
              <tr key={c.harness_version_id ?? "none"} data-version={c.harness_version_id ?? "none"}>
                <th scope="row" className={`${td} font-normal`}>
                  {c.harness_version_id === null ? (
                    t.untagged
                  ) : (
                    <span className="font-mono text-xs">{(c.demiurgo_sha ?? c.harness_version_id).slice(0, 8)}</span>
                  )}
                </th>
                <td className={`${td} text-right tabular-nums`}>{num(locale, c.requests, 0)}</td>
                <td className={`${td} whitespace-nowrap text-fg-2`}>
                  {day(c.from, locale)}
                  {c.to !== null && c.to !== c.from ? ` – ${day(c.to, locale)}` : ""}
                </td>
                <td className={`${td} tabular-nums`}>
                  {count("helps")} / {count("neutral")} / {count("hurts")}
                </td>
                <td className={`${td} text-fg-2`}>
                  {c.label === "observational" ? t.observational : t.notComparable}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function HarnessVersionsSection({ projectId }: { projectId: string }) {
  const t = useMessages(HARNESS_VERSIONS);
  const q = useQuery(versionsQuery(projectId));
  return (
    <Section title={t.title} id="harness-versions" help={<SectionHelp topic="versions" title={t.title} />} note={t.note}>
      {q.isPending ? (
        <RowsSkeleton label={t.loading} rows={2} />
      ) : q.error || !q.data ? (
        <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <HarnessVersionsView data={q.data} />
      )}
    </Section>
  );
}
