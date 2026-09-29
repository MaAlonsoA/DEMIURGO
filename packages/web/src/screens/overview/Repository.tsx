// The project's repository (core repo/repo.ts): where DEMIURGO writes design/ and the commit each
// accepted or approved change made, newest first, each with its record. Nothing here changes it:
// the repository is the readable copy of what the person decided in DEMIURGO.

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { commitsQuery } from "../../api/queries.ts";
import { Code } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { ErrorNotice } from "../../components/Notice.tsx";
import { Section } from "../../components/Page.tsx";
import { DayTime } from "../../components/Time.tsx";
import { whoName } from "../../components/Who.tsx";
import { useMessages } from "../../i18n/define.ts";
import { whoOf } from "../../words.ts";
import { REPOSITORY } from "./words.i18n.ts";

const SHOWN = 5;

export function RepositorySection({ projectId }: { projectId: string }) {
  const t = useMessages(REPOSITORY);
  const q = useQuery(commitsQuery(projectId));
  const [all, setAll] = useState(false);
  if (q.error)
    return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data?.dir) return null;
  const commits = all ? q.data.commits : q.data.commits.slice(0, SHOWN);
  return (
    <Section id="repository" title={t.repository} note={t.note(q.data.dir)}>
      <ol data-commits className="flex flex-col divide-y divide-edge">
        {commits.map((c) => {
          const who = whoOf(c.actor);
          return (
            <li
              key={c.sha}
              data-commit={c.sha}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2"
            >
              <Code>{c.sha.slice(0, 7)}</Code>
              <span className="min-w-0 flex-1 text-sm text-fg">
                {c.record ? (
                  <Link
                    to="/p/$projectId/records/$code"
                    params={{ projectId, code: c.record.code }}
                    search={{ v: c.record.version }}
                    className="hover:underline"
                  >
                    {c.message}
                  </Link>
                ) : (
                  c.message
                )}
              </span>
              <span className="text-xs text-fg-2">
                {who.kind === "you" ? t.you : whoName(who)} ·{" "}
                <DayTime iso={c.at} /> · {t.files(c.files.length)}
              </span>
            </li>
          );
        })}
      </ol>
      {q.data.commits.length > SHOWN ? (
        <div>
          <Button size="sm" variant="quiet" onClick={() => setAll((a) => !a)}>
            {all ? t.fewer : t.allCommits(q.data.commits.length)}
          </Button>
        </div>
      ) : null}
    </Section>
  );
}
