// Needs you (DESIGN.md §3.1, J1): the attention set. Everything that waits for the person, in a
// split view — the queue on the left, the selected thing in full on the right with its decision
// at the bottom (one column under 1280 px, with "Back to Needs you"). A decided thing leaves; the
// next one is selected, takes the focus and is announced (R13, R80). The header reconciles the
// server's count with the rows when packages count each proposal (INVENTORY Part D §1, UX
// problem). With ?catch-up=1 it is Catch up; with nothing left, "You're up to date".

import { useMutationState, useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { explorationsQuery, inboxQuery, projectsQuery, stateQuery, taxonomiesQuery } from '../../api/queries.ts';
import type { CommandCall } from '../../api/commands.ts';
import type { ProductRow } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Count } from '../../components/Badge.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { ArrowLeftIcon } from '../../components/icons.tsx';
import { ErrorNotice, Notice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, usePageTitle } from '../../components/Page.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { useProjectId } from '../../lib/hooks.ts';
import { EditGuard, useEditGuard } from '../batch/guard.tsx';
import { CatchUp, DETAIL_TITLE } from './CatchUp.tsx';
import { NeedDetail, saidWithCount } from './Detail.tsx';
import type { NeedContext } from './frame.tsx';
import { groupsOf, minutesOf, type NeedItem, needsOf } from './order.ts';
import { optionId, Queue } from './Queue.tsx';
import { countSummary, entityOf, saidOf } from './titles.ts';
import { UpToDate } from './UpToDate.tsx';
import { clearWalk } from './walk.ts';

/** True while the viewport is at least this wide (the split view needs 1280 px). */
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const m = window.matchMedia(query);
      m.addEventListener('change', notify);
      return () => m.removeEventListener('change', notify);
    },
    () => (typeof window === 'undefined' || !window.matchMedia ? true : window.matchMedia(query).matches),
    () => true,
  );
}

const focusSoon = (id: string) => setTimeout(() => document.getElementById(id)?.focus(), 60);

/**
 * Follows the commands that succeed in this tab (the mutation cache). When one acted on a thing of
 * Needs you and the thing left, it says so with what is left and puts the focus on the next thing
 * — or on the page title when nothing is left (R13, R80). It does not wait for the callbacks of
 * the component that ran the command: that component is gone once its thing has left.
 */
function useDecisionResults(items: NeedItem[] | null, total: number): void {
  const successes = useMutationState({
    filters: { status: 'success' },
    select: (m) => ({ id: m.mutationId, call: m.state.variables as CommandCall | undefined }),
  });
  const things = useRef(new Map<string, { key: string; kind: NeedItem['kind'] }>());
  for (const i of items ?? []) things.current.set(entityOf(i), { key: i.key, kind: i.kind });
  const seen = useRef<number | null>(null);
  const pending = useRef<{ key: string; said: string; quiet: boolean } | null>(null);
  useEffect(() => {
    const newest = successes.reduce((n, s) => Math.max(n, s.id), 0);
    if (seen.current === null) seen.current = newest;
    for (const s of successes) {
      if (s.id <= seen.current || !s.call?.entityId) continue;
      const thing = things.current.get(s.call.entityId);
      // Questions say their own result while they stay (the shared question actions announce it).
      if (thing)
        pending.current = { key: thing.key, said: saidOf(s.call, thing.kind), quiet: s.call.command.startsWith('question.') };
    }
    seen.current = Math.max(seen.current, newest);
    const p = pending.current;
    if (!p || !items) return;
    if (!items.some((i) => i.key === p.key)) {
      pending.current = null;
      announce(saidWithCount(p.said, total));
      focusSoon(items.length === 0 ? 'page-title' : DETAIL_TITLE);
      return;
    }
    // It stays (a parked question): only what happened is said.
    const t = setTimeout(() => {
      if (pending.current !== p) return;
      pending.current = null;
      if (!p.quiet) announce(p.said);
    }, 1500);
    return () => clearTimeout(t);
  }, [successes, items, total]);
}

export function NeedsYouScreen() {
  const projectId = useProjectId();
  const search = useSearch({ strict: false }) as { 'catch-up'?: number };
  const catchUp = Boolean(search['catch-up']);
  const inbox = useQuery(inboxQuery(projectId));
  const state = useQuery(stateQuery(projectId));
  const threads = useQuery(explorationsQuery(projectId)).data ?? [];
  const taxonomies = useQuery(taxonomiesQuery(projectId)).data ?? [];
  const project = (useQuery(projectsQuery).data ?? []).find((p) => p.id === projectId);
  const rows: ProductRow[] = state.data ? [...state.data.decisions, ...state.data.designs] : [];
  const ctx: NeedContext = { projectId, rows, threads, taxonomies };

  const items = inbox.data && (state.data || state.error) ? needsOf(inbox.data, rows) : null;
  const total = inbox.data?.total ?? 0;
  useDecisionResults(items, total);
  // One title for the tab, set here only (a child's would be overwritten by this one).
  usePageTitle([items?.length === 0 ? "You're up to date" : catchUp ? 'Catching up' : 'Needs you', project?.name]);

  if (inbox.error) {
    return (
      <>
        <PageHeader title="Needs you" />
        <PageBody width="reading">
          <ErrorNotice error={inbox.error} onRetry={() => void inbox.refetch()} />
        </PageBody>
      </>
    );
  }
  if (!items) return <NeedsSkeleton catchUp={catchUp} />;
  if (items.length === 0) return <UpToDate projectId={projectId} />;

  const partial = state.error ? (
    <Notice
      tone="danger"
      role="alert"
      title="Couldn't load the product's records"
      action={
        <Button size="sm" variant="secondary" onClick={() => void state.refetch()}>
          Retry
        </Button>
      }
    >
      What each thing unblocks isn&apos;t shown until they load.
    </Notice>
  ) : null;

  return (
    <EditGuard>
      {catchUp ? (
        <>
          {partial ? <div className="px-4 pt-4 sm:px-6 lg:px-8">{partial}</div> : null}
          <CatchUp ctx={ctx} items={items} />
        </>
      ) : (
        <NeedsList ctx={ctx} items={items} total={total} partial={partial} />
      )}
    </EditGuard>
  );
}

const selectedKey = (projectId: string) => `dm-needs-selected:${projectId}`;

function readSelected(projectId: string): string | undefined {
  try {
    return sessionStorage.getItem(selectedKey(projectId)) ?? undefined;
  } catch {
    return undefined;
  }
}

function NeedsList({
  ctx,
  items,
  total,
  partial,
}: {
  ctx: NeedContext;
  items: NeedItem[];
  total: number;
  partial: React.ReactNode;
}) {
  const wide = useMediaQuery('(min-width: 1280px)');
  const guard = useEditGuard();
  const stable = useStableOrder(items);
  const groups = groupsOf(stable);
  const flat = groups.flatMap((g) => g.items);
  const [chosen, setChosen] = useState<string | undefined>(() => readSelected(ctx.projectId));
  const [open, setOpen] = useState(false);

  // The selected thing left (decided here or elsewhere): the one after it, else the one before.
  const previous = useRef<string[]>([]);
  let current = flat.find((i) => i.key === chosen);
  if (!current) {
    const before = previous.current;
    const at = chosen ? before.indexOf(chosen) : -1;
    const alive = (k: string) => flat.some((i) => i.key === k);
    const next = at >= 0 ? (before.slice(at + 1).find(alive) ?? before.slice(0, at).toReversed().find(alive)) : undefined;
    current = flat.find((i) => i.key === next) ?? flat[0];
  }
  useEffect(() => {
    previous.current = flat.map((i) => i.key);
  });
  const currentKey = current?.key;
  useEffect(() => {
    if (!currentKey) return;
    if (currentKey !== chosen) setChosen(currentKey);
    try {
      sessionStorage.setItem(selectedKey(ctx.projectId), currentKey);
    } catch {
      // A per-visit selection then.
    }
  }, [currentKey, chosen, ctx.projectId]);

  const select = (key: string, focus: boolean) =>
    guard.guard(() => {
      setChosen(key);
      if (focus) focusSoon(optionId(key));
    });
  const enter = (key: string) =>
    guard.guard(() => {
      setChosen(key);
      setOpen(true);
      focusSoon(DETAIL_TITLE);
    });
  const back = () =>
    guard.guard(() => {
      setOpen(false);
      if (currentKey) focusSoon(optionId(currentKey));
    });

  const showQueue = wide || !open;
  const showDetail = wide || open;

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2.5">
            Needs you
            <span aria-hidden>
              <Count n={total} label="" />
            </span>
          </span>
        }
        meta={
          <>
            <span>Everything that waits for you, decided here.</span>
            <span data-count-summary>{countSummary(items, total)}</span>
            <span aria-hidden>·</span>
            <span>about {minutesOf(items)} min in all</span>
          </>
        }
        actions={
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <Link
              to="/p/$projectId/needs-you"
              params={{ projectId: ctx.projectId }}
              search={{ 'catch-up': 1 }}
              onClick={() => clearWalk(ctx.projectId)}
              className={buttonClass({ variant: 'primary' })}
            >
              Catch up
            </Link>
            <span className="text-xs text-fg-2">One at a time, what unblocks the most first.</span>
          </div>
        }
      />
      <PageBody className="flex flex-col gap-4">
        {partial}
        <div className="flex flex-col gap-8 xl:flex-row xl:items-start">
          {showQueue ? (
            <Queue
              groups={groups}
              ctx={ctx}
              selected={currentKey}
              onSelect={select}
              onPick={(key) => (wide ? select(key, false) : enter(key))}
              onEnter={enter}
              className="w-full shrink-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-32px)] xl:w-[380px] xl:overflow-y-auto xl:pr-1"
            />
          ) : null}
          {showDetail && current ? (
            <div className="flex min-w-0 max-w-3xl flex-1 flex-col gap-4">
              {!wide ? (
                <Button variant="quiet" size="sm" icon={<ArrowLeftIcon size={14} />} onClick={back} className="w-fit">
                  Back to Needs you
                </Button>
              ) : null}
              <NeedDetail key={current.key} item={current} ctx={ctx} titleId={DETAIL_TITLE} />
            </div>
          ) : null}
        </div>
      </PageBody>
    </>
  );
}

/**
 * The list never reorders under the pointer or the focus (R79, R60): things keep the place they
 * had when first seen; new ones join the end of their group.
 */
function useStableOrder(items: NeedItem[]): NeedItem[] {
  const seen = useRef(new Map<string, number>());
  for (const i of items) if (!seen.current.has(i.key)) seen.current.set(i.key, seen.current.size);
  return [...items].sort((a, b) => (seen.current.get(a.key) ?? 0) - (seen.current.get(b.key) ?? 0));
}

function NeedsSkeleton({ catchUp }: { catchUp: boolean }) {
  return (
    <>
      <PageHeader title={catchUp ? 'Catching up' : 'Needs you'} />
      <PageBody>
        <Skeleton label={catchUp ? 'Getting ready…' : 'Loading what needs you'} className="flex flex-col gap-8 xl:flex-row">
          <div className="flex flex-col gap-3 xl:w-[380px]">
            <Bone className="h-3 w-32" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3 rounded-md px-3 py-2.5">
                <Bone className="h-6 w-6 rounded-md" />
                <div className="flex flex-1 flex-col gap-2">
                  <Bone className="h-4 w-4/5" />
                  <Bone className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-1 flex-col gap-3">
            <Bone className="h-3 w-40" />
            <Bone className="h-7 w-2/3" />
            <Bone className="h-24 w-full rounded-lg" />
            <Bone className="h-9 w-72" />
          </div>
        </Skeleton>
      </PageBody>
    </>
  );
}
