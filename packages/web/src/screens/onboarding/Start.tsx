// Day 1 once the idea is written (canvas S4B and S4C, adapted to H1). First DEMIURGO reads it live;
// then "Here's what I understood": its reading, all proposed, its questions, what it proposed, and
// a quiet "Later" for what H1 cannot give yet (who uses it, rules, features: S6). The person answers
// the questions one at a time, or corrects something and DEMIURGO reads it again.

import { Node } from '@demiurgo/design-system';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { batchQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { Message, Question, RunListItem } from '../../api/types.ts';
import { useRouteParams, useTables } from '../../lib/hooks.ts';
import { Button, buttonClass } from '../../ui/Button.tsx';
import { ChevronRight, DashIcon } from '../../ui/icons.tsx';
import { Mark, MarkGlyph } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { NeedsBubble } from '../../ui/signals.tsx';
import { PROPOSAL_TYPE_WORDS, proposalTitle } from '../batch/model.ts';
import { NotFound } from '../not-found/NotFound.tsx';
import { isDecisionRequest, pendingInOrder, readingsOf, writtenBy } from './day.ts';
import { useDay, useSend } from './hooks.ts';
import { live } from './live.ts';
import {
  Band,
  DayFrame,
  DaySkeleton,
  Eyebrow,
  FromYourIdea,
  LaterOfTheProduct,
  ObservationRow,
  ProductTitle,
  ReplyLine,
} from './parts.tsx';
import { LiveReading, type ReadingContent, ReadingStatus, type Subject } from './Reading.tsx';

export function StartScreen() {
  const { projectId, explorationId = '' } = useRouteParams();
  const day = useDay(projectId, explorationId);
  const [watching, setWatching] = useState(() => live.isLive(explorationId));
  const loaded = !!day.thread && !!day.runs;
  const unread = loaded && readingsOf(day.thread?.messages ?? [], day.runs ?? []).length === 0;
  // Whoever sees DEMIURGO reading also sees it finish, and moves on with "See what I understood".
  useEffect(() => {
    if (unread) setWatching(true);
  }, [unread]);

  if (day.error instanceof ApiError && day.error.status === 404) {
    return <NotFound thing="this idea">It may belong to another project.</NotFound>;
  }
  if (!day.thread || !day.runs) {
    return day.error ? (
      <main id="main" className="mx-auto max-w-[760px] px-6 pt-14">
        <Reasons error={day.error} />
      </main>
    ) : (
      <DaySkeleton label="Loading your idea" />
    );
  }

  const { thread, runs, idea, latest, reading, now } = day;
  const readings = readingsOf(thread.messages, runs);
  const understanding = readings.at(-1) ?? null;

  if (!idea) {
    return (
      <main id="main" className="flex justify-center px-6 pt-14 pb-28">
        <div className="flex w-[760px] flex-col items-start gap-3">
          <h1 className="dm-text-page-title">{thread.purpose}</h1>
          <p className="dm-text-heading text-ink-2 font-normal">
            Nothing was written in this thread yet, so DEMIURGO has nothing to read.
          </p>
          <Link
            to="/p/$projectId/threads/$explorationId"
            params={{ projectId, explorationId }}
            className={buttonClass('secondary')}
          >
            Open the thread
          </Link>
        </div>
      </main>
    );
  }
  if (watching || !understanding) {
    const run = reading.phase === 'read' ? reading.run : null;
    return (
      <main id="main" className="flex justify-center px-6 pt-14 pb-28">
        <div className="w-[760px]">
          <LiveReading
            projectId={projectId}
            explorationId={explorationId}
            idea={idea}
            reading={reading}
            content={run ? contentOf(run, thread.messages, thread.questions) : null}
            now={now}
            onSee={() => {
              live.end(explorationId);
              setWatching(false);
            }}
          />
        </div>
      </main>
    );
  }

  const subject: Subject = latest && isDecisionRequest(latest) ? 'decisions' : latest?.id === idea.id ? 'idea' : 'correction';
  return (
    <Understood
      projectId={projectId}
      explorationId={explorationId}
      name={day.project?.name}
      idea={idea.body}
      content={contentOf(understanding, thread.messages, thread.questions)}
      newReading={readings.length > 1}
      status={<ReadingStatus projectId={projectId} explorationId={explorationId} reading={reading} subject={subject} now={now} />}
      busy={reading.phase === 'waiting' || reading.phase === 'working'}
    />
  );
}

function contentOf(run: RunListItem, messages: Message[], questions: Question[]): ReadingContent {
  return { ...writtenBy(messages, run.id), questions: pendingInOrder(questions), batchId: run.batch_id, model: run.model };
}

/** "Here's what I understood" (canvas S4C): everything proposed, then the questions one at a time. */
function Understood({
  projectId,
  explorationId,
  name,
  idea,
  content,
  newReading,
  status,
  busy,
}: {
  projectId: string;
  explorationId: string;
  name: string | undefined;
  idea: string;
  content: ReadingContent;
  newReading: boolean;
  status: ReactNode;
  busy: boolean;
}) {
  const [correcting, setCorrecting] = useState(false);
  const understoodId = useId();
  const questions = content.questions;
  const n = questions.length;
  const next =
    n > 0
      ? { label: 'Answer in the thread', to: '/p/$projectId/threads/$explorationId' as const }
      : { label: 'See your starting point', to: '/p/$projectId/start/$explorationId/done' as const };

  return (
    <DayFrame
      asideLabel="What happens now"
      band={
        <Band
          action={
            <Link to={next.to} params={{ projectId, explorationId }} className={buttonClass('primary')}>
              {next.label}
            </Link>
          }
        >
          {n > 0 && (
            <NeedsBubble count={n} detail={`Needs you: ${n} ${n === 1 ? 'question waits' : 'questions wait'} for you.`} />
          )}
          <span className="truncate">
            <strong className="font-semibold">
              {newReading ? 'This is my new reading, with your corrections.' : 'This is my first reading of your idea.'}
            </strong>{' '}
            {n > 0
              ? "Nothing is decided: correct anything that's wrong, then answer my questions."
              : "Nothing is decided: correct anything that's wrong."}
          </span>
        </Band>
      }
      aside={
        <>
          <h2 className="dm-text-body font-semibold">What happens now</h2>
          <section className="flex flex-col gap-2">
            <h3 className="dm-text-caption font-semibold text-muted">Nothing is decided yet</h3>
            <p className="dm-text-small flex gap-2.5">
              <span className="mt-[5px] flex">
                <MarkGlyph kind="proposed" />
              </span>
              Everything on the left is only proposed. You decide on each thing.
            </p>
            <p className="dm-text-small flex gap-2.5">
              <DashIcon size={12} className="mt-1 shrink-0 text-muted" />
              Nothing is built. Each feature will get its own details and checks.
            </p>
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="dm-text-caption font-semibold text-muted">
              {n > 0 ? `Then I'll ask you ${n} ${n === 1 ? 'question' : 'questions'}, one at a time` : 'No questions for now'}
            </h3>
            {questions.map((q) => (
              <div key={q.id} data-question={q.id}>
                <Node type="question" state="open" mark={<Mark kind="open" label="Open" />} title={q.question} />
              </div>
            ))}
            <p className="dm-text-caption text-muted">
              Smaller things I&apos;ll decide on my own and mark as assumed, so you can check them later.
            </p>
          </section>
          <div className="mt-auto flex flex-col gap-2">
            <Link to={next.to} params={{ projectId, explorationId }} className={buttonClass('primary', 'w-full')}>
              {next.label}
            </Link>
            <Button variant="secondary" className="w-full" onClick={() => setCorrecting(true)}>
              Correct something
            </Button>
          </div>
        </>
      }
    >
      <FromYourIdea projectId={projectId} explorationId={explorationId} idea={idea} />
      <ProductTitle name={name} />
      <section aria-labelledby={understoodId} className="flex flex-col gap-2.5">
        <Eyebrow id={understoodId}>What I understood</Eyebrow>
        {status}
        {correcting && <Correction projectId={projectId} explorationId={explorationId} onDone={() => setCorrecting(false)} />}
        <div className="flex flex-col gap-2.5" aria-busy={busy || undefined}>
          <ReplyLine reply={content.reply} model={content.model} />
          {content.observations.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {content.observations.map((o) => (
                <ObservationRow key={o.id} observation={o} />
              ))}
            </ul>
          )}
        </div>
      </section>
      {content.batchId && <Proposed projectId={projectId} batchId={content.batchId} />}
      <LaterOfTheProduct />
    </DayFrame>
  );
}

/** "Correct something": the person says what's wrong and DEMIURGO reads the idea again. */
function Correction({ projectId, explorationId, onDone }: { projectId: string; explorationId: string; onDone: () => void }) {
  const tables = useTables();
  const { send, pending, error } = useSend(projectId, explorationId);
  const [text, setText] = useState('');
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    field.current?.focus();
    field.current?.scrollIntoView({ block: 'center' });
  }, []);
  const canPost = !tables || canCreate(tables, 'message.post');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) send(text.trim(), onDone);
      }}
      className="dm-card gap-2 border-line-strong p-3.5 shadow-raised focus-within:border-needs"
    >
      <label htmlFor={id} className="dm-text-small font-semibold text-ink-2">
        What&apos;s wrong?
      </label>
      <textarea
        ref={field}
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={20_000}
        placeholder="Say it in your own words: DEMIURGO reads your idea again with it."
        className="dm-text-body w-full resize-y bg-transparent leading-relaxed text-ink outline-none placeholder:text-muted"
      />
      {error ? <Reasons error={error} /> : null}
      <div className="flex items-center justify-end gap-2">
        <Button variant="text" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="secondary" disabled={!canPost || pending || !text.trim()}>
          {pending ? 'Sending…' : 'Send and read again'}
        </Button>
      </div>
    </form>
  );
}

/** What the reading proposed: each proposal waits for the person on its batch page. */
function Proposed({ projectId, batchId }: { projectId: string; batchId: string }) {
  const batch = useQuery(batchQuery(projectId, batchId)).data;
  const headingId = useId();
  if (!batch) return null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <Eyebrow id={headingId}>What I propose</Eyebrow>
      <ul className="flex flex-col gap-1.5">
        {batch.proposals.map((p) => (
          <li
            key={p.id}
            data-proposal={p.id}
            className="dm-text-body flex items-center gap-3 rounded-sm border border-line bg-surface px-3 py-2"
          >
            <Mark
              kind={p.state === 'pending' ? 'proposed' : 'confirmed'}
              label={p.state === 'pending' ? 'Proposed' : 'Accepted'}
            />
            <span className="dm-text-caption w-[72px] shrink-0 font-semibold text-muted">
              {PROPOSAL_TYPE_WORDS[p.type] ?? p.type}
            </span>
            <span className="min-w-0 flex-1 truncate">{proposalTitle(p)}</span>
            <Link
              to="/p/$projectId/batches/$batchId"
              params={{ projectId, batchId: batch.id }}
              className="dm-text-small inline-flex shrink-0 items-center gap-0.5 font-semibold text-needs hover:text-needs-strong"
            >
              Review
              <ChevronRight size={12} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
