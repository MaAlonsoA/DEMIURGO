// The guided review of a draft over its own page (canvas S5A banner and S5B bar, design doc §6):
// the part under review is outlined in blue and the rest steps back; "Looks right" goes on,
// "Change something" hands over to "Ask DEMIURGO about this" (or a new version), and Confirm
// approves the whole version, asking first. It can be left at any time.

import { Link } from '@tanstack/react-router';
import { createContext, type ReactNode, type RefObject, useContext, useEffect, useRef, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import type { RecordDetail, RecordVersion } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import type { AskBarHandle } from '../../ui/AskBar.tsx';
import { Button, buttonClass } from '../../ui/Button.tsx';
import { ConfirmDialog } from '../../ui/dialogs.tsx';
import { ChevronRight } from '../../ui/icons.tsx';
import { NeedsBubble } from '../../ui/signals.tsx';
import { type ReviewPart, type ReviewPartKey, reviewBanner, reviewParts, reviewStep } from './review.ts';

/** Keys of what the review dims: its five parts and the rest of the page. */
type PartKey = ReviewPartKey | 'readiness' | 'versions' | 'annexes';

const reducedMotion = (): ScrollBehavior =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

type ReviewState = { step: number; parts: ReviewPart[] };
const ReviewContext = createContext<ReviewState>({ step: 0, parts: [] });

/** A piece of the page the review walks: outlined when under review, dimmed when another part is. */
export function ReviewArea({ part, children, className }: { part: PartKey; children: ReactNode; className?: string }) {
  const { step, parts } = useContext(ReviewContext);
  const current = step >= 1 && step <= parts.length ? parts[step - 1] : undefined;
  const on = current !== undefined;
  const active = on && !current.quiet && current.key === part;
  return (
    <div
      data-review-part={part}
      data-review-active={active ? 'true' : undefined}
      data-dimmed={on && !active ? 'true' : undefined}
      className={cn(
        'rounded-card-md transition-opacity duration-200',
        part === 'context' || part === 'checks' || part === 'what' || part === 'how' ? 'scroll-mt-[196px]' : '',
        active && 'outline-2 outline-offset-8 outline-needs',
        on && !active && 'opacity-35',
        className,
      )}
    >
      {children}
    </div>
  );
}

export type Review = {
  step: number;
  parts: ReviewPart[];
  setStep: (step: number) => void;
};

/**
 * The review of the version on screen. It ends when the version can no longer be reviewed: once
 * confirmed (or approved elsewhere) the page goes back to the top, where it says what it is now.
 */
export function useReview(record: RecordDetail, version: RecordVersion, reviewable: boolean): Review {
  const [step, setStep] = useState(0);
  // Another version on screen starts without a review.
  const [shown, setShown] = useState(version.id);
  if (shown !== version.id) {
    setShown(version.id);
    setStep(0);
  }
  const ended = !reviewable && step > 0;
  useEffect(() => {
    if (!ended) return;
    setStep(0);
    window.scrollTo({ top: 0, behavior: reducedMotion() });
  }, [ended]);
  return { step: reviewable ? step : 0, parts: reviewParts(record.type, version), setStep };
}

/** The sections of the record, grouped by the part of the review they belong to. */
export function ReviewSections({
  sections,
  parts,
  children,
}: {
  sections: RecordVersion['sections'];
  parts: ReviewPart[];
  children: (section: RecordVersion['sections'][number]) => ReactNode;
}) {
  const how = new Set(parts.find((p) => p.key === 'how')?.sections ?? []);
  const groups: { part: 'what' | 'how'; items: RecordVersion['sections'] }[] = [];
  sections.forEach((s, i) => {
    const part = how.has(i) ? 'how' : 'what';
    const last = groups.at(-1);
    if (last?.part === part) last.items.push(s);
    else groups.push({ part, items: [s] });
  });
  return groups.map((g, i) => (
    <ReviewArea key={`${g.part}-${i}`} part={g.part} className="flex flex-col gap-6">
      {g.items.map(children)}
    </ReviewArea>
  ));
}

export function ReviewProvider({ review, children }: { review: Review; children: ReactNode }) {
  return <ReviewContext.Provider value={{ step: review.step, parts: review.parts }}>{children}</ReviewContext.Provider>;
}

/** The banner of a draft that waits for its review (S5A), or the bar of the review in progress (S5B). */
export function ReviewBand({
  projectId,
  record,
  version,
  review,
  ask,
  canNewVersion,
}: {
  projectId: string;
  record: RecordDetail;
  version: RecordVersion;
  review: Review;
  ask: RefObject<AskBarHandle | null>;
  canNewVersion: boolean;
}) {
  const start = useRef<HTMLButtonElement>(null);
  const focusStart = useRef(false);
  useEffect(() => {
    if (review.step === 0 && focusStart.current) {
      focusStart.current = false;
      start.current?.focus();
    }
  }, [review.step]);

  if (review.step === 0) {
    const banner = reviewBanner(version);
    return (
      <div
        data-review-banner
        className="mb-5 flex items-center gap-4 rounded-card border border-needs-line bg-needs-soft py-3 pr-3.5 pl-[18px]"
      >
        <NeedsBubble count={1} detail="Needs you: this version waits for your review." />
        <span className="flex min-w-0 flex-1 flex-col">
          <strong className="dm-text-heading">{banner.title}</strong>
          <span className="dm-text-small text-ink-3">{banner.detail}</span>
        </span>
        <Button ref={start} variant="primary" onClick={() => review.setStep(1)}>
          Start review
        </Button>
      </div>
    );
  }
  return (
    <ReviewBar
      projectId={projectId}
      record={record}
      version={version}
      review={review}
      ask={ask}
      canNewVersion={canNewVersion}
      onLeave={() => {
        focusStart.current = true;
        review.setStep(0);
      }}
    />
  );
}

function Steps({ parts, step, go }: { parts: ReviewPart[]; step: number; go: (n: number) => void }) {
  return (
    <ol aria-label="Parts" className="flex items-center gap-1.5">
      {parts.map((p) => {
        const state = p.n === step ? 'now' : p.n < step ? 'done' : 'next';
        return (
          <li key={p.key}>
            <button
              type="button"
              onClick={() => go(p.n)}
              aria-current={state === 'now' ? 'step' : undefined}
              aria-label={`Part ${p.n}: ${p.name}`}
              title={p.name}
              className={cn(
                'dm-text-caption inline-flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] font-bold transition-colors',
                // The part on screen has the selection outline: a blue fill would read as the Needs you counter.
                state === 'now' && 'border-2 border-needs bg-surface text-needs-strong',
                state === 'done' && 'border-ink bg-ink text-surface',
                state === 'next' && 'border-inactive-soft bg-surface text-muted hover:border-ink-3',
              )}
            >
              {p.n}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function ReviewBar({
  projectId,
  record,
  version,
  review,
  ask,
  canNewVersion,
  onLeave,
}: {
  projectId: string;
  record: RecordDetail;
  version: RecordVersion;
  review: Review;
  ask: RefObject<AskBarHandle | null>;
  canNewVersion: boolean;
  onLeave: () => void;
}) {
  const command = useCommand(projectId);
  const [confirming, setConfirming] = useState(false);
  const [changing, setChanging] = useState(false);
  const ok = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const { step, parts, setStep } = review;
  const words = reviewStep(parts, step, version.title);
  const part = parts[step - 1];

  // Keyboard: the focus stays on the way forward (Looks right, then Confirm).
  useEffect(() => {
    if (words.final) confirm.current?.focus();
    else if (document.activeElement === document.body || !document.activeElement) ok.current?.focus();
  }, [words.final]);
  useEffect(() => {
    if (step === 1) ok.current?.focus();
  }, []);
  // The part under review comes into view when it is in the main column.
  useEffect(() => {
    setChanging(false);
    const el = document.querySelector('main [data-review-active="true"]');
    el?.scrollIntoView({ block: 'start', behavior: reducedMotion() });
  }, [step]);

  const go = (n: number) => setStep(Math.max(1, Math.min(parts.length + 1, n)));
  const change = () => {
    setChanging(true);
    if (part) ask.current?.prefill(`In ${part.name}: `);
  };

  return (
    <section
      aria-label="Review"
      className="sticky top-[68px] z-20 mb-5 flex flex-col gap-2.5 rounded-card border border-needs-line bg-needs-soft py-3 pr-3.5 pl-[18px] shadow-raised"
    >
      <div className="flex items-center gap-[18px]">
        <Steps parts={parts} step={step} go={go} />
        <span className="w-px self-stretch bg-needs-line" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col" aria-live="polite">
          <span data-review-label className="dm-text-caption font-semibold text-needs-strong">
            {words.label}
          </span>
          <strong className="dm-text-heading">{words.question}</strong>
          <span className="dm-text-small leading-snug text-ink-3">{words.hint}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="text" onClick={onLeave}>
            Leave review
          </Button>
          {step > 1 && (
            <Button variant="text" onClick={() => go(step - 1)}>
              Back
            </Button>
          )}
          {words.final ? (
            <>
              <Button variant="secondary" onClick={() => go(1)}>
                Review again
              </Button>
              <Button
                ref={confirm}
                variant="primary"
                onClick={() => {
                  command.reset();
                  setConfirming(true);
                }}
              >
                Confirm
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={change}>
                Change something
              </Button>
              <Button ref={ok} variant="primary" onClick={() => go(step + 1)}>
                Looks right
              </Button>
            </>
          )}
        </div>
      </div>
      {changing && part && (
        <p className="dm-text-small flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-needs-line pt-2.5 text-ink-2">
          <span>
            Tell DEMIURGO what to change in <strong className="font-semibold">{part.name}</strong>: it is written on the right.
          </span>
          {canNewVersion && (
            <>
              <span>Or change it yourself:</span>
              <Link
                to="/p/$projectId/records/$code/new-version"
                params={{ projectId, code: record.code }}
                className={buttonClass('secondary')}
              >
                New version
                <ChevronRight size={11} />
              </Link>
            </>
          )}
        </p>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Confirm ${version.title}?`}
        description={
          <>
            <p>
              This approves version {version.n}. It becomes the current version. It is Ready to build if nothing else blocks it.
            </p>
            <p className="mt-2 text-muted">Approving does not create a new version.</p>
          </>
        }
        confirm="Approve"
        pending={command.isPending}
        error={confirming ? command.error : null}
        onConfirm={() =>
          command.mutate(
            { command: 'record_version.approve', entityId: version.id, data: {} },
            {
              onSuccess: () => {
                setConfirming(false);
                setStep(0);
              },
            },
          )
        }
      />
    </section>
  );
}
