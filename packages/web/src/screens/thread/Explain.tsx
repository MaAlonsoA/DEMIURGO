// "Explain it simply" on a question: for when the person doesn't know what to answer. It sends a
// message on the question, answered by the explainer agent, whose only output is its reply: what
// the question asks in plain words, an example from their product, each answer with its pros, cons
// and what it implies, and which one it would lean towards. In a thread the reply lands in Go
// deeper; on Day 1 it shows under the question. It never answers the question for the person.

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { explorationQuery, runsQuery } from '../../api/queries.ts';
import type { Message, Question, RunListItem } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { BookIcon } from '../../components/icons.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { WorkingDot } from '../../components/status.tsx';
import { useMessages } from '../../i18n/define.ts';
import { readingOf } from '../onboarding/day.ts';
import { sideMessages } from './timeline.ts';
import { EXPLAIN } from './words.i18n.ts';

/** The agent that explains a question (packages/core/agents/explainer). */
export const EXPLAINER = 'explainer';

/** Asking DEMIURGO to explain a question of a thread. */
export function useExplain(projectId: string, explorationId: string) {
  const t = useMessages(EXPLAIN);
  const post = useCommand(projectId);
  return {
    pending: post.isPending,
    error: post.error,
    ask: (questionId: string) =>
      post.mutate(
        {
          command: 'message.post',
          data: { exploration_id: explorationId, question_id: questionId, text: t.request, respond: true, agent: EXPLAINER },
        },
        { onSuccess: () => announce(t.asked) },
      ),
  };
}

/** Where the explanation of a question stands: the latest one, and whether one is being written or failed. */
export function explanationOf(
  messages: readonly Message[],
  runs: readonly RunListItem[],
  questionId: string,
): { reply: Message | null; writing: boolean; failed: RunListItem | null } {
  const side = sideMessages(messages, questionId);
  const explainer = new Set(runs.filter((r) => r.agent === EXPLAINER).map((r) => r.id));
  const reply = side.findLast((m) => m.run_id !== null && explainer.has(m.run_id) && !m.kind) ?? null;
  const asked = side.findLast((m) => m.author.startsWith('human:'));
  const reading = asked ? readingOf(runs, asked) : null;
  const ours = !reading?.run || reading.run.agent === EXPLAINER;
  const writing = ours && (reading?.phase === 'catching_up' || reading?.phase === 'waiting' || reading?.phase === 'working');
  const failed = ours && reading?.run && (reading.phase === 'failed' || reading.phase === 'cancelled') ? reading.run : null;
  return { reply, writing, failed };
}

export function ExplainButton({
  question,
  pending,
  onExplain,
  size = 'sm',
}: {
  question: Question;
  pending: boolean;
  onExplain: () => void;
  size?: 'sm' | 'md';
}) {
  const t = useMessages(EXPLAIN);
  return (
    <Button
      size={size}
      variant="quiet"
      icon={<BookIcon size={14} />}
      aria-label={t.buttonFor(question.question)}
      data-explain-button={question.id}
      disabled={pending}
      onClick={onExplain}
    >
      {t.button}
    </Button>
  );
}

/**
 * The explanation under a question (Day 1): the latest one DEMIURGO wrote, "DEMIURGO is explaining…"
 * while it writes, and Retry when it couldn't. It can be hidden and shown again.
 */
export function Explanation({
  projectId,
  explorationId,
  questionId,
}: {
  projectId: string;
  explorationId: string;
  questionId: string;
}) {
  const t = useMessages(EXPLAIN);
  const thread = useQuery(explorationQuery(projectId, explorationId)).data;
  const runs = useQuery(runsQuery(projectId, { exploration: explorationId })).data ?? [];
  const retry = useCommand(projectId);
  const [hidden, setHidden] = useState(false);
  if (!thread) return null;
  const { reply, writing, failed } = explanationOf(thread.messages, runs, questionId);
  if (!reply && !writing && !failed) return null;
  return (
    <div data-explanation={questionId} className="flex flex-col gap-2 border-l-2 border-accent-edge pl-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-2">
          <BookIcon size={14} />
          {t.title}
        </span>
        {reply && !writing ? (
          <Button size="sm" variant="quiet" aria-expanded={!hidden} onClick={() => setHidden(!hidden)}>
            {hidden ? t.show : t.hide}
          </Button>
        ) : null}
      </div>
      <div role="status" className="text-sm">
        {writing ? (
          <span className="inline-flex items-center gap-2 text-info-text">
            <WorkingDot />
            {t.explaining}
          </span>
        ) : null}
      </div>
      {reply && !writing && !hidden ? <Markdown size="sm">{reply.body}</Markdown> : null}
      {failed && !writing ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-explanation-failed={failed.id}>
          <span className="text-fg-2">{t.couldntExplain}</span>
          <Button
            size="sm"
            variant="secondary"
            pending={retry.isPending}
            pendingLabel={t.retrying}
            onClick={() => retry.mutate({ command: 'run.retry', data: { run_id: failed.id } })}
          >
            {t.retry}
          </Button>
          {retry.error ? <ErrorNotice error={retry.error} compact /> : null}
        </div>
      ) : null}
    </div>
  );
}
