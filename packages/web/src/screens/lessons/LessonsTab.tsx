// Observability tab «Lessons learned»: what the latest post-mortems of all tasks say together (core forensics,
// `GET …/observability/forensics.json`): error classes, root causes by dimension, ranked improvements, pieces, playbooks and tasks.

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ErrorNotice } from '../../components/Notice.tsx';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { DayTime } from '../../components/Time.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useSafeLocale } from '../../words.ts';
import { BarRows } from '../observability/charts.tsx';
import { num } from '../observability/format.ts';
import { SectionHelp } from '../observability/help.tsx';
import type { HelpTopic } from '../observability/help.i18n.ts';
import { KnownErrorsSection } from './KnownErrors.tsx';
import { ClassLabel, PieceIdLabel, TaskLink } from './labels.tsx';
import { LESSONS } from './lessons.i18n.ts';
import { forensicsOverviewQuery } from './queries.ts';
import type { ForensicsOverview } from './types.ts';

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

function Block({ title, topic, note, children }: { title: string; topic: HelpTopic; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 py-6 first:pt-0" data-lessons-section={topic}>
      <div className="flex items-center gap-1">
        <h2 className="text-lg font-semibold text-fg">{title}</h2>
        <SectionHelp topic={topic} title={title} />
      </div>
      {note ? <p className="text-sm text-fg-2">{note}</p> : null}
      {children}
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

function PlaybookDetail({ p }: { p: ForensicsOverview['playbooks'][number] }) {
  const t = useMessages(LESSONS);
  const e = p.entry;
  return (
    <details className="border-t border-edge py-2" data-playbook={p.class_key}>
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 text-sm hover:text-fg">
        <ClassLabel code={p.class_key} />
        <span className="font-medium text-fg">{p.title}</span>
        <span className="text-xs text-fg-2">{t.playbookMeta(p.version, p.based_on.length)}</span>
      </summary>
      <div className="mt-3 flex max-w-prose flex-col gap-3 text-sm text-fg-2">
        <div>
          <h4 className="text-xs font-medium text-fg">{t.whatItIs}</h4>
          <p>{e.what_it_is}</p>
        </div>
        <div>
          <h4 className="text-xs font-medium text-fg">{t.symptoms}</h4>
          <Bullets items={e.symptoms} />
        </div>
        <div>
          <h4 className="text-xs font-medium text-fg">{t.detection}</h4>
          <p>{e.detection}</p>
        </div>
        <div>
          <h4 className="text-xs font-medium text-fg">{t.prevention}</h4>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {e.prevention.map((x) => (
              <li key={`${x.dimension}|${x.change}`}>
                <span className="text-fg">{t.dimension(x.dimension)}</span>: {x.change}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-xs font-medium text-fg">{t.response}</h4>
          <p>{e.response}</p>
        </div>
        {e.examples.length > 0 ? (
          <div>
            <h4 className="text-xs font-medium text-fg">{t.examples}</h4>
            <p className="font-mono text-xs">{e.examples.join(', ')}</p>
          </div>
        ) : null}
        <div>
          <h4 className="text-xs font-medium text-fg">{t.sources}</h4>
          <Bullets items={e.sources} />
        </div>
      </div>
    </details>
  );
}

export function LessonsView({ projectId, data }: { projectId: string; data: ForensicsOverview }) {
  const t = useMessages(LESSONS);
  const locale = useSafeLocale();
  if (data.tasks.length === 0)
    return (
      <div className="flex flex-col divide-y divide-edge">
        <KnownErrorsSection projectId={projectId} />
        <p className="py-6 text-sm text-fg-2">{t.tabEmpty}</p>
      </div>
    );
  const classes = data.by_class.filter((c) => c.occurrences > 0).toSorted((a, b) => b.occurrences - a.occurrences);
  const maxOcc = Math.max(1, ...classes.map((c) => c.occurrences));
  const pieces = data.by_piece.toSorted((a, b) => b.contributed_to_error - a.contributed_to_error || b.could_have_prevented - a.could_have_prevented || a.piece_id.localeCompare(b.piece_id));
  return (
    <div className="flex flex-col divide-y divide-edge">
      <KnownErrorsSection projectId={projectId} />
      <Block title={t.classesTitle} topic="lessonsClasses">
        {classes.length === 0 ? (
          <p className="text-sm text-fg-2">{t.none}</p>
        ) : (
          <>
            <BarRows
              max={maxOcc}
              summary={`${t.classesSummary}: ${classes.map((c) => `${c.class} ${c.occurrences}`).join('; ')}`}
              rows={classes.map((c) => ({ key: c.class, label: <ClassLabel code={c.class} />, name: c.class, value: c.occurrences, display: String(c.occurrences) }))}
            />
            <Table
              caption={t.classesTitle}
              head={
                <>
                  <th className={th}>{t.colClass}</th>
                  <th className={numTh}>{t.colOccurrences}</th>
                  <th className={numTh}>{t.colTasks}</th>
                  <th className={numTh}>{t.colAttempts}</th>
                  <th className={numTh}>{t.colMinutes}</th>
                  <th className={numTh}>{t.colUsd}</th>
                  <th className={numTh}>{t.colPlaybook}</th>
                </>
              }
            >
              {classes.map((c) => (
                <tr key={c.class}>
                  <td className={td}>
                    <ClassLabel code={c.class} />
                  </td>
                  <td className={numTd}>{c.occurrences}</td>
                  <td className={numTd}>{c.tasks}</td>
                  <td className={numTd}>{num(locale, c.attempts, 0)}</td>
                  <td className={numTd}>{num(locale, c.minutes, 0)}</td>
                  <td className={numTd}>{num(locale, c.usd, 2)}</td>
                  <td className={numTd}>{t.playbookVersion(c.playbook_version)}</td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Block>

      <Block title={t.causesTitle} topic="lessonsCauses">
        <Table
          caption={t.causesTitle}
          head={
            <>
              <th className={th}>{t.colDimension}</th>
              <th className={numTh}>{t.colCauses}</th>
              <th className={numTh}>{t.colImprovements}</th>
              <th className={numTh}>{t.colTasks}</th>
            </>
          }
        >
          {data.by_dimension
            .toSorted((a, b) => b.root_causes - a.root_causes)
            .map((d) => (
              <tr key={d.dimension}>
                <td className={td}>{t.dimension(d.dimension)}</td>
                <td className={numTd}>{d.root_causes}</td>
                <td className={numTd}>{d.improvements}</td>
                <td className={numTd}>{d.tasks}</td>
              </tr>
            ))}
        </Table>
      </Block>

      <Block title={t.improvementsTitle} topic="lessonsImprovements" note={t.improvementsNote}>
        <Table
          caption={t.improvementsTitle}
          head={
            <>
              <th className={th}>{t.target}</th>
              <th className={th}>{t.colDimension}</th>
              <th className={th}>{t.colChange}</th>
              <th className={numTh}>{t.colFrequency}</th>
              <th className={th}>{t.colPriority}</th>
              <th className={th}>{t.colTasksList}</th>
            </>
          }
        >
          {data.improvements.map((i) => (
            <tr key={`${i.dimension}|${i.target}|${i.playbook_class}`} data-improvement>
              <td className={`${td} font-mono text-xs`}>{i.target}</td>
              <td className={`${td} whitespace-nowrap`}>{t.dimension(i.dimension)}</td>
              <td className={td}>
                {i.change}
                <span className="block text-xs text-fg-3">
                  {t.source}: {i.source}
                </span>
              </td>
              <td className={numTd}>{i.frequency}</td>
              <td className={`${td} whitespace-nowrap`}>{t.priority(i.priority)}</td>
              <td className={td}>
                <span className="flex flex-wrap gap-x-2">
                  {i.tasks.map((c) => (
                    <TaskLink key={c} projectId={projectId} code={c} />
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </Table>
      </Block>

      <Block title={t.piecesTitle} topic="lessonsPieces" note={t.piecesNote(data.catalog_version, data.catalog_excluded_tasks.length)}>
        <Table
          caption={t.piecesTitle}
          head={
            <>
              <th className={th}>{t.colPiece}</th>
              <th className={numTh}>{t.colContributed}</th>
              <th className={numTh}>{t.colCouldHave}</th>
              <th className={numTh}>{t.colWorked}</th>
              <th className={numTh}>{t.colInvolved}</th>
            </>
          }
        >
          {pieces.map((p) => (
            <tr key={p.piece_id} data-piece={p.piece_id}>
              <td className={td}>
                <PieceIdLabel id={p.piece_id} />
              </td>
              <td className={numTd}>{p.contributed_to_error}</td>
              <td className={numTd}>{p.could_have_prevented}</td>
              <td className={numTd}>{p.worked}</td>
              <td className={numTd}>{p.involved}</td>
            </tr>
          ))}
        </Table>
      </Block>

      <Block title={t.playbooksTitle} topic="lessonsPlaybooks">
        {data.playbooks.length === 0 ? (
          <p className="text-sm text-fg-2">{t.noPlaybooks}</p>
        ) : (
          <div className="flex flex-col">
            {data.playbooks.map((p) => (
              <PlaybookDetail key={p.class_key} p={p} />
            ))}
          </div>
        )}
      </Block>

      <Block title={t.tasksTitle} topic="lessonsTasks">
        <Table
          caption={t.tasksTitle}
          head={
            <>
              <th className={th}>{t.colTask}</th>
              <th className={th}>{t.colOutcome}</th>
              <th className={numTh}>{t.colWentWrong}</th>
              <th className={numTh}>{t.colCauses}</th>
              <th className={numTh}>{t.colImprovements}</th>
              <th className={th}>{t.analyzedAt}</th>
              <th className={th}>{t.colSummary}</th>
            </>
          }
        >
          {data.tasks.map((k) => (
            <tr key={k.code} data-task={k.code}>
              <td className={td}>
                <TaskLink projectId={projectId} code={k.code} />
              </td>
              <td className={`${td} whitespace-nowrap`}>{t.outcome(k.outcome)}</td>
              <td className={numTd}>{k.counts.went_wrong}</td>
              <td className={numTd}>{k.counts.root_causes}</td>
              <td className={numTd}>{k.counts.improvements}</td>
              <td className={`${td} whitespace-nowrap text-fg-2`}>
                <DayTime iso={k.analyzed_at} />
              </td>
              <td className={`${td} text-fg-2`}>{k.summary}</td>
            </tr>
          ))}
        </Table>
      </Block>
    </div>
  );
}

export function LessonsTab({ projectId }: { projectId: string }) {
  const t = useMessages(LESSONS);
  const q = useQuery(forensicsOverviewQuery(projectId));
  if (q.isPending) return <RowsSkeleton label={t.tabLoading} rows={4} />;
  if (q.error && !q.data) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  return q.data ? <LessonsView projectId={projectId} data={q.data} /> : null;
}
