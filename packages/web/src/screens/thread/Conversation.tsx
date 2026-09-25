// The conversation of a thread (DESIGN.md §3.3, §4.5; INV-THR-14…24). A `role="log"`, oldest first
// because it reads as a story: the person's messages, DEMIURGO's replies, the questions it showed
// (answered in place) and its runs. Only additions are announced — a ticking timer never is (R80,
// R92). It follows the end only while the reader is there; when they have scrolled up, new items
// wait behind a "n new · Jump to latest" pill instead of pulling the page (R72, R79).

import { type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { ExplorationDetail, Question, RunListItem } from '../../api/types.ts';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ThreadsIcon } from '../../components/icons.tsx';
import { DemiurgoMessage, PersonMessage } from './Messages.tsx';
import { QuestionCard } from './QuestionCard.tsx';
import { RunCard } from './RunCards.tsx';
import { type TimelineItem, sideMessages } from './timeline.ts';

export type ConversationHandle = {
  /** Shows the end of the conversation and resets the count of new items. */
  scrollToEnd: () => void;
};

/** How close to the end (px) still counts as reading the end. */
const NEAR_END = 160;

const atEnd = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - NEAR_END;

export function Conversation({
  projectId,
  thread,
  items,
  runs,
  canFork,
  stageTitleOf,
  deeperId,
  answeringId,
  onDeeper,
  onOwnWords,
  onUnseen,
  ref,
}: {
  projectId: string;
  thread: ExplorationDetail;
  items: TimelineItem[];
  runs: readonly RunListItem[];
  canFork: boolean;
  stageTitleOf: (q: Question) => string | null;
  deeperId: string | null;
  answeringId: string | null;
  onDeeper: (questionId: string) => void;
  onOwnWords: (questionId: string) => void;
  /** How many items arrived while the reader was away from the end. */
  onUnseen: (n: number) => void;
  ref?: Ref<ConversationHandle>;
}) {
  const active = thread.state === 'active';
  const runOf = new Map(runs.map((r) => [r.id, r]));
  const reading = useRef(true);
  const unseen = useRef(0);
  const last = useRef({ count: items.length, key: items.at(-1)?.key ?? '' });

  const scrollToEnd = () => {
    window.scrollTo({ top: document.documentElement.scrollHeight });
    unseen.current = 0;
    onUnseen(0);
  };
  useImperativeHandle(ref, () => ({ scrollToEnd }));

  // Whether the reader is at the end: then new items keep it in view; otherwise they are counted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onUnseen is the parent's setter
  useEffect(() => {
    const onScroll = () => {
      reading.current = atEnd();
      if (reading.current && unseen.current > 0) {
        unseen.current = 0;
        onUnseen(0);
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: react to what the last item is, not to every render
  useLayoutEffect(() => {
    const key = items.at(-1)?.key ?? '';
    const before = last.current;
    last.current = { count: items.length, key };
    if (key === before.key && items.length <= before.count) return;
    if (reading.current) {
      window.scrollTo({ top: document.documentElement.scrollHeight });
      return;
    }
    unseen.current += Math.max(1, items.length - before.count);
    onUnseen(unseen.current);
  }, [items.length, items.at(-1)?.key]);

  return (
    <section aria-labelledby="conversation-title" className="flex flex-col gap-4">
      <h2 id="conversation-title" className="sr-only">
        Conversation
      </h2>
      {items.length === 0 ? (
        <EmptyState icon={<ThreadsIcon size={24} />} title="Nothing written yet" headingLevel={3}>
          {active ? 'Write below, then Send it or ask DEMIURGO.' : 'Nothing was written in this thread.'}
        </EmptyState>
      ) : null}
      <div role="log" aria-label="Conversation" aria-relevant="additions" className="flex flex-col gap-4">
        {items.map((item) => {
          if (item.type === 'question') {
            const q = item.question;
            return (
              <QuestionCard
                key={item.key}
                projectId={projectId}
                question={q}
                active={active}
                stageTitle={stageTitleOf(q)}
                deeperOpen={deeperId === q.id}
                sideCount={sideMessages(thread.messages, q.id).length}
                answering={answeringId === q.id}
                onDeeper={() => onDeeper(q.id)}
                onOwnWords={() => onOwnWords(q.id)}
              />
            );
          }
          if (item.type === 'run') return <RunCard key={item.key} projectId={projectId} run={item.run} display={item.display} />;
          if (item.type === 'demiurgo') {
            const run = item.runId ? runOf.get(item.runId) : undefined;
            return (
              <DemiurgoMessage
                key={item.key}
                projectId={projectId}
                thread={thread}
                reply={item.reply}
                observations={item.observations}
                model={run?.model ?? null}
                batchId={run?.action === 'exploration_chat' ? run.batch_id : null}
                canFork={canFork && active}
              />
            );
          }
          return <PersonMessage key={item.key} message={item.message} by={item.by} />;
        })}
      </div>
    </section>
  );
}
