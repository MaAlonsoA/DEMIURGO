// Right column of a record (canvas S5A and S5D): "Before it can be built" with the server's
// reasons as they come, the context (where it comes from, what it changes, what it touches) and
// its versions.

import { Link } from '@tanstack/react-router';
import { type ReactNode, useId } from 'react';
import type { Readiness, RecordDetail, RecordVersion } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { dayTime, shortDate } from '../../lib/time.ts';
import { Code } from '../../ui/Card.tsx';
import { Skeleton } from '../../ui/layout.tsx';
import { ChevronRight, TypeIcon } from '../../ui/icons.tsx';
import { useLegendMark } from '../../ui/legend-store.ts';
import { Mark } from '../../ui/marks.tsx';
import { ReadinessReasons } from '../../ui/Reasons.tsx';
import { STAGE_WORDS, type Stage, WhoMark } from '../../ui/signals.tsx';
import { Tip } from '../../ui/Tip.tsx';
import { PRODUCT_WORDS, stateWord, whoOf } from '../../words.ts';
import { LINK_WORDS, type VersionRef } from './logic.ts';

function Panel({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-[15px] font-semibold">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <h3 className="text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">{children}</h3>;
}

/** The three bars with their names: ready · built · verified. Built and verified come with Pillar 2. */
function StageTrack({ stage }: { stage: Stage }) {
  useLegendMark(`bars:${stage}`);
  const w = STAGE_WORDS[stage];
  return (
    <Tip text={`${w.name} · ${w.phrase}`}>
      <div role="img" aria-label={w.name} data-stage-track data-stage={stage} className="grid grid-cols-3 gap-1">
        {(['ready', 'built', 'verified'] as const).map((name, i) => (
          <span key={name} className="flex flex-col gap-1">
            <span
              className={cn(
                'h-2 rounded-[3px]',
                i > 0 && 'border border-dashed border-bar-empty',
                i === 0 && stage === 'ready' && 'bg-ink',
                i === 0 && stage === 'doubt' && 'bg-problem-fill',
                i === 0 && stage === 'not-ready' && 'border border-bar-empty',
              )}
            />
            <span
              className={cn(
                'text-[11px]',
                i === 0 && stage === 'ready' ? 'font-semibold text-ink' : '',
                i === 0 && stage === 'doubt' ? 'font-semibold text-problem' : '',
                (i > 0 || stage === 'not-ready') && 'font-medium text-muted',
              )}
            >
              {name}
            </span>
          </span>
        ))}
      </div>
    </Tip>
  );
}

export function ReadinessPanel({
  projectId,
  version,
  readiness,
  stage,
}: {
  projectId: string;
  version: RecordVersion;
  readiness: Readiness | null;
  stage: Stage;
}) {
  if (!readiness) return null;
  const left = readiness.reasons.length;
  const thread = version.origin_exploration;
  return (
    <Panel
      title={readiness.ready ? PRODUCT_WORDS.readyToBuild : 'Before it can be built'}
      aside={
        <span className={cn('text-xs font-semibold', left ? 'text-needs-hover' : 'text-ink-3')}>
          {left === 0 ? 'Nothing left' : `${left} ${left === 1 ? 'thing' : 'things'} left`}
        </span>
      }
    >
      <StageTrack stage={stage} />
      {readiness.ready ? (
        <p className="text-[13px] text-ink-2">Nothing blocks it. Nothing is built yet.</p>
      ) : stage === 'doubt' ? (
        <p className="text-[13px] text-problem">It was ready to build, and now something blocks it.</p>
      ) : null}
      <ReadinessReasons reasons={readiness.reasons} warnings={readiness.warnings} />
      {thread && version.inferred_questions.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
          <Sub>Assumed in its thread</Sub>
          <ul className="flex flex-col gap-2.5">
            {version.inferred_questions.map((q) => (
              <li key={q.id} data-inferred-question={q.id} className="flex items-start gap-2 text-[13px]">
                <span className="mt-[5px] flex">
                  <Mark kind="assumed" size={9} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-ink">{q.question}</span>
                  {q.conclusion && <span className="text-xs text-ink-3">Assumed: {q.conclusion}</span>}
                  <Link
                    to="/p/$projectId/threads/$explorationId"
                    params={{ projectId, explorationId: thread }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-needs hover:text-needs-hover"
                  >
                    Confirm it in the thread
                    <ChevronRight size={11} />
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function byWords(actor: string): string {
  const who = whoOf(actor);
  return who.kind === 'you' ? 'you' : who.kind === 'agent' ? `an agent (${who.name})` : who.name;
}

export function ContextPanel({
  projectId,
  version,
  thread,
  targets,
}: {
  projectId: string;
  version: RecordVersion;
  /** Purpose of the thread it comes from. */
  thread: string | null;
  /** Records the links point to; undefined while the product state loads. */
  targets: Map<string, VersionRef> | undefined;
}) {
  return (
    <Panel
      title="Context"
      aside={
        <Link
          to="/p/$projectId/origins"
          params={{ projectId }}
          className="text-xs font-semibold text-needs hover:text-needs-hover"
        >
          Open in Origins
        </Link>
      }
    >
      <div className="flex flex-col gap-2">
        <Sub>Where it comes from</Sub>
        <ol className="relative flex flex-col gap-2.5 before:absolute before:top-3 before:bottom-3 before:left-[7px] before:border-l before:border-line-strong">
          {version.origin_exploration && (
            <li className="relative flex gap-2.5">
              <span className="flex w-4 shrink-0 justify-center pt-[2px]">
                <span className="flex rounded-full bg-surface p-[1px] text-muted">
                  <TypeIcon kind="thread" size={13} />
                </span>
              </span>
              <span className="flex min-w-0 flex-col text-[13px]">
                <span className="text-xs text-muted">A thread</span>
                <Link
                  to="/p/$projectId/threads/$explorationId"
                  params={{ projectId, explorationId: version.origin_exploration }}
                  className="font-semibold text-ink hover:text-needs"
                >
                  {thread ?? 'Open the thread'}
                </Link>
              </span>
            </li>
          )}
          {version.origin?.type === 'proposal' && (
            <li className="relative flex gap-2.5">
              <span className="flex w-4 shrink-0 justify-center pt-[2px]">
                <span className="flex rounded-full bg-surface p-[1px] text-muted">
                  <TypeIcon kind="package" size={13} />
                </span>
              </span>
              <span className="text-[13px] text-ink-2">A proposal, accepted by {byWords(version.author)}</span>
            </li>
          )}
          <li className="relative flex gap-2.5">
            <span className="flex w-4 shrink-0 justify-center">
              <WhoMark actor={version.author} size={16} />
            </span>
            <span className="text-[13px]">
              <span className="font-semibold">This version</span>
              <span className="text-muted">
                {' '}
                · written by {byWords(version.author)}, {dayTime(version.created_at)}
              </span>
            </span>
          </li>
          {version.approved_by && (
            <li className="relative flex gap-2.5">
              <span className="flex w-4 shrink-0 justify-center">
                <WhoMark actor={version.approved_by} size={16} />
              </span>
              <span className="text-[13px]">
                <span className="font-semibold">Approved by {byWords(version.approved_by)}</span>
                <span className="text-muted"> · {dayTime(version.approved_at)}</span>
              </span>
            </li>
          )}
        </ol>
      </div>
      <div className="flex flex-col gap-1.5">
        <Sub>What it changes</Sub>
        <p className="text-[13px] leading-relaxed text-ink">
          {version.change_note ??
            (version.n === 1 ? "It's the first version: it doesn't change an earlier one." : 'This version has no change note.')}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Sub>What it touches</Sub>
        {version.links.length === 0 ? (
          <p className="text-[13px] text-ink-3">It has no links to other records.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {version.links.map((l) => {
              const target = targets?.get(l.to_id);
              const w = stateWord('link', l.state);
              return (
                <li key={l.id} data-link-target={target?.code ?? ''} className="flex items-start gap-2 text-[13px]">
                  <span className="mt-[5px] flex">
                    <Mark kind={w.mark} size={9} label={`Link: ${w.word}`} />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span>
                      <span className="text-muted">{LINK_WORDS[l.type] ?? l.type} </span>
                      {target ? (
                        <Link
                          to="/p/$projectId/records/$code"
                          params={{ projectId, code: target.code }}
                          search={{ v: target.n }}
                          className="font-medium text-ink hover:text-needs"
                        >
                          {target.title}
                        </Link>
                      ) : targets ? (
                        <span className="text-ink-3">a version that is no longer shown</span>
                      ) : (
                        <Skeleton className="inline-block h-3 w-40 align-middle" />
                      )}
                    </span>
                    <Code>{target ? `${target.code} v${target.n}` : `v${l.to_version ?? '?'}`}</Code>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}

export function VersionsPanel({ projectId, record, shown }: { projectId: string; record: RecordDetail; shown: RecordVersion }) {
  return (
    <Panel title="Versions">
      <ol className="-mx-2 flex flex-col">
        {record.versions.toReversed().map((v) => {
          const w = stateWord('record_version', v.state);
          const selected = v.n === shown.n;
          return (
            <li key={v.id} data-version={v.n}>
              <Link
                to="/p/$projectId/records/$code"
                params={{ projectId, code: record.code }}
                search={{ v: v.n }}
                aria-current={selected ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-[13px] hover:bg-line-soft',
                  selected && 'bg-line-soft',
                )}
              >
                <Mark kind={w.mark} size={9} label={w.word} />
                <span className="font-mono text-xs font-semibold">v{v.n}</span>
                <span className={cn(selected ? 'font-semibold text-ink' : 'text-ink-2')}>
                  {w.word}
                  {v.current && <span className="font-normal text-muted"> · current</span>}
                </span>
                <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
                  <WhoMark actor={v.author} size={16} />
                  {shortDate(v.created_at)}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
