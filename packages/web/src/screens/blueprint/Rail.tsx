// The product blueprint around a record page (canvas B2, left rail): the product's features with
// their status, its decisions and tech decisions with their marks, the rules for the whole product
// (a later increment) and the threads set aside. The record on screen is highlighted. The links
// open the current version of each record. Tab reaches every link; ↑ and ↓ move inside the rail.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type KeyboardEvent, type ReactNode, useId } from 'react';
import { inboxQuery, stateQuery } from '../../api/queries.ts';
import { cn } from '../../lib/cn.ts';
import { ChevronLeft } from '../../ui/icons.tsx';
import { Skeleton } from '../../ui/layout.tsx';
import { Mark } from '../../ui/marks.tsx';
import { NeedsBubble } from '../../ui/signals.tsx';
import { type FeatureStatus, type RailNode, railOf } from './rail.ts';

export function BlueprintFrame({ projectId, code, children }: { projectId: string; code: string; children: ReactNode }) {
  return (
    <div className="flex">
      <BlueprintRail projectId={projectId} code={code} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const ITEM =
  'dm-text-small flex flex-col gap-0.5 rounded-control border border-transparent px-2.5 py-1.5 text-ink hover:bg-line-soft';
const CURRENT = 'border-needs bg-surface hover:bg-surface';
/** A feature: its status on the right (canvas B2), under its title while the rail is narrow. */
const FEATURE = 'min-[1400px]:flex-row min-[1400px]:items-start min-[1400px]:justify-between min-[1400px]:gap-2';

function Status({ status }: { status: FeatureStatus }) {
  switch (status.kind) {
    case 'needs':
      return (
        <span className="dm-text-caption flex items-center gap-1.5 font-semibold text-needs-strong">
          {status.word}
          <NeedsBubble count={status.count} detail={status.detail} />
        </span>
      );
    case 'ready':
      return <span className="dm-text-caption font-semibold text-ink">{status.word}</span>;
    case 'doubt':
      return <span className="dm-text-caption font-semibold text-problem">{status.word}</span>;
    default:
      return <span className="dm-text-caption text-muted">{status.word}</span>;
  }
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <span id={id} className="dm-text-caption px-2.5 font-semibold text-muted">
        {label}
      </span>
      <ul aria-labelledby={id} className="flex flex-col gap-0.5">
        {children}
      </ul>
    </div>
  );
}

function NodeLink({ projectId, node }: { projectId: string; node: RailNode }) {
  return (
    <li>
      <Link
        to="/p/$projectId/records/$code"
        params={{ projectId, code: node.code }}
        data-rail-record={node.code}
        aria-current={node.current ? 'page' : undefined}
        className={cn(ITEM, 'flex-row items-start gap-2', node.current && CURRENT)}
      >
        <span className="mt-[5px] flex shrink-0">
          <Mark kind={node.mark} size={9} />
        </span>
        <span className={cn('line-clamp-2 min-w-0', node.current && 'font-semibold')}>{node.title}</span>
      </Link>
    </li>
  );
}

/** ↑ and ↓ move between the links of the rail (Tab still walks them in order). */
function moveFocus(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const links = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>('a[href]')];
  const at = links.indexOf(document.activeElement as HTMLAnchorElement);
  if (at === -1) return;
  const next = links[e.key === 'ArrowDown' ? Math.min(at + 1, links.length - 1) : Math.max(at - 1, 0)];
  e.preventDefault();
  next?.focus();
}

export function BlueprintRail({ projectId, code }: { projectId: string; code: string }) {
  const state = useQuery(stateQuery(projectId));
  const inbox = useQuery(inboxQuery(projectId)).data;
  const rail = railOf(state.data, inbox, code);
  return (
    <nav
      aria-label="Blueprint"
      onKeyDown={moveFocus}
      className="sticky top-14 flex h-[calc(100vh-56px)] w-[212px] shrink-0 flex-col gap-5 self-start overflow-y-auto border-r border-line px-3 pt-6 pb-10 min-[1400px]:w-[272px]"
    >
      <Link
        to="/p/$projectId"
        params={{ projectId }}
        activeOptions={{ exact: true }}
        className="dm-text-small flex items-center gap-1.5 rounded-control px-2.5 py-1 font-semibold text-ink hover:bg-line-soft"
      >
        <ChevronLeft size={13} className="shrink-0 text-muted" />
        <span className="truncate">{rail.project || 'The product'}</span>
      </Link>
      {!state.data ? (
        <div role="status" aria-label="Loading the product" className="flex flex-col gap-2 px-2.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-36" />
        </div>
      ) : (
        <>
          <Group label="Features">
            {rail.features.length === 0 && <li className="dm-text-caption px-2.5 text-muted">No features yet.</li>}
            {rail.features.map((f) => (
              <li key={f.code}>
                <Link
                  to="/p/$projectId/records/$code"
                  params={{ projectId, code: f.code }}
                  data-rail-record={f.code}
                  data-feature-status={f.status.kind}
                  aria-current={f.current ? 'page' : undefined}
                  className={cn(ITEM, FEATURE, f.current && CURRENT)}
                >
                  <span className={cn('line-clamp-2 min-w-0', f.current && 'font-semibold')}>{f.title}</span>
                  <span className="shrink-0 min-[1400px]:pt-px">
                    <Status status={f.status} />
                  </span>
                </Link>
              </li>
            ))}
          </Group>
          {rail.decisions.length > 0 && (
            <Group label="Decisions">
              {rail.decisions.map((d) => (
                <NodeLink key={d.code} projectId={projectId} node={d} />
              ))}
            </Group>
          )}
          {rail.tech.length > 0 && (
            <Group label="Tech decisions">
              {rail.tech.map((d) => (
                <NodeLink key={d.code} projectId={projectId} node={d} />
              ))}
            </Group>
          )}
          <div className="flex flex-col gap-1">
            <span className="dm-text-caption px-2.5 font-semibold text-muted">Rules for the whole product</span>
            <p
              data-later
              className="dm-text-caption mx-1 rounded-control border border-dashed border-line-strong px-2.5 py-2 text-muted"
            >
              <span className="font-semibold text-ink-3">Later</span> · Rules that every feature follows come in a later
              increment.
            </p>
          </div>
          {rail.parked.length > 0 && (
            <Group label="Parked ideas">
              {rail.parked.map((t) => (
                <li key={t.id}>
                  <Link
                    to="/p/$projectId/threads/$explorationId"
                    params={{ projectId, explorationId: t.id }}
                    className={cn(ITEM, 'flex-row items-start gap-2 text-ink-3')}
                  >
                    <span className="mt-[4px] flex shrink-0">
                      <Mark kind="parked" size={9} />
                    </span>
                    <span className="line-clamp-2 min-w-0">{t.purpose}</span>
                  </Link>
                </li>
              ))}
            </Group>
          )}
        </>
      )}
    </nav>
  );
}
