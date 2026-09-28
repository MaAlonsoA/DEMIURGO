// Answering a question from Needs you the way it is answered in its thread (DESIGN.md §3.3, §4.4):
// DEMIURGO's options with one click (one, or several when it says so), or the person's own words,
// and "Answer" sends it. To talk it through first, "Continue in the thread" opens the thread on that
// question. The page, not this block, says what the answer did and moves on.

import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import type { InboxQuestion } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { ChoiceGroup, Field, TextArea } from '../../components/Field.tsx';
import { ArrowRightIcon, PencilIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { useMessages } from '../../i18n/define.ts';
import { MAX_ANSWER, answerChoices, draftOf, withExclusive } from '../thread/answers.ts';
import { ANSWER_HERE } from './words.i18n.ts';

export function AnswerHere({ projectId, question: q }: { projectId: string; question: InboxQuestion }) {
  const t = useMessages(ANSWER_HERE);
  const command = useCommand(projectId);
  const answerable = {
    state: q.state,
    conclusion: q.conclusion ?? null,
    reasoning: q.reasoning ?? null,
    options: q.options ?? [],
    multiple: !!q.multiple,
  };
  const choices = answerChoices(answerable);
  const [picked, setPicked] = useState<string[]>([]);
  // Their own words: null while picking an option. Without options, they can only write.
  const [own, setOwn] = useState<string | null>(choices.length === 0 ? '' : null);
  const answer = own !== null ? own.trim() : draftOf(answerable, picked);
  const send = () => {
    if (!answer) return;
    void command.mutateAsync({ command: 'question.confirm', entityId: q.id, data: { conclusion: answer } }).then(
      () => announce(t.answered),
      () => undefined,
    );
  };

  return (
    <div data-answer-here className="flex flex-col gap-3">
      {q.reason ? (
        <p className="text-sm text-fg-2">
          {t.whyItMatters} {q.reason}
        </p>
      ) : null}
      {own === null ? (
        <ChoiceGroup
          name={`answer-${q.id}`}
          legend={q.multiple ? t.pickAll : t.pickOne}
          multiple={!!q.multiple}
          value={picked}
          columns={choices.length > 1 ? 2 : 1}
          disabled={command.isPending}
          onChange={(next) => setPicked(withExclusive(choices, picked, next))}
          choices={choices.map((c) => ({ value: c.value, label: c.answer, detail: c.implies }))}
        />
      ) : (
        <Field label={t.yourAnswer} count={[own.length, MAX_ANSWER]}>
          {(p) => (
            <TextArea
              {...p}
              autoGrow
              rows={3}
              maxLength={MAX_ANSWER}
              value={own}
              disabled={command.isPending}
              onChange={(e) => setOwn(e.target.value)}
            />
          )}
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={!answer || command.isPending} onClick={send}>
          {command.isPending ? t.answering : t.answer}
        </Button>
        {choices.length > 0 ? (
          <Button
            variant="quiet"
            icon={<PencilIcon size={14} />}
            aria-pressed={own !== null}
            disabled={command.isPending}
            onClick={() => setOwn(own === null ? '' : null)}
          >
            {t.answerOwnWords}
          </Button>
        ) : null}
        <Link
          to="/p/$projectId/threads/$explorationId"
          params={{ projectId, explorationId: q.exploration_id }}
          search={{ question: q.id }}
          className={buttonClass({ variant: 'quiet' })}
        >
          {t.continueInThread}
          <ArrowRightIcon size={14} />
        </Link>
      </div>
      {command.error ? <ErrorNotice error={command.error} compact /> : null}
    </div>
  );
}
