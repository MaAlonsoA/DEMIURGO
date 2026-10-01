// Day 1, "What I understood from your idea": the product definition stage's questions still open,
// in the definition's order. What DEMIURGO read in the idea comes with the person's own words it
// rests on; what the idea doesn't say waits for an answer (with its likely options) or can be left
// open on purpose. When the person doesn't know what to answer, "Explain it simply" explains the
// question under it, and "Go deeper" opens the side panel over the page to settle it in a side
// conversation. A correction is saved here (kept in this browser) until one button confirms it all;
// the system then drafts the product definition, which waits for the person's approval on the
// Product page.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { runCommand } from '../../api/commands.ts';
import { explorationQuery, keys, runsQuery, stagesQuery } from '../../api/queries.ts';
import type { ExplorationDetail, Question } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { Field, TextArea } from '../../components/Field.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Section } from '../../components/Page.tsx';
import { useMessages } from '../../i18n/define.ts';
import { DEFINITION } from '../overview/words.i18n.ts';
import { DeeperPanel } from '../thread/Deeper.tsx';
import { type Drafts, DraftsProvider } from '../thread/drafts.tsx';
import { ANSWER_WORDS } from '../thread/words.i18n.ts';
import { ExplainButton, Explanation, useExplain } from '../thread/Explain.tsx';
import { Sheet } from '../thread/Sheet.tsx';
import { type Answer, blockCalls, initialAnswer, missingAnswers, openItems } from './confirm.ts';
import { CONFIRM } from './words.i18n.ts';
import { Quote } from '../../components/Quote.tsx';
import { hasLine, listItems, toggleLine } from '../../lib/list-answer.ts';

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
  return <Block projectId={projectId} thread={thread.data} items={items} />;
}

const storageKey = (thread: string) => `dm-day1-answers:${thread}`;

/** The answers saved on Day 1, kept in this browser until they are confirmed. */
function useSavedAnswers(
  threadId: string,
): [Record<string, Answer>, (f: (all: Record<string, Answer>) => Record<string, Answer>) => void] {
  const [answers, setAnswers] = useState<Record<string, Answer>>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(storageKey(threadId)) ?? '{}') as Record<string, Answer>;
    } catch {
      return {};
    }
  });
  const change = (f: (all: Record<string, Answer>) => Record<string, Answer>) =>
    setAnswers((all) => {
      const next = f(all);
      try {
        window.localStorage.setItem(storageKey(threadId), JSON.stringify(next));
      } catch {
        // Keeping them across reloads is a convenience: without storage they last for this visit.
      }
      return next;
    });
  return [answers, change];
}

function Block({ projectId, thread, items }: { projectId: string; thread: ExplorationDetail; items: Question[] }) {
  const t = useMessages(CONFIRM);
  const client = useQueryClient();
  const navigate = useNavigate();
  const explorationId = thread.id;
  const [answers, setAnswers] = useSavedAnswers(explorationId);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [deeperId, setDeeperId] = useState<string | null>(null);
  const [talks, setTalks] = useState<Record<string, string>>({});
  const deeperHeading = useRef<HTMLHeadingElement>(null);
  const runs = useQuery({ ...runsQuery(projectId, { exploration: explorationId }), enabled: !!deeperId });
  const answerOf = (q: Question) => answers[q.id] ?? initialAnswer(q);
  const set = (q: Question, a: Partial<Answer>) =>
    setAnswers((all) => ({ ...all, [q.id]: { ...(all[q.id] ?? initialAnswer(q)), ...a } }));
  const missing = missingAnswers(items, answers);
  const calls = blockCalls(items, answers);
  const [total, setTotal] = useState<number | null>(null);
  const explain = useExplain(projectId, explorationId);
  const deeper = items.find((q) => q.id === deeperId) ?? null;

  // Go deeper settles a question into this block: "Use as answer" becomes the saved answer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: set only reads the items and answers passed in
  const drafts = useMemo<Drafts>(
    () => ({
      answers: Object.fromEntries(
        items.flatMap((q) => {
          const a = answers[q.id];
          return a && !a.open && a.text.trim() && a.text.trim() !== initialAnswer(q).text.trim() ? [[q.id, a.text]] : [];
        }),
      ),
      forks: {},
      setAnswer: (id, text) => {
        const q = items.find((x) => x.id === id);
        if (q) set(q, { text: text ?? initialAnswer(q).text, open: false });
      },
      setFork: () => {},
      clear: () => {},
      prune: () => {},
    }),
    [items, answers],
  );

  async function confirm() {
    setError(null);
    setProgress(0);
    // The questions leave the list as they are confirmed: the count is fixed when confirming starts.
    setTotal(calls.length);
    try {
      for (const [i, call] of calls.entries()) {
        await runCommand(projectId, call);
        setProgress(i + 1);
      }
      setAnswers(() => ({}));
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
            onTalk={() => setDeeperId(q.id)}
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
          pendingLabel={t.confirming(progress ?? 0, total ?? calls.length)}
          onClick={() => void confirm()}
        >
          {t.confirm}
        </Button>
        {missing > 0 ? <span className="text-sm text-fg-2">{t.missing(missing)}</span> : null}
      </div>
      <DraftsProvider value={drafts}>
        <Sheet
          open={!!deeper}
          onOpenChange={(o) => {
            if (!o) setDeeperId(null);
          }}
          label={t.talkLabel}
          wide
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            deeperHeading.current?.focus();
          }}
        >
          {deeper ? (
            <DeeperPanel
              key={deeper.id}
              projectId={projectId}
              thread={thread}
              question={deeper}
              runs={runs.data ?? []}
              talk={talks[deeper.id] ?? ''}
              onTalk={(text) => setTalks((all) => ({ ...all, [deeper.id]: text }))}
              onClose={() => setDeeperId(null)}
              headingRef={deeperHeading}
              compact
            />
          ) : null}
        </Sheet>
      </DraftsProvider>
    </Section>
  );
}

function Item({
  q,
  answer,
  onChange,
  explanation,
  explainButton,
  onTalk,
}: {
  q: Question;
  answer: Answer;
  onChange: (a: Partial<Answer>) => void;
  /** What DEMIURGO explained about the question, when the person asked. */
  explanation: ReactNode;
  explainButton: ReactNode;
  /** Opens Go deeper on the question. */
  onTalk: () => void;
}) {
  const t = useMessages(CONFIRM);
  const d = useMessages(DEFINITION);
  const words = useMessages(ANSWER_WORDS);
  const read = q.state === 'inferred';
  // While a reading is being corrected, the answer it had before: Discard goes back to it. What the
  // person writes counts as it is typed, so a correction confirmed without Save is not lost.
  const [before, setBefore] = useState<string | null>(null);
  const editing = !read || before !== null;
  const section = d.section(q.stage_key ?? '');
  const corrected = read && answer.text.trim() !== (q.conclusion ?? '').trim();
  const write = (value: string) => onChange({ text: value });
  // A list question ("name two or three things") adds a suggestion as a line of the answer, or takes it
  // off again; any other question's suggestion replaces the answer.
  const multiple = q.multiple === true;
  const pick = (value: string) => write(multiple ? toggleLine(answer.text, value) : value);
  const picked = (value: string) => (multiple ? hasLine(answer.text, value) : answer.text === value);
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
              {read && before === null ? (
                <Button size="sm" variant="quiet" onClick={() => setBefore(answer.text)}>
                  {t.correct}
                </Button>
              ) : null}
              <Button size="sm" variant="quiet" onClick={onTalk}>
                {t.talk}
              </Button>
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
            {(q.options && q.options.length > 0) || q.conversation_option ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label={q.question}>
                {q.conversation_option ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="border-accent-edge"
                    aria-pressed={picked(q.conversation_option.answer)}
                    title={q.conversation_option.implies}
                    onClick={() => pick(q.conversation_option?.answer ?? '')}
                    data-conversation-option
                  >
                    <span className="text-xs font-medium text-accent-text">{words.fromConversation}</span>
                    {q.conversation_option.answer}
                  </Button>
                ) : null}
                {(q.options ?? []).map((o) => (
                  <Button
                    key={o.answer}
                    size="sm"
                    variant="secondary"
                    aria-pressed={picked(o.answer)}
                    title={o.implies}
                    onClick={() => pick(o.answer)}
                  >
                    {o.answer}
                  </Button>
                ))}
              </div>
            ) : null}
            <Field label={t.answerLabel(section)} labelHidden>
              {(p) => (
                <TextArea {...p} autoGrow rows={2} maxLength={3000} value={answer.text} onChange={(e) => write(e.target.value)} />
              )}
            </Field>
            {read && before !== null ? (
              <span className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!answer.text.trim()}
                  onClick={() => {
                    onChange({ text: answer.text.trim() });
                    setBefore(null);
                  }}
                >
                  {t.save}
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => {
                    onChange({ text: before });
                    setBefore(null);
                  }}
                >
                  {t.discard}
                </Button>
              </span>
            ) : null}
          </>
        ) : (
          <>
            {multiple && listItems(answer.text).length > 1 ? (
              <ul className="max-w-prose list-disc pl-5 text-base text-fg" data-answer-text>
                {listItems(answer.text).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="max-w-prose text-base text-fg" data-answer-text>
                {answer.text}
              </p>
            )}
            {corrected ? (
              <p className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
                {t.saved}
                <Button size="sm" variant="quiet" onClick={() => onChange({ text: q.conclusion ?? '' })}>
                  {t.backToRead}
                </Button>
              </p>
            ) : null}
          </>
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
