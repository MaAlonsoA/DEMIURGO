// Pieces the Day 1 screens share (DESIGN.md §3.9): the idea as the person wrote it, DEMIURGO's
// reply and its observations (all Proposed or Unknown: nothing here is decided), the person's
// answers, the quiet "Later" of what H1 cannot give yet (S6), the taxonomy note and the loading and
// error states of the day. Every state carries its word (StatusBadge), never a bare mark.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useId, useState } from 'react';
import { taxonomiesQuery } from '../../api/queries.ts';
import type { Message, Question } from '../../api/types.ts';
import { Tag } from '../../components/Badge.tsx';
import { ChevronRightIcon, TagIcon } from '../../components/icons.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader } from '../../components/Page.tsx';
import { PageSkeleton } from '../../components/Spinner.tsx';
import { EntityState, StatusBadge } from '../../components/status.tsx';
import { Who, WhoAvatar } from '../../components/Who.tsx';
import { cn } from '../../lib/cn.ts';
import { OBSERVATION_WORDS } from '../../words.ts';

const LONG_IDEA = 280;

/** "From your idea: “…”", whole or folded to three lines, and the way to the thread where everything is. */
export function FromYourIdea({
  projectId,
  explorationId,
  idea,
  className,
}: {
  projectId: string;
  explorationId: string;
  idea: string;
  className?: string;
}) {
  const [all, setAll] = useState(false);
  const id = useId();
  const long = idea.length > LONG_IDEA || idea.split('\n').length > 3;
  return (
    <figure className={cn('flex items-start gap-3', className)}>
      <WhoAvatar kind="you" size={24} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-2">
          <span className="font-medium text-fg">From your idea</span>
          <Link
            to="/p/$projectId/threads/$explorationId"
            params={{ projectId, explorationId }}
            className="inline-flex items-center gap-0.5 font-medium text-accent-text hover:underline"
          >
            Open the thread
            <ChevronRightIcon size={13} />
          </Link>
        </figcaption>
        <blockquote id={id} className={cn('text-md whitespace-pre-wrap text-fg-2 break-words', long && !all && 'line-clamp-3')}>
          “{idea}”
        </blockquote>
        {long ? (
          <button
            type="button"
            aria-expanded={all}
            aria-controls={id}
            onClick={() => setAll((a) => !a)}
            className="self-start text-sm font-medium text-accent-text hover:underline"
          >
            {all ? 'Show less' : 'Show all'}
          </button>
        ) : null}
      </div>
    </figure>
  );
}

/** DEMIURGO's reply as it wrote it (Markdown), signed with who wrote it and its engine. */
export function Reply({ reply, model, muted }: { reply: Message | null; model: string | null; muted?: boolean }) {
  if (!reply) return null;
  return (
    <div className="flex flex-col gap-2">
      <Who actor={reply.author} model={model} size={20} className="text-sm text-fg-2" />
      <Markdown className={cn(muted && 'text-fg-2')}>{reply.body}</Markdown>
    </div>
  );
}

/** One observation of DEMIURGO with its word: a claim or a hypothesis is Proposed, an unknown is Unknown. */
export function ObservationList({ observations, compact }: { observations: readonly Message[]; compact?: boolean }) {
  if (observations.length === 0) return null;
  return (
    <ul className={cn('flex flex-col', compact ? 'gap-2' : 'gap-2.5')}>
      {observations.map((o) => {
        const w = OBSERVATION_WORDS[o.kind ?? 'unknown'] ?? { word: o.kind ?? 'Unknown', mark: 'unknown' as const };
        return (
          <li
            key={o.id}
            data-observation={o.kind}
            className={cn(
              'flex flex-col items-start gap-1.5 rounded-lg border border-edge bg-panel sm:flex-row sm:gap-3',
              compact ? 'px-3 py-2 text-sm' : 'px-3.5 py-2.5 text-base',
            )}
          >
            <span className="flex shrink-0 sm:w-24">
              <StatusBadge kind={w.mark} word={w.word} />
            </span>
            <span className="min-w-0 text-fg break-words">{o.body}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The person's answer to a question: confirmed, under the question it answers. */
export function AnswerRow({ question: q }: { question: Question }) {
  return (
    <li data-answer={q.id} className="flex flex-col gap-1.5 rounded-lg border border-edge bg-panel px-3.5 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 flex-1 text-sm text-fg-2">{q.question}</span>
        <EntityState entity="question" state={q.state} />
      </div>
      <span className="text-base text-fg break-words">{q.conclusion}</span>
    </li>
  );
}

/** What H1 cannot give yet: a quiet dashed placeholder with its "Later" tag, never invented content. */
export function Later({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-base font-semibold text-fg">
        {title}
      </h2>
      <div
        data-later={id}
        className="flex items-start gap-3 rounded-lg border border-dashed border-edge-strong px-3.5 py-3 text-sm text-fg-2"
      >
        <Tag>Later</Tag>
        <span>{children}</span>
      </div>
    </section>
  );
}

/** The three placeholders of Day 1 for what S6 brings: who uses it, the rules and the features. */
export function LaterOfTheProduct({ features = true }: { features?: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 md:grid-cols-2">
        <Later id="who" title="Who uses it">
          DEMIURGO will read the people in your idea (S6).
        </Later>
        <Later id="rules" title="Rules for the whole product">
          DEMIURGO will gather the rules your answers set (S6).
        </Later>
      </div>
      {features ? <LaterFeatures /> : null}
    </div>
  );
}

export function LaterFeatures() {
  return (
    <Later id="features" title="What it must do">
      DEMIURGO will split your idea into features (S6). For now, a feature is drafted from a decision you approve, in the thread.
    </Later>
  );
}

/**
 * While no taxonomy is approved, what DEMIURGO knows is not grouped: this says so and takes the
 * person to set one up (Knowledge · Taxonomy).
 */
export function TaxonomyNote({ projectId }: { projectId: string }) {
  const list = useQuery(taxonomiesQuery(projectId));
  if (!list.data || list.data.some((t) => t.state === 'approved')) return null;
  const proposed = list.data.some((t) => t.state === 'draft');
  return (
    <div data-taxonomy-hint className="flex items-start gap-2.5 rounded-lg border border-edge px-3.5 py-3 text-sm text-fg-2">
      <TagIcon size={15} className="mt-0.5 shrink-0 text-fg-3" />
      <p>
        {proposed
          ? 'A taxonomy is waiting for your approval: until then, what DEMIURGO knows is not grouped.'
          : "DEMIURGO doesn't group what it knows yet."}{' '}
        <Link
          to="/p/$projectId/knowledge"
          params={{ projectId }}
          search={{ tab: 'taxonomy' }}
          className="inline-flex items-center gap-0.5 font-medium whitespace-nowrap text-accent-text hover:underline"
        >
          {proposed ? 'Review the taxonomy' : 'Set up how it groups knowledge'}
          <ChevronRightIcon size={13} />
        </Link>
      </p>
    </div>
  );
}

/** A small heading inside the day's side column. */
export function AsideHeading({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="text-sm font-semibold text-fg">
      {children}
    </h3>
  );
}

/** The first load of a Day 1 screen: shaped like its page, after 300 ms. */
export function DaySkeleton({ label }: { label: string }) {
  return (
    <PageBody>
      <PageSkeleton label={label} />
    </PageBody>
  );
}

/** A Day 1 screen that could not load: what it is, the reason in product words and Retry. */
export function DayError({ title, error, onRetry }: { title: string; error: unknown; onRetry: () => void }) {
  return (
    <>
      <PageHeader title={title} />
      <PageBody width="reading">
        <ErrorNotice error={error} onRetry={onRetry} />
      </PageBody>
    </>
  );
}
