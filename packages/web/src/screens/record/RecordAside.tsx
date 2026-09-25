// Right column of a record (canvas S5A and S5D): "Before it can be built" as the design system's
// Readiness, with the server's reasons as they come, the context (where it comes from, what it
// changes, what it touches) and its versions.

import { type Stage as DsStage, StageBars as DsStageBars } from '@demiurgo/design-system';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useId } from 'react';
import type { IncomingLink, Readiness, RecordDetail, RecordVersion } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { dayTime, shortDate } from '../../lib/time.ts';
import { Code } from '../../ui/Card.tsx';
import { Skeleton } from '../../ui/layout.tsx';
import { ChevronRight, TypeIcon } from '../../ui/icons.tsx';
import { useLegendMark } from '../../ui/legend-store.ts';
import { Mark } from '../../ui/marks.tsx';
import { ReadinessBox } from '../../ui/Reasons.tsx';
import { STAGE_WORDS, type Stage, WhoMark } from '../../ui/signals.tsx';
import { Tip } from '../../ui/Tip.tsx';
import { PRODUCT_WORDS, stateWord, whoOf } from '../../words.ts';
import { IncomingLinks } from './Incoming.tsx';
import { LINK_WORDS, type VersionRef } from './logic.ts';
import { ReviewArea } from './Review.tsx';

/** A link in running text: blue words in needs-strong. */
const TEXT_LINK = 'dm-text-caption inline-flex items-center gap-1 font-semibold text-needs-strong hover:underline';

function Panel({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="dm-text-heading">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <h3 className="dm-label">{children}</h3>;
}

/** In H1 only the first bar lives: ready shows built and verified as still to come. */
const DS_STAGE: Record<Stage, DsStage> = { 'not-ready': 'not-ready', ready: 'first-only', doubt: 'in-doubt' };

/** The design system's track with its word: ready · built · verified. Built and verified come with Pillar 2. */
function StageTrack({ stage }: { stage: Stage }) {
  useLegendMark(`bars:${stage}`);
  const w = STAGE_WORDS[stage];
  return (
    <Tip text={`${w.name} · ${w.phrase}`}>
      <span data-stage-track data-stage={stage} className="inline-flex min-w-0">
        <DsStageBars stage={DS_STAGE[stage]} label title="" />
      </span>
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
  const id = useId();
  if (!readiness) return null;
  const left = readiness.reasons.length;
  const thread = version.origin_exploration;
  // Ready with nothing to list, the track says it; otherwise the design system's Readiness lists the
  // reasons as they come and the warnings apart, under its own "Before it can be built" (without a
  // second track: the stage is the one above).
  const listed = left > 0 || readiness.warnings.length > 0;
  // The guided review walks its assumed answers as a part of their own; the rest steps back.
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="sr-only">
        {readiness.ready ? PRODUCT_WORDS.readyToBuild : 'Before it can be built'}
      </h2>
      <ReviewArea part="readiness" className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <StageTrack stage={stage} />
          {left > 0 && (
            <span className="dm-text-caption shrink-0 font-semibold text-needs-strong">
              {left} {left === 1 ? 'thing' : 'things'} left
            </span>
          )}
        </div>
        {readiness.ready ? (
          <p className="dm-text-small text-ink-2">Nothing blocks it. Nothing is built yet.</p>
        ) : stage === 'doubt' ? (
          <p className="dm-text-small text-problem">It was ready to build, and now something blocks it.</p>
        ) : null}
        {listed && <ReadinessBox reasons={readiness.reasons} warnings={readiness.warnings} track={false} />}
      </ReviewArea>
      {thread && version.inferred_questions.length > 0 && (
        <ReviewArea part="assumed" className="flex flex-col gap-2 border-t border-line-soft pt-3">
          <Sub>Assumed in its thread</Sub>
          <ul className="flex flex-col gap-2.5">
            {version.inferred_questions.map((q) => (
              <li key={q.id} data-inferred-question={q.id} className="dm-text-small flex items-start gap-2">
                <span className="mt-[5px] flex">
                  <Mark kind="assumed" size={9} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-ink">{q.question}</span>
                  {q.conclusion && <span className="dm-text-caption text-ink-3">Assumed: {q.conclusion}</span>}
                  <Link
                    to="/p/$projectId/threads/$explorationId"
                    params={{ projectId, explorationId: thread }}
                    className={TEXT_LINK}
                  >
                    Confirm it in the thread
                    <ChevronRight size={11} />
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </ReviewArea>
      )}
    </section>
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
  incoming = [],
}: {
  projectId: string;
  version: RecordVersion;
  /** Purpose of the thread it comes from. */
  thread: string | null;
  /** Records the links point to; undefined while the product state loads. */
  targets: Map<string, VersionRef> | undefined;
  /** What connects to the record (the other way). */
  incoming?: readonly IncomingLink[];
}) {
  const connected = incoming.some((l) => l.relation !== null);
  return (
    <Panel
      title="Context"
      aside={
        <Link to="/p/$projectId/origins" params={{ projectId }} className={TEXT_LINK}>
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
              <span className="dm-text-small flex min-w-0 flex-col">
                <span className="dm-text-caption text-muted">A thread</span>
                <Link
                  to="/p/$projectId/threads/$explorationId"
                  params={{ projectId, explorationId: version.origin_exploration }}
                  className="font-semibold text-ink hover:text-needs-strong"
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
              <span className="dm-text-small text-ink-2">A proposal, accepted by {byWords(version.author)}</span>
            </li>
          )}
          <li className="relative flex gap-2.5">
            <span className="flex w-4 shrink-0 justify-center">
              <WhoMark actor={version.author} size={16} />
            </span>
            <span className="dm-text-small">
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
              <span className="dm-text-small">
                <span className="font-semibold">Approved by {byWords(version.approved_by)}</span>
                <span className="text-muted"> · {dayTime(version.approved_at)}</span>
              </span>
            </li>
          )}
        </ol>
      </div>
      <div className="flex flex-col gap-1.5">
        <Sub>What it changes</Sub>
        <p className="dm-text-small leading-relaxed text-ink">
          {version.change_note ??
            (version.n === 1 ? "It's the first version: it doesn't change an earlier one." : 'This version has no change note.')}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Sub>What it touches</Sub>
        {version.links.length === 0 ? (
          !connected && <p className="dm-text-small text-ink-3">It has no links to other records.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {version.links.map((l) => {
              // The link names its target when the API resolves it; the product index covers older data.
              const target: VersionRef | undefined = l.to_code
                ? { code: l.to_code, n: l.to_n ?? l.to_version ?? 1, title: l.to_title ?? l.to_code, type: '' }
                : targets?.get(l.to_id);
              const replaced = l.to_code != null && l.to_current === false && l.to_state === 'superseded';
              const w = stateWord('link', l.state);
              return (
                <li key={l.id} data-link-target={target?.code ?? ''} className="dm-text-small flex items-start gap-2">
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
                          className="font-medium text-ink hover:text-needs-strong"
                        >
                          {target.title}
                        </Link>
                      ) : targets || l.to_code !== undefined ? (
                        <span className="text-ink-3">a version that is no longer shown</span>
                      ) : (
                        <Skeleton className="inline-block h-3 w-40 align-middle" />
                      )}
                    </span>
                    <Code>
                      {target ? `${target.code} v${target.n}` : `v${l.to_version ?? '?'}`}
                      {replaced && ' · replaced by a newer version'}
                    </Code>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <IncomingLinks projectId={projectId} links={incoming} />
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
                  'dm-text-small flex items-center gap-2 rounded-control px-2 py-1.5 hover:bg-line-soft',
                  selected && 'bg-line-soft',
                )}
              >
                <Mark kind={w.mark} size={9} label={w.word} />
                <span className="dm-text-caption font-mono font-semibold">v{v.n}</span>
                <span className={cn(selected ? 'font-semibold text-ink' : 'text-ink-2')}>
                  {w.word}
                  {v.current && <span className="font-normal text-muted"> · current</span>}
                </span>
                <span className="dm-text-caption ml-auto flex items-center gap-1.5 text-muted">
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
