// A thread (DESIGN.md §3.3, J2): three zones. The header says what the thread explores, where it
// comes from, its state and the stage it carries. The conversation — messages, DEMIURGO's questions
// answered in place as drafts, its runs — ends in a sticky composer that always writes to the thread
// (D-013). The side panel lists the questions of the thread and the threads inside it, and Go deeper
// replaces it with a side conversation about one question; it is resizable by keyboard (R85), Esc
// closes it and the focus goes back to the question. Under 1024 px the panel's content opens as a
// sheet. Everything of one thread — drafts, what is being written, the open panel — belongs to that
// thread: moving to another one starts clean (INVENTORY Part C).

import { useQueries, useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useCommand } from '../../api/commands.ts';
import {
  batchQuery,
  explorationQuery,
  explorationsQuery,
  projectsQuery,
  runsQuery,
  stagesQuery,
  stateQuery,
} from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { ExplorationDetail, Question } from '../../api/types.ts';
import { useAllows } from '../../components/actions.tsx';
import { announce } from '../../components/announce.tsx';
import { Count } from '../../components/Badge.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { ArrowLeftIcon, ChevronDownIcon, PanelRightIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, usePageTitle } from '../../components/Page.tsx';
import { ResizablePanel } from '../../components/SidePanel.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useRouteParams, useTables } from '../../lib/hooks.ts';
import { isOpenQuestion, isShown, pickedChoices } from './answers.ts';
import { ThreadAside } from './Aside.tsx';
import { Composer, type ComposerHandle } from './Composer.tsx';
import { Conversation, type ConversationHandle } from './Conversation.tsx';
import { DeeperPanel } from './Deeper.tsx';
import { useExplain } from './Explain.tsx';
import { DraftsProvider, useDraftsState, useSendDrafts } from './drafts.tsx';
import { DraftsBar } from './DraftsBar.tsx';
import { ThreadHeader, short } from './Header.tsx';
import { Sheet, useWide } from './Sheet.tsx';
import { FirstFeature, StageComplete } from './StageComplete.tsx';
import { type ThreadDraft, buildTimeline, draftableDecisions, isActive } from './timeline.ts';
import { THREAD } from './words.i18n.ts';

export function ThreadScreen() {
  const { projectId, explorationId = '' } = useRouteParams();
  // Keyed by thread: text, drafts and panels never leak from one thread into the next.
  return <ThreadView key={explorationId} projectId={projectId} explorationId={explorationId} />;
}

const NO_THREAD: ExplorationDetail = {
  id: '',
  project_id: '',
  parent_id: null,
  purpose: '',
  origin_type: null,
  origin_id: null,
  origin_version: null,
  state: 'active',
  state_reason: null,
  opened_by: '',
  created_at: '',
  messages: [],
  questions: [],
  children: [],
};

/** Back to the question's Go deeper button once the panel closes. */
const focusDeeperButton = (id: string) =>
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-deeper-button="${id}"]`)?.focus());

function ThreadView({ projectId, explorationId }: { projectId: string; explorationId: string }) {
  const words = useMessages(THREAD);
  const thread = useQuery(explorationQuery(projectId, explorationId));
  const runs = useQuery(runsQuery(projectId, { exploration: explorationId }));
  const products = useQuery(stateQuery(projectId)).data;
  const stages = useQuery(stagesQuery(projectId)).data;
  const threads = useQuery(explorationsQuery(projectId)).data;
  const project = useQuery(projectsQuery).data?.find((p) => p.id === projectId);
  const tables = useTables();
  const allows = useAllows('exploration', thread.data?.state);
  const resume = useCommand(projectId);
  const explain = useExplain(projectId, explorationId);
  const drafts = useDraftsState(explorationId);
  const wide = useWide();

  const [deeperId, setDeeperId] = useState<string | null>(null);
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [talks, setTalks] = useState<Record<string, string>>({});
  const [unseen, setUnseen] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const conversation = useRef<ConversationHandle>(null);
  const deeperHeading = useRef<HTMLHeadingElement>(null);

  const t = thread.data;
  usePageTitle([t ? short(t.purpose, 60) : 'Thread', project?.name]);

  // The suggested threads of the conversation's runs: their state tells which fork drafts still count.
  const batchIds = [
    ...new Set((runs.data ?? []).flatMap((r) => (r.action === 'exploration_chat' && r.batch_id ? [r.batch_id] : []))),
  ];
  const batches = useQueries({ queries: batchIds.map((id) => batchQuery(projectId, id)) });
  const forkStates = new Map(
    batches.flatMap((b) =>
      (b.data?.proposals ?? [])
        .filter((p) => p.type === 'exploration')
        .map((p) => {
          const raw = (p.payload as { purpose?: unknown }).purpose;
          return [p.id, { purpose: typeof raw === 'string' ? raw : '', state: p.state }] as const;
        }),
    ),
  );
  const forkSignature = [...forkStates].map(([id, f]) => `${id}:${f.state}`).join(',');
  const questionSignature = (t?.questions ?? []).map((q) => `${q.id}:${q.state}`).join(',');
  const sending = useSendDrafts(projectId, t ?? NO_THREAD, drafts, forkStates);

  // Drafts that can no longer be sent go: the question was settled elsewhere, the suggestion resolved.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the signatures stand for the data they read
  useEffect(() => {
    if (!t) return;
    drafts.prune(
      (id) => {
        const q = t.questions.find((x) => x.id === id);
        return !!q && isOpenQuestion(q);
      },
      (id) => (forkStates.get(id)?.state ?? 'pending') === 'pending',
    );
  }, [questionSignature, forkSignature]);

  const closeDeeper = useCallback(() => {
    setDeeperId((id) => {
      if (id) focusDeeperButton(id);
      return null;
    });
  }, []);

  // Esc closes Go deeper beside the conversation (the sheet closes on its own), unless a dialog or a
  // menu is the top layer.
  useEffect(() => {
    if (!deeperId || !wide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      closeDeeper();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [deeperId, wide, closeDeeper]);

  // Opening Go deeper beside the conversation moves the focus to its question.
  useEffect(() => {
    if (deeperId && wide) deeperHeading.current?.focus();
  }, [deeperId, wide]);

  // Opened on a question (?question=ID, from Needs you): once it is on screen, it takes the focus.
  const { question: focusId } = useSearch({ strict: false }) as { question?: string };
  const focused = useRef<string | null>(null);
  const focusShown = !!focusId && !!t?.questions.some((q) => q.id === focusId && isShown(q));
  useEffect(() => {
    if (!focusId || !focusShown || focused.current === focusId) return;
    focused.current = focusId;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.getElementById(`question-${focusId}`);
        if (!el) return;
        el.dataset.routeTarget = '';
        el.scrollIntoView({ block: 'center' });
        el.focus({ preventScroll: true });
        el.addEventListener('blur', () => delete el.dataset.routeTarget, { once: true });
      }),
    );
  }, [focusId, focusShown]);

  if (thread.error instanceof ApiError && thread.error.status === 404) return <Missing projectId={projectId} />;
  if (!t) {
    if (thread.error)
      return (
        <>
          <PageHeader
            crumbs={[{ label: words.threadsCrumb, link: { to: '/p/$projectId/threads', params: { projectId } } }]}
            title={words.couldntLoad}
          />
          <PageBody width="reading">
            <ErrorNotice error={thread.error} onRetry={() => void thread.refetch()} />
          </PageBody>
        </>
      );
    return <ThreadSkeleton />;
  }

  const active = t.state === 'active';
  const shown = t.questions.filter(isShown);
  const items = buildTimeline(t.messages, runs.data ?? [], shown);
  const decisions = products ? draftableDecisions(products.decisions, t.id) : undefined;
  const stage = stages?.find((x) => x.exploration_id === t.id && x.state === 'open');
  // Passing only opens the next stage of the same moment; the next moment opens by its own step.
  const nextStage = stage
    ? stages?.find((x) => x.position === stage.position + 1 && x.moment === stage.moment)
    : undefined;
  const stageDone = !!stage && stage.total > 0 && stage.covered === stage.total;
  // The onboarding passed in this thread and no feature thread hangs from it yet.
  const onboarding = stages?.filter((x) => x.moment === 'onboarding') ?? [];
  const onboardingDone =
    onboarding.length > 0 && onboarding.every((x) => x.state === 'passed' && x.exploration_id === t.id) && t.children.length === 0;
  const reserve = t.questions.filter((q) => !isShown(q) && isOpenQuestion(q)).length;
  const parent = t.parent_id ? threads?.find((x) => x.id === t.parent_id) : undefined;
  const canFork = !!tables && canCreate(tables, 'exploration.open');
  const openCount = shown.filter(isOpenQuestion).length;
  const stageTitleOf = (q: Question) => (q.stage_id ? (stages?.find((s) => s.id === q.stage_id)?.title ?? null) : null);

  const answeringQuestion = answeringId ? t.questions.find((q) => q.id === answeringId && isOpenQuestion(q)) : undefined;
  const deeperQuestion = deeperId ? t.questions.find((q) => q.id === deeperId) : undefined;

  const onDeeper = (id: string) => {
    if (deeperId === id) closeDeeper();
    else setDeeperId(id);
  };
  const onExplain = (id: string) => {
    setDeeperId(id);
    explain.ask(id);
  };
  const onOwnWords = (id: string) => {
    if (answeringId === id) {
      setAnsweringId(null);
      return;
    }
    setAnsweringId(id);
    const q = t.questions.find((x) => x.id === id);
    const draft = drafts.answers[id];
    // Rewriting an answer already in their own words starts from it.
    const own = !!q && !!draft && pickedChoices(q, draft).length === 0;
    composer.current?.prefill(own ? draft : '');
  };
  const jumpTo = (id: string) => {
    setDetailsOpen(false);
    requestAnimationFrame(() => {
      const el = document.getElementById(`question-${id}`);
      el?.scrollIntoView({ block: 'center' });
      el?.focus({ preventScroll: true });
    });
  };

  const deeper = deeperQuestion ? (
    <DeeperPanel
      key={deeperQuestion.id}
      projectId={projectId}
      thread={t}
      question={deeperQuestion}
      runs={runs.data ?? []}
      talk={talks[deeperQuestion.id] ?? ''}
      onTalk={(text) => setTalks((all) => ({ ...all, [deeperQuestion.id]: text }))}
      onClose={closeDeeper}
      headingRef={deeperHeading}
      compact
    />
  ) : null;
  const aside = <ThreadAside projectId={projectId} thread={t} stageTitleOf={stageTitleOf} onJump={jumpTo} />;

  return (
    <DraftsProvider value={drafts}>
      <div className="flex flex-1 items-stretch">
        <div className="flex min-w-0 flex-1 flex-col">
          <ThreadHeader
            projectId={projectId}
            thread={t}
            parent={parent}
            threads={threads}
            products={products}
            stage={stage}
            extraActions={
              wide ? null : (
                <Button
                  variant="secondary"
                  icon={<PanelRightIcon size={15} />}
                  trailing={<Count n={openCount} label={words.openCount(openCount)} />}
                  onClick={() => setDetailsOpen(true)}
                >
                  {words.questionsAndThreads}
                </Button>
              )
            }
          />

          <div className="flex w-full flex-1 flex-col gap-4 px-4 pt-6 pb-8 sm:px-6 lg:px-8">
            {runs.isPending ? (
              <Skeleton label={words.loadingConversation} className="flex flex-col gap-4">
                <Bone className="h-14 w-3/5 self-end rounded-lg" />
                <Bone className="h-28 w-full rounded-lg" />
              </Skeleton>
            ) : (
              <>
                {runs.isError ? (
                  <ErrorNotice error={runs.error} compact focus={false} onRetry={() => void runs.refetch()} className="text-sm" />
                ) : null}
                <Conversation
                  ref={conversation}
                  projectId={projectId}
                  thread={t}
                  items={items}
                  runs={runs.data ?? []}
                  canFork={canFork}
                  stageTitleOf={stageTitleOf}
                  deeperId={deeperId}
                  answeringId={answeringQuestion?.id ?? null}
                  onDeeper={onDeeper}
                  onOwnWords={onOwnWords}
                  onExplain={onExplain}
                  explaining={explain.pending}
                  onUnseen={setUnseen}
                />
              </>
            )}
            {stage && stageDone && active ? (
              <StageComplete projectId={projectId} stage={stage} next={nextStage?.title ?? null} />
            ) : null}
            {onboardingDone && !stage ? <FirstFeature projectId={projectId} explorationId={t.id} active={active} /> : null}
            {reserve > 0 && active ? (
              <p data-reserve className="rounded-md border border-dashed border-edge-strong px-3 py-2 text-sm text-fg-2">
                {words.reserve(reserve)}
              </p>
            ) : null}
          </div>

          <div className="sticky bottom-0 z-10 border-t border-edge bg-panel">
            {unseen > 0 ? (
              <button
                type="button"
                onClick={() => conversation.current?.scrollToEnd()}
                className="absolute -top-11 left-1/2 inline-flex h-8 -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full bg-inverse px-3.5 text-sm font-medium text-on-inverse shadow-popover"
              >
                <ChevronDownIcon size={14} />
                {words.jumpToLatest(unseen)}
              </button>
            ) : null}
            <div className="flex w-full flex-col gap-2 px-4 py-3 sm:px-6 lg:px-8">
              {active ? <DraftsBar state={sending} onDiscard={drafts.clear} onSent={() => composer.current?.focus()} /> : null}
              {resume.error ? <ErrorNotice error={resume.error} compact /> : null}
              <Composer
                ref={composer}
                projectId={projectId}
                explorationId={t.id}
                active={active}
                inactiveNote={t.state === 'concluded' ? words.concludedNote : words.setAsideNote}
                decisions={decisions}
                threadDraft={(t as { draft?: ThreadDraft | null }).draft ?? null}
                drafting={(runs.data ?? []).some(
                  (r) => isActive(r) && r.action === (t as { draft?: ThreadDraft | null }).draft?.action,
                )}
                answering={answeringQuestion ? { id: answeringQuestion.id, question: answeringQuestion.question } : null}
                onStopAnswering={() => setAnsweringId(null)}
                onAnswer={(id, text) => {
                  drafts.setAnswer(id, text);
                  setAnsweringId(null);
                }}
                onResume={
                  allows('exploration.resume')
                    ? () =>
                        resume
                          .mutateAsync({ command: 'exploration.resume', entityId: t.id })
                          .then(() => announce(words.resumed))
                          .catch(() => undefined)
                    : undefined
                }
                onSent={() => conversation.current?.scrollToEnd()}
              />
            </div>
          </div>
        </div>

        {wide ? (
          <ResizablePanel
            label={deeper ? words.goDeeper : words.inThisThread}
            className="sticky top-0 h-[calc(100vh-16px)] self-start lg:top-2 lg:rounded-r-lg"
          >
            {deeper ?? aside}
          </ResizablePanel>
        ) : null}
      </div>

      {wide ? null : (
        <>
          <Sheet
            open={!!deeper}
            onOpenChange={(o) => {
              if (!o) closeDeeper();
            }}
            label={words.goDeeper}
            wide
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              deeperHeading.current?.focus();
            }}
          >
            {deeper}
          </Sheet>
          <Sheet open={detailsOpen} onOpenChange={setDetailsOpen} label={words.inThisThread}>
            <div className="flex items-center justify-end px-3 pt-3">
              <Button variant="quiet" size="sm" onClick={() => setDetailsOpen(false)}>
                {words.close}
              </Button>
            </div>
            {aside}
          </Sheet>
        </>
      )}
    </DraftsProvider>
  );
}

/** A thread that isn't there, or belongs to another project. */
function Missing({ projectId }: { projectId: string }) {
  const words = useMessages(THREAD);
  usePageTitle([words.notFoundTitle]);
  return (
    <>
      <PageHeader
        crumbs={[{ label: words.threadsCrumb, link: { to: '/p/$projectId/threads', params: { projectId } } }]}
        title={words.notFoundHeading}
      />
      <PageBody width="reading" className="flex flex-col items-start gap-4">
        <p className="text-md text-fg-2">{words.notFoundBody}</p>
        <Link to="/p/$projectId/threads" params={{ projectId }} className={buttonClass({ variant: 'secondary' })}>
          <ArrowLeftIcon size={14} />
          {words.backToThreads}
        </Link>
      </PageBody>
    </>
  );
}

function ThreadSkeleton() {
  const words = useMessages(THREAD);
  return (
    <Skeleton label={words.loadingThread} className="flex flex-col">
      <div className="flex flex-col gap-3 border-b border-edge px-4 pt-5 pb-5 sm:px-6 lg:px-8">
        <Bone className="h-3 w-32" />
        <Bone className="h-3 w-20" />
        <Bone className="h-6 w-2/3" />
        <Bone className="h-3 w-1/2" />
      </div>
      <div className="flex flex-col gap-4 px-4 pt-6 sm:px-6 lg:px-8">
        <Bone className="h-14 w-3/5 self-end rounded-lg" />
        <Bone className="h-28 w-full rounded-lg" />
      </div>
    </Skeleton>
  );
}
