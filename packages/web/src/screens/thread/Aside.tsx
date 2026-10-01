// The thread's side panel (DESIGN.md §3.3; INV-FORK-06, 07): "Questions in this thread" — every
// question DEMIURGO showed, with its state in words and, once settled, its answer or reason; a click
// takes the person to it in the conversation — and "Threads inside", with what waits in each one and
// "New thread inside". Go deeper replaces this content while it is open.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { explorationsQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { ExplorationDetail, Question } from '../../api/types.ts';
import { Count } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { PlusIcon, ThreadsIcon } from '../../components/icons.tsx';
import { QuestionOutcome } from '../../components/QuestionActions.tsx';
import { EntityState } from '../../components/status.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useTables } from '../../lib/hooks.ts';
import { OpenThreadDialog } from '../threads/OpenThreadDialog.tsx';
import { demiurgoReplied, isOpenQuestion, visibleQuestions } from './answers.ts';
import { useDrafts } from './drafts.tsx';
import { ASIDE } from './words.i18n.ts';

export function ThreadAside({
  projectId,
  thread: t,
  stageTitleOf,
  onJump,
}: {
  projectId: string;
  thread: ExplorationDetail;
  stageTitleOf: (q: Question) => string | null;
  /** Shows a question in the conversation. */
  onJump: (questionId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-8 px-5 py-5">
      <QuestionsHere thread={t} stageTitleOf={stageTitleOf} onJump={onJump} />
      <ThreadsInside projectId={projectId} thread={t} />
    </div>
  );
}

function QuestionsHere({
  thread: t,
  stageTitleOf,
  onJump,
}: {
  thread: ExplorationDetail;
  stageTitleOf: (q: Question) => string | null;
  onJump: (questionId: string) => void;
}) {
  const words = useMessages(ASIDE);
  const drafts = useDrafts();
  const shown = visibleQuestions(t.questions, demiurgoReplied(t.messages));
  // Open ones first (they wait for the person), each group in the order they were shown.
  const ordered = [...shown].sort(
    (a, b) =>
      Number(isOpenQuestion(b)) - Number(isOpenQuestion(a)) ||
      Date.parse(a.shown_at ?? '9999-01-01') - Date.parse(b.shown_at ?? '9999-01-01'),
  );
  const open = shown.filter(isOpenQuestion).length;
  const reserve = t.questions.filter((q) => isOpenQuestion(q) && !shown.includes(q)).length;
  return (
    <section aria-labelledby="aside-questions" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id="aside-questions" className="text-base font-semibold text-fg">
          {words.questionsTitle}
        </h2>
        <p className="text-sm text-fg-2">{shown.length === 0 ? words.none : words.openSettled(open, shown.length)}</p>
      </div>
      {ordered.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {ordered.map((q) => {
            const stage = stageTitleOf(q);
            return (
              <li
                key={q.id}
                data-question-item={q.id}
                className="flex flex-col gap-1 rounded-md border border-edge-subtle px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <EntityState entity="question" state={q.state} />
                  {stage ? <span className="text-xs text-fg-3">{stage}</span> : null}
                  {drafts?.answers[q.id] && isOpenQuestion(q) ? (
                    <span className="ml-auto text-xs font-medium text-accent-text">{words.notSentYet}</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => onJump(q.id)}
                  className="cursor-pointer text-left text-sm text-fg hover:underline"
                >
                  {q.question}
                  <span className="sr-only">{words.jumpToConversation}</span>
                </button>
                <QuestionOutcome question={q} className="text-xs" />
              </li>
            );
          })}
        </ul>
      ) : null}
      {reserve > 0 && t.state === 'active' ? <p className="text-sm text-fg-2">{words.reserve(reserve)}</p> : null}
    </section>
  );
}

function ThreadsInside({ projectId, thread: t }: { projectId: string; thread: ExplorationDetail }) {
  const words = useMessages(ASIDE);
  const tables = useTables();
  const [opening, setOpening] = useState(false);
  const canOpen = !!tables && canCreate(tables, 'exploration.open');
  // The list knows what waits in each child; the thread itself only knows their names and states.
  const list = useQuery(explorationsQuery(projectId)).data;
  return (
    <section aria-labelledby="aside-children" className="flex flex-col gap-3">
      <h2 id="aside-children" className="text-base font-semibold text-fg">
        {words.threadsInsideTitle}
      </h2>
      {t.children.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {t.children.map((c) => {
            const waiting = list?.find((x) => x.id === c.id)?.open_questions ?? 0;
            return (
              <li key={c.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-hover">
                <ThreadsIcon size={15} className="mt-0.5 shrink-0 text-fg-3" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Link
                    to="/p/$projectId/threads/$explorationId"
                    params={{ projectId, explorationId: c.id }}
                    className="text-sm font-medium text-fg hover:underline"
                  >
                    {c.purpose}
                  </Link>
                  <span className="flex flex-wrap items-center gap-2">
                    <EntityState entity="exploration" state={c.state} />
                    <Count n={waiting} label={words.waiting(waiting)} />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-fg-2">{words.noneInside}</p>
      )}
      {canOpen ? (
        <Button
          size="sm"
          variant="secondary"
          icon={<PlusIcon size={13} />}
          className="self-start"
          onClick={() => setOpening(true)}
        >
          {words.newThreadInside}
        </Button>
      ) : null}
      <OpenThreadDialog
        projectId={projectId}
        open={opening}
        onOpenChange={setOpening}
        parent={{ id: t.id, purpose: t.purpose }}
      />
    </section>
  );
}
