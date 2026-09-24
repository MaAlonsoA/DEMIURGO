// Pieces the Day 1 screens share (canvas S4C to S4E): the frame with its right column and the blue
// band, the line back to the idea, the product's title, DEMIURGO's reading with its observations,
// the person's answers and the quiet "Later" of what H1 cannot give yet.

import { Link } from '@tanstack/react-router';
import { type ReactNode, useId } from 'react';
import type { Message, Question } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { Skeleton } from '../../ui/layout.tsx';
import { Mark, MarkWord } from '../../ui/marks.tsx';
import { WhoGlyph, WhoMark } from '../../ui/signals.tsx';
import { OBSERVATION_WORDS } from '../../words.ts';

/** Main column and a right column the height of the screen, with an optional blue band on top. */
export function DayFrame({
  band,
  aside,
  asideLabel,
  wide = false,
  children,
}: {
  band?: ReactNode;
  aside: ReactNode;
  asideLabel: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[calc(100vh-56px)] flex-col">
      {band}
      <div className="flex flex-1">
        <main id="main" className="flex min-w-0 flex-1 flex-col gap-6 px-10 pt-[26px] pb-28">
          {children}
        </main>
        <aside
          aria-label={asideLabel}
          className={cn('shrink-0 border-l border-line bg-surface', wide ? 'w-[420px]' : 'w-[360px]')}
        >
          <div
            className={cn(
              'sticky flex flex-col gap-[18px] overflow-y-auto',
              wide ? 'px-6 py-[22px]' : 'px-[22px] py-[26px]',
              band ? 'top-[114px] h-[calc(100vh-114px)]' : 'top-14 h-[calc(100vh-56px)]',
            )}
          >
            {aside}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** The blue band under the header (canvas S4C): what the screen asks of the person, and its action. */
export function Band({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="sticky top-14 z-20 bg-surface">
      <div
        data-band
        className="flex h-[58px] items-center justify-between gap-6 border-b border-needs-ring bg-needs-ring/60 px-6 text-needs-hover"
      >
        <div className="flex min-w-0 items-center gap-3 text-[14px]">{children}</div>
        {action}
      </div>
    </div>
  );
}

/** "From your idea: …" and the way to the thread where everything is. */
export function FromYourIdea({ projectId, explorationId, idea }: { projectId: string; explorationId: string; idea: string }) {
  return (
    <div className="flex items-center gap-2.5 text-[13px] text-ink-3">
      <WhoGlyph kind="you" size={20} />
      <span className="min-w-0 truncate">From your idea: “{idea}”</span>
      <Link
        to="/p/$projectId/threads/$explorationId"
        params={{ projectId, explorationId }}
        className="shrink-0 font-semibold text-needs hover:text-needs-hover"
      >
        Open the thread
      </Link>
    </div>
  );
}

export function ProductTitle({ name, className }: { name: string | undefined; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-xs font-semibold text-muted">The product</span>
      {name ? <h1 className="text-[30px] leading-tight font-semibold">{name}</h1> : <Skeleton className="h-9 w-64" />}
    </section>
  );
}

/** A small heading of a section, as the canvas writes them: 12px, muted. */
export function Eyebrow({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <h2 id={id} className={cn('text-xs font-semibold text-muted', className)}>
      {children}
    </h2>
  );
}

/** What H1 cannot give yet: a quiet dashed placeholder, never invented content. */
export function Later({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <Eyebrow id={headingId}>{title}</Eyebrow>
      <div
        data-later={id}
        className="flex items-start gap-2.5 rounded-[10px] border border-dashed border-line-strong px-3.5 py-3 text-[13px] text-muted"
      >
        <span className="shrink-0 rounded-[5px] border border-line-strong px-1.5 text-[11px] leading-[18px] font-semibold tracking-[0.05em] uppercase">
          Later
        </span>
        <span>{children}</span>
      </div>
    </section>
  );
}

/** The three placeholders of Day 1 for what S6 brings: who uses it, the rules and the features. */
export function LaterOfTheProduct({ features = true }: { features?: boolean }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-6">
        <Later id="who" title="Who uses it">
          DEMIURGO will read the people in your idea (S6).
        </Later>
        <Later id="rules" title="Rules for the whole product">
          DEMIURGO will gather the rules your answers set (S6).
        </Later>
      </div>
      {features && (
        <Later id="features" title="What it must do">
          DEMIURGO will split your idea into features (S6). For now, a feature is drafted from a decision you approve, in the
          thread.
        </Later>
      )}
    </>
  );
}

/** DEMIURGO's reply, as the lead line of its reading. */
export function ReplyLine({ reply, model, className }: { reply: Message | null; model: string | null; className?: string }) {
  if (!reply) return null;
  return (
    <p className={cn('flex items-start gap-2.5 text-[16px] leading-relaxed text-ink-2', className)}>
      <span className="mt-[3px] shrink-0">
        <WhoMark actor={reply.author} model={model} size={20} />
      </span>
      <span className="whitespace-pre-wrap">{reply.body}</span>
    </p>
  );
}

/** One observation of DEMIURGO with its mark and word: claim or hypothesis (Proposed), unknown (?). */
export function ObservationRow({ observation: o, compact = false }: { observation: Message; compact?: boolean }) {
  const w = OBSERVATION_WORDS[o.kind ?? 'unknown'] ?? { word: o.kind ?? 'Unknown', mark: 'unknown' as const };
  return (
    <li
      data-observation={o.kind}
      className={cn(
        'flex items-start gap-3 rounded-[8px] border border-line bg-surface',
        compact ? 'px-2.5 py-1.5 text-[13px]' : 'px-3 py-2 text-[14px]',
      )}
    >
      <span className={cn('flex shrink-0 items-center', compact ? 'w-[92px] pt-px' : 'w-[104px] pt-0.5')}>
        <MarkWord kind={w.mark} word={w.word} />
      </span>
      <span className="min-w-0 text-ink">{o.body}</span>
    </li>
  );
}

/** The person's answer to a question: confirmed, with the question it answers. */
export function AnswerRow({ question: q }: { question: Question }) {
  return (
    <li data-answer={q.id} className="flex items-start gap-2.5 rounded-[8px] border border-line bg-surface px-3 py-2">
      <span className="mt-[5px] shrink-0">
        <Mark kind="confirmed" label="Confirmed" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-xs text-muted">{q.question}</span>
        <span className="text-[14px] text-ink">{q.conclusion}</span>
      </span>
    </li>
  );
}

export function DaySkeleton({ label }: { label: string }) {
  return (
    <DayFrame
      asideLabel={label}
      aside={
        <div aria-hidden="true" className="flex flex-col gap-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      }
    >
      <div role="status" aria-label={label} className="flex flex-col gap-4">
        <Skeleton className="h-3 w-72" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-80" />
        <Skeleton className="mt-4 h-5 w-3/5" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </DayFrame>
  );
}
