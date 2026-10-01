// The known-error vault in the web: the «Known errors» section of Observability's Lessons learned tab (counts by status
// and a table) and the page of one entry (what it is, its history and every occurrence). Backend: core
// queries/known-errors.ts (`GET /api/observability/known-errors.json` and `…/known-errors/:code`).

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, usePageTitle } from '../../components/Page.tsx';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { DayTime } from '../../components/Time.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useProjectId, useRouteParams } from '../../lib/hooks.ts';
import { Coded } from '../observability/codes.tsx';
import { SectionHelp } from '../observability/help.tsx';
import { ClassLabel, KnownErrorLink, PhaseLabel, PieceIdLabel, TaskLink } from './labels.tsx';
import { LESSONS } from './lessons.i18n.ts';
import { knownErrorQuery, knownErrorsQuery } from './queries.ts';
import { KNOWN_ERROR_STATUSES, type KnownErrorDetail, type KnownErrorEntry, type KnownErrorsOverview } from './types.ts';

const th = 'px-3 py-2 text-xs font-medium text-fg-2 whitespace-nowrap';
const td = 'px-3 py-2 align-top';
const numTh = `${th} text-right`;
const numTd = `${td} text-right tabular-nums whitespace-nowrap`;

function Table({ caption, head, children }: { caption: string; head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-edge">{head}</tr>
        </thead>
        <tbody className="divide-y divide-edge">{children}</tbody>
      </table>
    </div>
  );
}

/** The vault section: counts by status with a short legend, then one row per entry. */
export function KnownErrorsView({ projectId, data }: { projectId: string; data: KnownErrorsOverview }) {
  const t = useMessages(LESSONS);
  return (
    <section className="flex flex-col gap-3 py-6 first:pt-0" data-lessons-section="lessonsKnown" data-known-errors>
      <div className="flex items-center gap-1">
        <h2 className="text-lg font-semibold text-fg">{t.keTitle}</h2>
        <SectionHelp topic="lessonsKnown" title={t.keTitle} />
      </div>
      <p className="text-sm text-fg-2">{t.keNote}</p>
      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4" aria-label={t.keStatusLabel}>
        {KNOWN_ERROR_STATUSES.map((k) => (
          <div key={k} className="flex flex-col" data-status-count={k}>
            <dt className="text-xs text-fg-2">{t.keStatus(k)}</dt>
            <dd className="text-xl font-semibold tabular-nums text-fg">{data.by_status[k] ?? 0}</dd>
            <dd className="text-xs text-fg-3">{t.keLegend(k)}</dd>
          </div>
        ))}
      </dl>
      {data.entries.length === 0 ? (
        <p className="text-sm text-fg-2">{t.keEmpty}</p>
      ) : (
        <Table
          caption={t.keTitle}
          head={
            <>
              <th className={th}>{t.colCode}</th>
              <th className={th}>{t.colTitle}</th>
              <th className={th}>{t.colClass}</th>
              <th className={th}>{t.colStatus}</th>
              <th className={numTh}>{t.colOccurrences}</th>
              <th className={th}>{t.colLastSeen}</th>
              <th className={numTh}>{t.colAfterFixCount}</th>
              <th className={th}>{t.colTasksList}</th>
            </>
          }
        >
          {data.entries.map((e) => (
            <tr key={e.code} data-known-error-row={e.code} data-status={e.status}>
              <td className={`${td} whitespace-nowrap`}>
                <KnownErrorLink projectId={projectId} code={e.code} />
              </td>
              <td className={td}>{e.title}</td>
              <td className={td}>
                <ClassLabel code={e.error_class} />
              </td>
              <td className={`${td} whitespace-nowrap`}>{t.keStatus(e.status)}</td>
              <td className={numTd}>{e.occurrences}</td>
              <td className={`${td} whitespace-nowrap text-fg-2`}>{e.last_seen ? <DayTime iso={e.last_seen} /> : t.keNever}</td>
              <td className={numTd}>{e.after_fix_recurrences}</td>
              <td className={td}>
                <span className="flex flex-wrap gap-x-2">
                  {e.tasks.map((c) => (
                    <TaskLink key={c} projectId={projectId} code={c} />
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}

export function KnownErrorsSection({ projectId }: { projectId: string }) {
  const t = useMessages(LESSONS);
  const q = useQuery(knownErrorsQuery());
  if (q.isPending) return <RowsSkeleton label={t.keLoading} rows={3} />;
  if (q.error && !q.data) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  return q.data ? <KnownErrorsView projectId={projectId} data={q.data} /> : null;
}

function Part({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 py-5 first:pt-0">
      <h2 className="text-sm font-medium text-fg">{title}</h2>
      {note ? <p className="text-xs text-fg-3">{note}</p> : null}
      {children}
    </section>
  );
}

function FixView({ entry }: { entry: KnownErrorEntry }) {
  const t = useMessages(LESSONS);
  const fix = entry.fix;
  if (!fix) return <p className="text-sm text-fg-2">{t.keNoFix}</p>;
  const versions = Object.entries(fix.piece_versions);
  return (
    <div className="flex max-w-prose flex-col gap-1 text-sm" data-fix>
      <p>
        <span className="text-xs text-fg-2">{t.keFix}: </span>
        {fix.description}
      </p>
      <p className="text-xs text-fg-2">
        {t.keClaimedAt} <DayTime iso={fix.claimed_at} />
      </p>
      {fix.commits.length > 0 ? (
        <p className="text-xs text-fg-2">
          {t.keCommits}: <span className="font-mono">{fix.commits.map((c) => c.slice(0, 9)).join(', ')}</span>
        </p>
      ) : null}
      {versions.length > 0 ? (
        <p className="text-xs text-fg-2">
          {t.kePieceVersions}:{' '}
          {versions.map(([id, v]) => (
            <span key={id} className="mr-3 inline-block">
              <PieceIdLabel id={id} /> <span className="font-mono text-xs text-fg-3">{v}</span>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/** One entry: what it is, its status history (versions with the fix) and every occurrence. */
export function KnownErrorDetailView({ projectId, data }: { projectId: string; data: KnownErrorDetail }) {
  const t = useMessages(LESSONS);
  const e = data.entry;
  return (
    <div className="flex flex-col divide-y divide-edge" data-known-error-page={e.code}>
      <Part title={t.keDescription}>
        <p className="max-w-prose text-sm text-fg">{e.description}</p>
        <dl className="mt-2 grid max-w-prose grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-xs text-fg-2">{t.keClass}</dt>
          <dd>
            <ClassLabel code={e.error_class} />
          </dd>
          <dt className="text-xs text-fg-2">{t.kePhase}</dt>
          <dd>
            <PhaseLabel code={e.phase} />
          </dd>
          <dt className="text-xs text-fg-2">{t.keDimension}</dt>
          <dd>{t.dimension(e.dimension)}</dd>
        </dl>
      </Part>
      <Part title={t.keSignature} note={t.keSignatureNote}>
        <p className="max-w-prose font-mono text-xs text-fg-2" data-signature>
          {e.signature}
        </p>
      </Part>
      <Part title={t.kePieces}>
        {e.pieces.length === 0 ? (
          <p className="text-sm text-fg-2">{t.none}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {e.pieces.map((p) => (
              <li key={p} data-piece={p}>
                <PieceIdLabel id={p} />
              </li>
            ))}
          </ul>
        )}
      </Part>
      <Part title={t.keHistory}>
        <ol className="flex flex-col gap-3">
          {data.versions.map((v) => (
            <li key={v.version} className="flex flex-col gap-1" data-version={v.version} data-status={v.status}>
              <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
                <span className="font-medium text-fg">{t.keStatus(v.status)}</span>
                <span className="text-xs text-fg-2">{t.keVersion(v.version)}</span>
                <span className="text-xs text-fg-3">
                  {t.keRecordedAt} <DayTime iso={v.created_at} />
                </span>
              </p>
              <FixView entry={v} />
            </li>
          ))}
        </ol>
      </Part>
      <Part title={t.keOccurrences}>
        {data.occurrences.length === 0 ? (
          <p className="text-sm text-fg-2">{t.keNoOccurrences}</p>
        ) : (
          <Table
            caption={t.keOccurrences}
            head={
              <>
                <th className={th}>{t.colProject}</th>
                <th className={th}>{t.colTask}</th>
                <th className={th}>{t.colDate}</th>
                <th className={th}>{t.colAfterFix}</th>
                <th className={th}>{t.colWhy}</th>
              </>
            }
          >
            {data.occurrences.map((o) => (
              <tr key={o.id} data-occurrence={o.id} data-after-fix={o.after_fix ? 'yes' : 'no'}>
                <td className={td}>{o.project.name}</td>
                <td className={td}>
                  <TaskLink projectId={o.project.id || projectId} code={o.task.code} />
                </td>
                <td className={`${td} whitespace-nowrap text-fg-2`}>
                  <DayTime iso={o.occurred_at} />
                  {o.current ? null : <span className="block text-xs text-fg-3">{t.keReplaced}</span>}
                </td>
                <td className={`${td} whitespace-nowrap`}>{o.after_fix ? t.yes : t.no}</td>
                <td className={`${td} text-fg-2`}>{o.recurrence_why ?? t.keNever}</td>
              </tr>
            ))}
          </Table>
        )}
      </Part>
    </div>
  );
}

export function KnownErrorScreen() {
  const t = useMessages(LESSONS);
  const projectId = useProjectId();
  const { code } = useRouteParams();
  const q = useQuery(knownErrorQuery(code ?? ''));
  const d = q.data;
  usePageTitle([code, d?.entry.title, t.keTitle]);
  return (
    <>
      <PageHeader
        crumbs={[{ label: t.keBack, link: { to: '/p/$projectId/observability', params: { projectId }, search: { tab: 'lessons' } as never } }, { label: code }]}
        eyebrow={d ? <Coded code={d.entry.code} name={t.keStatus(d.entry.status)} /> : null}
        title={d?.entry.title ?? code ?? t.keTitle}
      />
      <PageBody>
        {q.isPending ? (
          <RowsSkeleton label={t.keLoadingEntry} rows={4} />
        ) : q.error && !d ? (
          <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />
        ) : d ? (
          <KnownErrorDetailView projectId={projectId} data={d} />
        ) : null}
      </PageBody>
    </>
  );
}
