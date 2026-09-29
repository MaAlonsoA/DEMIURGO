// Day 1, "What I understood from your idea": the product definition stage's questions still open,
// in the definition's order. What DEMIURGO read in the idea comes with the person's own words it
// rests on; what the idea doesn't say waits for an answer (with its likely options) or can be left
// open on purpose. When the person doesn't know what to answer, "Explain it simply" explains the
// question under it. One button confirms it all; the system then drafts the product definition,
// which waits for the person's approval on the Product page.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { runCommand } from '../../api/commands.ts';
import { explorationQuery, keys, stagesQuery } from '../../api/queries.ts';
import type { Question } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { Field, TextArea } from '../../components/Field.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Section } from '../../components/Page.tsx';
import { useMessages } from '../../i18n/define.ts';
import { DEFINITION } from '../overview/words.i18n.ts';
import { ExplainButton, Explanation, useExplain } from '../thread/Explain.tsx';
import { type Answer, blockCalls, initialAnswer, missingAnswers, openItems } from './confirm.ts';
import { CONFIRM } from './words.i18n.ts';
import { Quote } from '../../components/Quote.tsx';

const DEFINITION_STAGE = 'requirements';

/** The block, or null when the project has no open product definition stage. */
export function DefinitionAnswers({ projectId }: { projectId: string }) {
  const t = useMessages(CONFIRM);
  const stage = (useQuery(stagesQuery(projectId)).data ?? []).find((s) => s.key === DEFINITION_STAGE);
  const thread = useQuery({ ...explorationQuery(projectId, stage?.exploration_id ?? ''), enabled: !!stage?.exploration_id });
  if (!stage?.id || !thread.data) return null;
  const items = openItems(thread.data.questions, stage.id);
  if (items.length === 0) {
    const settled = stage.total > 0 && stage.covered === stage.total;
    return settled ? (
      <Section id="definition-answers" title={t.title}>
        <p className="flex flex-wrap items-center gap-3 text-sm text-fg-2">
          {t.allSettled}
          <Link to="/p/$projectId" params={{ projectId }} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            {t.seeDefinition}
          </Link>
        </p>
      </Section>
    ) : null;
  }
  return <Block projectId={projectId} explorationId={items[0]?.exploration_id ?? ''} items={items} />;
}

function Block({ projectId, explorationId, items }: { projectId: string; explorationId: string; items: Question[] }) {
  const t = useMessages(CONFIRM);
  const client = useQueryClient();
  const navigate = useNavigate();
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const answerOf = (q: Question) => answers[q.id] ?? initialAnswer(q);
  const set = (q: Question, a: Partial<Answer>) => setAnswers((all) => ({ ...all, [q.id]: { ...answerOf(q), ...a } }));
  const missing = missingAnswers(items, answers);
  const calls = blockCalls(items, answers);
  const explain = useExplain(projectId, explorationId);

  async function confirm() {
    setError(null);
    setProgress(0);
    try {
      for (const [i, call] of calls.entries()) {
        await runCommand(projectId, call);
        setProgress(i + 1);
      }
      await client.invalidateQueries({ queryKey: keys.project(projectId) });
      announce(t.confirmed);
      await navigate({ to: '/p/$projectId', params: { projectId } });
    } catch (e) {
      setError(e instanceof ApiError ? e : String(e));
      await client.invalidateQueries({ queryKey: keys.project(projectId) });
    } finally {
      setProgress(null);
    }
  }

  return (
    <Section id="definition-answers" title={t.title} note={t.note}>
      <ol className="flex flex-col" data-definition-answers>
        {items.map((q) => (
          <Item
            key={q.id}
            q={q}
            answer={answerOf(q)}
            onChange={(a) => set(q, a)}
            explanation={<Explanation projectId={projectId} explorationId={explorationId} questionId={q.id} />}
            explainButton={<ExplainButton question={q} pending={explain.pending} onExplain={() => explain.ask(q.id)} />}
          />
        ))}
      </ol>
      {explain.error ? <ErrorNotice error={explain.error} /> : null}
      {error ? <ErrorNotice error={error} /> : null}
      <div className="flex flex-wrap items-center gap-3 border-t border-edge pt-4">
        <Button
          variant="primary"
          disabled={missing > 0}
          pending={progress !== null}
          pendingLabel={t.confirming(progress ?? 0, calls.length)}
          onClick={() => void confirm()}
        >
          {t.confirm}
        </Button>
        {missing > 0 ? <span className="text-sm text-fg-2">{t.missing(missing)}</span> : null}
      </div>
    </Section>
  );
}

function Item({
  q,
  answer,
  onChange,
  explanation,
  explainButton,
}: {
  q: Question;
  answer: Answer;
  onChange: (a: Partial<Answer>) => void;
  /** What DEMIURGO explained about the question, when the person asked. */
  explanation: ReactNode;
  explainButton: ReactNode;
}) {
  const t = useMessages(CONFIRM);
  const d = useMessages(DEFINITION);
  const read = q.state === 'inferred';
  const [editing, setEditing] = useState(!read);
  const section = d.section(q.stage_key ?? '');
  const corrected = read && answer.text.trim() !== (q.conclusion ?? '').trim();
  return (
    <li
      data-trace={`question:${q.id}`}
      data-question={q.id}
      data-answer-state={answer.open ? 'open' : read ? (corrected ? 'corrected' : 'read') : 'asked'}
      className="grid gap-x-10 gap-y-2 border-t border-edge py-4 first:border-t-0 md:grid-cols-[minmax(0,1fr)_15rem]"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-base font-semibold text-fg">{section}</h3>
          {answer.open ? (
            <Button size="sm" variant="quiet" onClick={() => onChange({ open: false })}>
              {t.answerAfterAll}
            </Button>
          ) : (
            <span className="flex flex-wrap justify-end gap-1">
              {explainButton}
              {read ? (
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => {
                    if (editing) onChange({ text: q.conclusion ?? '' });
                    setEditing(!editing);
                  }}
                >
                  {editing ? t.keep : t.correct}
                </Button>
              ) : null}
              <Button size="sm" variant="quiet" onClick={() => onChange({ open: true })}>
                {t.leaveOpen}
              </Button>
            </span>
          )}
        </div>
        {answer.open ? (
          <p className="text-sm text-fg-2">{t.leftOpen}</p>
        ) : editing ? (
          <>
            {!read && q.options && q.options.length > 0 ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label={q.question}>
                {q.options.map((o) => (
                  <Button
                    key={o.answer}
                    size="sm"
                    variant="secondary"
                    aria-pressed={answer.text === o.answer}
                    title={o.implies}
                    onClick={() => onChange({ text: o.answer })}
                  >
                    {o.answer}
                  </Button>
                ))}
              </div>
            ) : null}
            <Field label={t.answerLabel(section)} labelHidden>
              {(p) => (
                <TextArea
                  {...p}
                  autoGrow
                  rows={2}
                  maxLength={3000}
                  value={answer.text}
                  onChange={(e) => onChange({ text: e.target.value })}
                />
              )}
            </Field>
          </>
        ) : (
          <p className="max-w-prose text-base text-fg">{answer.text}</p>
        )}
        {explanation}
      </div>
      <aside className="flex flex-col gap-1.5 text-sm text-fg-2">
        <p className="font-medium text-fg-2">{read ? t.readInIdea : t.notInIdea}</p>
        {read
          ? (q.evidence ?? []).map((e) => (
              <p key={`${e.message_id}:${e.quote}`} className="text-fg-3" data-trace={`message:${e.message_id}`}>
                <Quote text={e.quote} />
              </p>
            ))
          : null}
        <p className="text-xs text-fg-3">{q.question}</p>
      </aside>
    </li>
  );
}
