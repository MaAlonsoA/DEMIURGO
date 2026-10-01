// «Lessons learned» of one task (dev tool): the latest blameless post-mortem (core forensics, `GET …/tasks/:code/forensics`)
// with its older analyses selectable by date. Sober text and one compact table; no boxed cards.

import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Segmented } from '../../components/Tabs.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { Select } from '../../components/Field.tsx';
import { DayTime } from '../../components/Time.tsx';
import { useMessages } from '../../i18n/define.ts';
import { ClassLabel, PhaseLabel, PieceIdLabel } from './labels.tsx';
import { LESSONS } from './lessons.i18n.ts';
import { taskForensicsQuery } from './queries.ts';
import type { ForensicAnalysis, TaskForensic, TaskForensics, Verdict } from './types.ts';

const th = 'px-3 py-2 text-xs font-medium text-fg-2 whitespace-nowrap';
const td = 'px-3 py-2 align-top';

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-fg">{title}</h3>
      {children}
    </section>
  );
}

const VERDICT_ORDER: Verdict[] = ['contributed_to_error', 'could_have_prevented', 'missing', 'worked', 'not_applicable'];
type Filter = 'visible' | Verdict;

function Checklist({ analysis }: { analysis: ForensicAnalysis }) {
  const t = useMessages(LESSONS);
  const [filter, setFilter] = useState<Filter>('visible');
  const rows = analysis.checklist;
  const count = (v: Verdict) => rows.filter((r) => r.verdict === v).length;
  const shown = rows
    .filter((r) => (filter === 'visible' ? r.verdict !== 'not_applicable' : r.verdict === filter))
    .toSorted((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict));
  return (
    <Part title={t.checklist}>
      <Segmented<Filter>
        label={t.filterLabel}
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'visible', label: t.all, count: rows.length - count('not_applicable') },
          ...VERDICT_ORDER.map((v) => ({ value: v as Filter, label: t.verdict(v), count: count(v) })),
        ]}
      />
      <p className="text-sm text-fg-2">{t.checklistNote(shown.length, rows.length)}</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm" data-checklist>
          <caption className="sr-only">{t.checklist}</caption>
          <thead>
            <tr className="border-b border-edge">
              <th className={th}>{t.colPiece}</th>
              <th className={th}>{t.colInvolved}</th>
              <th className={th}>{t.colVerdict}</th>
              <th className={th}>{t.colNote}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {shown.map((r) => (
              <tr key={r.piece_id} data-piece={r.piece_id} data-verdict={r.verdict}>
                <td className={td}>
                  <PieceIdLabel id={r.piece_id} />
                </td>
                <td className={`${td} whitespace-nowrap text-fg-2`}>{t.involved(r.involved)}</td>
                <td className={`${td} whitespace-nowrap`}>{t.verdict(r.verdict)}</td>
                <td className={`${td} text-fg-2`}>
                  {r.note}
                  {r.evidence ? <span className="block text-xs text-fg-3">{r.evidence}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Part>
  );
}

export function AnalysisView({ analysis }: { analysis: ForensicAnalysis }) {
  const t = useMessages(LESSONS);
  const dimensions = [...new Set(analysis.root_causes.map((c) => c.dimension))];
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="max-w-prose text-sm text-fg">{analysis.summary}</p>
        <p className="text-sm text-fg-2">
          {t.outcomeLabel}: <span className="font-medium text-fg">{t.outcome(analysis.outcome)}</span>
        </p>
      </div>
      <Part title={t.wentWell}>
        {analysis.went_well.length === 0 ? (
          <p className="text-sm text-fg-2">{t.none}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {analysis.went_well.map((w) => (
              <li key={w.what}>
                {w.what}
                <span className="block text-xs text-fg-3">{w.evidence}</span>
              </li>
            ))}
          </ul>
        )}
      </Part>
      <Part title={t.wentWrong}>
        {analysis.went_wrong.length === 0 ? (
          <p className="text-sm text-fg-2">{t.none}</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {analysis.went_wrong.map((w) => (
              <li key={w.what} className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-baseline gap-x-3 text-xs text-fg-2">
                  <PhaseLabel code={w.phase} />
                  <ClassLabel code={w.error_class} />
                  {t.cost(w.cost) ? <span className="tabular-nums">{t.cost(w.cost)}</span> : null}
                </span>
                <span>{w.what}</span>
                <span className="text-xs text-fg-3">{w.evidence}</span>
              </li>
            ))}
          </ul>
        )}
      </Part>
      <Part title={t.rootCauses}>
        {analysis.root_causes.length === 0 ? (
          <p className="text-sm text-fg-2">{t.none}</p>
        ) : (
          dimensions.map((d) => (
            <div key={d} className="flex flex-col gap-2" data-dimension={d}>
              <h4 className="text-xs font-medium text-fg-2">{t.dimension(d)}</h4>
              <ul className="flex flex-col gap-3 text-sm">
                {analysis.root_causes
                  .filter((c) => c.dimension === d)
                  .map((c) => (
                    <li key={c.cause} className="flex flex-col gap-0.5">
                      <span>{c.cause}</span>
                      <span className="text-xs text-fg-2">
                        {t.where}: {c.where} · {t.why}: {c.why}
                      </span>
                      <span className="text-xs text-fg-3">{c.evidence}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ))
        )}
      </Part>
      <Part title={t.improvements}>
        {analysis.improvements.length === 0 ? (
          <p className="text-sm text-fg-2">{t.none}</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {analysis.improvements.map((i) => (
              <li key={`${i.target}|${i.change}`} className="flex flex-col gap-0.5">
                <span className="text-xs text-fg-2">
                  {t.priority(i.priority)} · {t.dimension(i.dimension)} · {t.target}: {i.target}
                </span>
                <span>{i.change}</span>
                <span className="text-xs text-fg-2">
                  {t.expectedEffect}: {i.expected_effect}
                </span>
                <span className="text-xs text-fg-3">
                  {t.source}: {i.source}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Part>
      {analysis.lessons.length > 0 ? (
        <Part title={t.lessonsList}>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {analysis.lessons.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Part>
      ) : null}
      <Checklist key={analysis.summary} analysis={analysis} />
    </div>
  );
}

/** The view: the analyses (newest first) with a date selector when there are several. */
export function TaskLessonsView({ data }: { data: TaskForensics }) {
  const t = useMessages(LESSONS);
  const [picked, setPicked] = useState<string | null>(null);
  const list: TaskForensic[] = data.forensics;
  const current = list.find((f) => f.id === picked) ?? list[0];
  if (!current) return <p className="text-sm text-fg-2">{t.empty}</p>;
  return (
    <div className="flex flex-col gap-4" data-forensic={current.id}>
      {list.length > 1 ? (
        <label className="flex max-w-sm flex-col gap-1 text-sm text-fg-2">
          {t.analysisOf}
          <Select value={current.id} onChange={(e) => setPicked(e.target.value)}>
            {list.map((f) => (
              <option key={f.id} value={f.id}>
                {new Date(f.created_at).toLocaleString()}
              </option>
            ))}
          </Select>
        </label>
      ) : (
        <p className="text-sm text-fg-2">
          {t.analyzedAt} <DayTime iso={current.created_at} />
        </p>
      )}
      <AnalysisView analysis={current.analysis} />
    </div>
  );
}

/** The section of the task page: loads the forensics of the task. */
export function TaskLessons({ projectId, code }: { projectId: string; code: string }) {
  const t = useMessages(LESSONS);
  const q = useQuery(taskForensicsQuery(projectId, code));
  return (
    <section className="flex flex-col gap-3 border-t border-edge pt-6" data-task-lessons>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold text-fg">{t.title}</h2>
        <p className="max-w-prose text-sm text-fg-2">{t.note}</p>
      </div>
      {q.isPending ? <RowsSkeleton label={t.loading} rows={3} /> : q.error ? <ErrorNotice error={q.error} onRetry={() => void q.refetch()} /> : q.data ? <TaskLessonsView data={q.data} /> : null}
    </section>
  );
}
