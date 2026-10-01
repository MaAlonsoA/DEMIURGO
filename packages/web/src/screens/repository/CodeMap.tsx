// The code map of the project (core build/project-map.ts): per feature the files its merged tasks changed,
// the hotspots with the features that share them, and who owns each table and route. Code ownership by path
// (CODEOWNERS, OWNERS files) and hotspot analysis by change frequency (Tornhill, "Your Code as a Crime Scene").

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { codeMapQuery } from '../../api/queries.ts';
import type { CodeMapOwner } from '../../api/code-map-types.ts';
import { Code } from '../../components/Badge.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Section } from '../../components/Page.tsx';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { useMessages } from '../../i18n/define.ts';
import { REPOSITORY } from './words.i18n.ts';

function RecordLink({ projectId, code, children }: { projectId: string; code: string; children?: string }) {
  return (
    <Link to="/p/$projectId/records/$code" params={{ projectId, code }} className="font-code text-xs hover:underline">
      {children ?? code}
    </Link>
  );
}

function OwnerList({ projectId, title, rows }: { projectId: string; title: string; rows: CodeMapOwner[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-sm font-semibold text-fg">{title}</h4>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 text-sm">
        {rows.map((r) => (
          <div key={r.name} className="contents">
            <dt className="font-code text-xs text-fg">{r.name}</dt>
            <dd className="text-fg-2">
              <RecordLink projectId={projectId} code={r.feature} /> · <RecordLink projectId={projectId} code={r.task} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function CodeMapSection({ projectId }: { projectId: string }) {
  const t = useMessages(REPOSITORY);
  const q = useQuery(codeMapQuery(projectId));
  const map = q.data;
  return (
    <Section title={t.codeMap} note={t.codeMapNote}>
      <div data-code-map className="flex flex-col gap-6">
        {q.error ? (
          <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />
        ) : !map ? (
          <RowsSkeleton label={t.loadingMap} />
        ) : map.merged_tasks === 0 ? (
          <EmptyState title={t.noMap}>{t.noMapBody}</EmptyState>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <h3 className="text-base font-semibold text-fg">{t.hotspots}</h3>
              <p className="text-sm text-fg-2">{t.hotspotsNote}</p>
              {map.hotspots.length === 0 ? (
                <p className="text-sm text-fg-2">{t.noHotspots}</p>
              ) : (
                <ul data-hotspots className="flex flex-col divide-y divide-edge">
                  {map.hotspots.map((h) => (
                    <li key={h.path} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
                      <span className="min-w-0 flex-1 break-all font-code text-xs text-fg">{h.path}</span>
                      <span className="text-xs text-fg-2">{t.changedBy(h.tasks, h.of)}</span>
                      <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-fg-2">
                        {t.sharedBy}
                        {h.features.map((f) => (
                          <RecordLink key={f} projectId={projectId} code={f} />
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-col gap-3">
              <h3 className="text-base font-semibold text-fg">{t.byFeature}</h3>
              {map.features.map((f) => (
                <div key={f.code} data-feature={f.code} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <RecordLink projectId={projectId} code={f.code} />
                    <span className="text-sm font-medium text-fg">{f.title}</span>
                    <span className="text-xs text-fg-2">{t.tasksOf(f.tasks.length)}</span>
                    <span className="flex flex-wrap gap-x-2">
                      {f.tasks.map((x) => (
                        <RecordLink key={x.code} projectId={projectId} code={x.code} />
                      ))}
                    </span>
                  </div>
                  <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 text-xs">
                    {f.folders.map((d) => (
                      <div key={d.dir} className="contents">
                        <dt className="font-code text-fg">{d.dir}</dt>
                        <dd className="break-words font-code text-fg-2">{d.files.join(', ')}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
            {map.tables.length + map.routes.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-base font-semibold text-fg">{t.owners}</h3>
                <p className="text-sm text-fg-2">{t.ownersNote}</p>
                <OwnerList projectId={projectId} title={t.tables} rows={map.tables} />
                <OwnerList projectId={projectId} title={t.routes} rows={map.routes} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </Section>
  );
}
