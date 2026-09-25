// The side column of a record (DESIGN.md §3.6, INV-REC-19…22): its readiness with the server's
// reasons exactly as given — record codes inside them become links to those records — the answers
// DEMIURGO assumed in its thread, its context (where it comes from, what it changes, what it touches
// and what connects to it) and its versions.

import { Link } from '@tanstack/react-router';
import { Fragment, type ReactNode, useId } from 'react';
import type { IncomingLink, Readiness, RecordDetail, RecordVersion } from '../../api/types.ts';
import { Code } from '../../components/Badge.tsx';
import { Timeline } from '../../components/Card.tsx';
import { AlertTriangleIcon, ArrowRightIcon } from '../../components/icons.tsx';
import { Readiness as ReadinessBadge, type Stage } from '../../components/Meter.tsx';
import { Bone } from '../../components/Spinner.tsx';
import { EntityState, StateIcon, StatusBadge } from '../../components/status.tsx';
import { DayTime, RelativeTime } from '../../components/Time.tsx';
import { TypeIcon } from '../../components/types.tsx';
import { WhoAvatar, whoName } from '../../components/Who.tsx';
import { cn } from '../../lib/cn.ts';
import { stateWord, whoOf } from '../../words.ts';
import { IncomingLinks } from './Incoming.tsx';
import { LINK_WORDS, type VersionRef } from './logic.ts';
import { ReviewArea } from './Review.tsx';

const LINK = 'font-medium text-accent-text hover:underline';

/** A panel of the side column: a titled region. */
export function AsidePanel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-base font-semibold text-fg">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-medium text-fg-2">{children}</h3>;
}

const CODE = /\b((?:DEC|FDR|ADR|BUG|REQ|NFR|THR|PRR)-[A-Z]{3}-\d{3})\b/g;

/** A server reason as it came, with the record codes it names turned into links (the text stays). */
export function ReasonText({ projectId, text }: { projectId: string; text: string }) {
  const parts = text.split(CODE);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <Link key={`${p}-${i}`} to="/p/$projectId/records/$code" params={{ projectId, code: p }} className={LINK}>
            {p}
          </Link>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: pieces of one sentence, in order
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
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
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-base font-semibold text-fg">
        {readiness.ready ? 'Ready to build' : 'Before it can be built'}
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span data-stage-track data-stage={stage} className="inline-flex">
          <ReadinessBadge stage={stage} blocking={left} size="md" />
        </span>
        {left > 0 ? (
          <span className="text-sm font-medium text-fg-2 tabular-nums">
            {left} {left === 1 ? 'thing' : 'things'} left
          </span>
        ) : null}
      </div>
      {readiness.ready ? (
        <p className="text-sm text-fg-2">Nothing blocks it. Nothing is built yet.</p>
      ) : stage === 'doubt' ? (
        <p className="text-sm font-medium text-danger-text">It was ready to build, and now something blocks it.</p>
      ) : null}
      {left > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {readiness.reasons.map((r) => (
            <li key={r} className="flex items-start gap-2 text-sm text-fg">
              <StateIcon kind="open" className="mt-0.5" />
              <span data-kind="reason">
                <ReasonText projectId={projectId} text={r} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {readiness.warnings.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Sub>Warnings on how its checks can be verified</Sub>
          <ul className="flex flex-col gap-1.5">
            {readiness.warnings.map((w) => (
              <li key={w} className="flex items-start gap-2 text-sm text-fg">
                <AlertTriangleIcon size={14} className="mt-0.5 shrink-0 text-warning-text" />
                <span data-kind="warning">{w}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {thread && version.inferred_questions.length > 0 ? (
        <ReviewArea part="assumed" className="mt-4 flex flex-col gap-2 border-t border-edge pt-3">
          <Sub>Assumed in its thread</Sub>
          <ul className="flex flex-col gap-3">
            {version.inferred_questions.map((q) => (
              <li key={q.id} data-inferred-question={q.id} className="flex flex-col gap-1 text-sm">
                <StatusBadge kind="assumed" className="self-start" />
                <span className="text-fg">{q.question}</span>
                {q.conclusion ? <span className="text-fg-2">Assumed: {q.conclusion}</span> : null}
                <Link
                  to="/p/$projectId/threads/$explorationId"
                  params={{ projectId, explorationId: thread }}
                  className={cn(LINK, 'inline-flex items-center gap-1 self-start')}
                >
                  Confirm it in the thread <ArrowRightIcon size={12} />
                </Link>
              </li>
            ))}
          </ul>
        </ReviewArea>
      ) : null}
    </section>
  );
}

function byWords(actor: string): string {
  const who = whoOf(actor);
  return who.kind === 'you' ? 'you' : who.kind === 'agent' ? `an agent (${who.name})` : whoName(who);
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
  const origin = [
    ...(version.origin_exploration
      ? [
          {
            key: 'thread',
            icon: <TypeIcon type="thread" size={13} />,
            body: (
              <span className="flex flex-col">
                <span className="text-xs text-fg-2">A thread</span>
                <Link
                  to="/p/$projectId/threads/$explorationId"
                  params={{ projectId, explorationId: version.origin_exploration }}
                  className={LINK}
                >
                  {thread ?? 'Open the thread'}
                </Link>
              </span>
            ),
          },
        ]
      : []),
    ...(version.origin?.type === 'proposal'
      ? [
          {
            key: 'proposal',
            icon: <TypeIcon type="package" size={13} />,
            body: <span className="text-fg-2">A proposal, accepted by {byWords(version.author)}</span>,
          },
        ]
      : []),
    {
      key: 'version',
      icon: <WhoAvatar kind={whoOf(version.author).kind} size={16} />,
      body: (
        <span>
          <span className="font-medium">This version</span>
          <span className="text-fg-2"> · written by {byWords(version.author)}</span>
        </span>
      ),
      meta: <DayTime iso={version.created_at} />,
    },
    ...(version.approved_by
      ? [
          {
            key: 'approved',
            icon: <WhoAvatar kind={whoOf(version.approved_by).kind} size={16} />,
            body: <span className="font-medium">Approved by {byWords(version.approved_by)}</span>,
            meta: <DayTime iso={version.approved_at} />,
          },
        ]
      : []),
  ];
  return (
    <AsidePanel
      title="Context"
      actions={
        <Link to="/p/$projectId/origins" params={{ projectId }} className={cn(LINK, 'text-sm')}>
          Open in Origins
        </Link>
      }
    >
      <div className="flex flex-col gap-2">
        <Sub>Where it comes from</Sub>
        <Timeline items={origin} label="Where it comes from" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Sub>What it changes</Sub>
        <p className="text-sm text-fg">
          {version.change_note ??
            (version.n === 1 ? "It's the first version: it doesn't change an earlier one." : 'This version has no change note.')}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Sub>What it touches</Sub>
        {version.links.length === 0 ? (
          !connected ? (
            <p className="text-sm text-fg-2">It has no links to other records.</p>
          ) : null
        ) : (
          <ul className="flex flex-col gap-2">
            {version.links.map((l) => {
              // The link names its target when the API resolves it; the product index covers older data.
              const target: VersionRef | undefined = l.to_code
                ? { code: l.to_code, n: l.to_n ?? l.to_version ?? 1, title: l.to_title ?? l.to_code, type: '' }
                : targets?.get(l.to_id);
              const replaced = l.to_code != null && l.to_current === false && l.to_state === 'superseded';
              return (
                <li key={l.id} data-link-target={target?.code ?? ''} className="flex flex-col gap-0.5 text-sm">
                  <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span className="text-fg-2">{LINK_WORDS[l.type] ?? l.type}</span>
                    {target ? (
                      <Link
                        to="/p/$projectId/records/$code"
                        params={{ projectId, code: target.code }}
                        search={{ v: target.n }}
                        className={LINK}
                      >
                        {target.title}
                      </Link>
                    ) : targets || l.to_code !== undefined ? (
                      <span className="text-fg-2">a version that is no longer shown</span>
                    ) : (
                      <Bone className="inline-block h-3 w-32 align-middle" />
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Code>
                      {target ? `${target.code} v${target.n}` : `v${l.to_version ?? '?'}`}
                      {replaced ? ' · replaced by a newer version' : ''}
                    </Code>
                    <EntityState entity="link" state={l.state} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <IncomingLinks projectId={projectId} links={incoming} />
      </div>
    </AsidePanel>
  );
}

export function VersionsPanel({ projectId, record, shown }: { projectId: string; record: RecordDetail; shown: RecordVersion }) {
  return (
    <AsidePanel title="Versions">
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
                  'flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-hover',
                  selected && 'bg-selected',
                )}
              >
                <Code className={cn('w-7 font-semibold', selected ? 'text-fg' : 'text-fg-2')}>v{v.n}</Code>
                <StatusBadge kind={w.mark} word={w.word} />
                {v.current ? <span className="text-xs text-fg-2">current</span> : null}
                <span className="ml-auto flex items-center gap-1.5 text-xs text-fg-2">
                  <WhoAvatar kind={whoOf(v.author).kind} size={16} />
                  <RelativeTime iso={v.created_at} />
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </AsidePanel>
  );
}
