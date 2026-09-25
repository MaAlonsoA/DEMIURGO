// The guided review of a draft over its own page (DESIGN.md §3.6, INV-REC-10/11): five parts —
// context, what it is for (or why it's needed), how it works (or what it decides), the checks and
// what DEMIURGO assumed. The part under review gets an accent outline and a "Part 2 of 5" label;
// the others keep their full contrast (INVENTORY §2 #16). "Looks right" goes on, "Change something"
// hands over to "Ask DEMIURGO about this" (or a new version), and Confirm approves the whole
// version, asking first with a button that says the same word. It can be left at any time.

import { Link } from '@tanstack/react-router';
import { createContext, type ReactNode, type RefObject, useContext, useEffect, useRef, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import type { RecordDetail, RecordVersion } from '../../api/types.ts';
import type { AskBoxHandle } from '../../components/AskBox.tsx';
import { announce } from '../../components/announce.tsx';
import { Count } from '../../components/Badge.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { ArrowRightIcon, CheckIcon } from '../../components/icons.tsx';
import { cn } from '../../lib/cn.ts';
import { type ReviewPart, type ReviewPartKey, reviewBanner, reviewParts, reviewStep } from './review.ts';

const reducedMotion = (): ScrollBehavior =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

type ReviewState = { step: number; parts: ReviewPart[] };
const ReviewContext = createContext<ReviewState>({ step: 0, parts: [] });

/** A piece of the page the review walks: outlined and labelled while it is the part under review. */
export function ReviewArea({ part, children, className }: { part: ReviewPartKey; children: ReactNode; className?: string }) {
  const { step, parts } = useContext(ReviewContext);
  const current = step >= 1 && step <= parts.length ? parts[step - 1] : undefined;
  const active = current !== undefined && !current.quiet && current.key === part;
  return (
    <div
      data-review-part={part}
      data-review-active={active ? 'true' : undefined}
      className={cn(
        'relative scroll-mt-44 rounded-lg transition-colors duration-[var(--m-fast)]',
        active && 'outline-2 outline-offset-8 outline-accent',
        className,
      )}
    >
      {active && current ? (
        // The label sits on the outline's top edge, in the gap above the part, so nothing moves.
        <p data-review-flag className="absolute -top-7 left-0 text-xs font-medium text-accent-text">
          Part {current.n} of {parts.length} · {current.name}
        </p>
      ) : null}
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

/** The banner of a draft that waits for its review, or the bar of the review in progress. */
export function ReviewBand({
  projectId,
  record,
  version,
  review,
  ask,
  canNewVersion,
  onApproved,
}: {
  projectId: string;
  record: RecordDetail;
  version: RecordVersion;
  review: Review;
  ask: RefObject<AskBoxHandle | null>;
  canNewVersion: boolean;
  onApproved: () => void;
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
        className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-accent-edge bg-accent-soft px-4 py-3"
      >
        <Count n={1} label="Needs you: this version waits for your review." />
        <div className="flex min-w-0 flex-1 basis-60 flex-col">
          <p className="text-base font-semibold text-fg">{banner.title}</p>
          <p className="text-sm text-fg-2">{banner.detail}</p>
        </div>
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
      onApproved={onApproved}
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
              aria-label={`Part ${p.n}: ${p.name}${state === 'done' ? ', reviewed' : ''}`}
              title={p.name}
              className={cn(
                'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors duration-[var(--m-fast)]',
                state === 'now' && 'border-2 border-accent bg-panel text-accent-text',
                state === 'done' && 'border-success-edge bg-success-soft text-success-text',
                state === 'next' && 'border-edge-strong bg-panel text-fg-2 hover:border-edge-control',
              )}
            >
              {state === 'done' ? <CheckIcon size={13} /> : p.n}
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
  onApproved,
  onLeave,
}: {
  projectId: string;
  record: RecordDetail;
  version: RecordVersion;
  review: Review;
  ask: RefObject<AskBoxHandle | null>;
  canNewVersion: boolean;
  onApproved: () => void;
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the review starts
  useEffect(() => {
    if (step === 1) ok.current?.focus();
  }, []);
  // The part under review comes into view when it isn't.
  useEffect(() => {
    setChanging(false);
    const el = document.querySelector('[data-review-active="true"]');
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (box.top < 160 || box.top > window.innerHeight - 80) el.scrollIntoView({ block: 'start', behavior: reducedMotion() });
  }, [step]);

  const go = (n: number) => setStep(Math.max(1, Math.min(parts.length + 1, n)));
  const change = () => {
    setChanging(true);
    if (part) ask.current?.prefill(`In ${part.name}: `);
  };

  return (
    <section
      aria-label="Review"
      className="sticky top-14 z-20 flex flex-col gap-3 rounded-lg border border-accent-edge bg-panel px-4 py-3 shadow-popover lg:top-3"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Steps parts={parts} step={step} go={go} />
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5" aria-live="polite">
          <span data-review-label className="text-xs font-medium text-accent-text">
            {words.label}
          </span>
          <p className="text-base font-semibold text-fg">{words.question}</p>
          <p className="text-sm text-fg-2">{words.hint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="quiet" onClick={onLeave}>
            Leave review
          </Button>
          {step > 1 ? (
            <Button variant="quiet" onClick={() => go(step - 1)}>
              Back
            </Button>
          ) : null}
          {words.final ? (
            <>
              <Button onClick={() => go(1)}>Review again</Button>
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
              <Button onClick={change}>Change something</Button>
              <Button ref={ok} variant="primary" onClick={() => go(step + 1)}>
                Looks right
              </Button>
            </>
          )}
        </div>
      </div>
      {changing && part ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-edge pt-3 text-sm text-fg-2">
          <span>
            Tell DEMIURGO what to change in <strong className="font-semibold text-fg">{part.name}</strong>: the box "Ask DEMIURGO
            about this" has it ready.
          </span>
          {canNewVersion ? (
            <>
              <span>Or change it yourself:</span>
              <Link
                to="/p/$projectId/records/$code/new-version"
                params={{ projectId, code: record.code }}
                className={buttonClass({ size: 'sm' })}
              >
                New version <ArrowRightIcon size={12} />
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={(o) => {
          setConfirming(o);
          // Not now: back to Confirm, where the review was.
          if (!o) setTimeout(() => confirm.current?.focus(), 50);
        }}
        title={`Confirm ${version.title}?`}
        description={
          <>
            <p>
              This approves version {version.n}. It becomes the current version. It is Ready to build if nothing else blocks it.
            </p>
            <p>Approving does not create a new version.</p>
          </>
        }
        confirm="Confirm"
        pendingLabel="Confirming…"
        pending={command.isPending}
        error={confirming ? command.error : null}
        onConfirm={() =>
          // mutateAsync: the answer may come after the approval's own event has already ended the
          // review (this bar unmounts), and what follows must still happen.
          void command
            .mutateAsync({ command: 'record_version.approve', entityId: version.id, data: {} })
            .then(() => {
              setConfirming(false);
              setStep(0);
              announce(`Confirmed. Version ${version.n} is the current version.`);
              onApproved();
              // The bar is gone: the focus goes to the top of the page, which now says what it is.
              setTimeout(() => document.getElementById('page-title')?.focus({ preventScroll: true }), 50);
            })
            .catch(() => {
              // The error stays in the dialog (command.error), next to the action.
            })
        }
      />
    </section>
  );
}
