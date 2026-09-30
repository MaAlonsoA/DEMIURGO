// A feature's Behavior as a numbered list of steps: the lead sentence of each point, and the rest of
// its paragraph quieter underneath. Parsing is `behaviorSteps` of the domain.

import { behaviorSteps } from '../../../domain/src/views.ts';
import { useMessages } from '../i18n/define.ts';
import { Code } from './Badge.tsx';
import { Markdown } from './Markdown.tsx';
import { BEHAVIOR_STEPS } from './words.i18n.ts';

/** The section that reads as steps; records are always written in English. */
export const BEHAVIOR_TITLE = 'Behavior';

/** The check of a step: enough to list it and anchor to its row in the checks list. */
export type StepCheck = { code?: string; title: string; statement?: string; step?: number | null };

/** The id of a check's row in the checks list, so a step can link to it. */
export const checkAnchor = (code: string) => `check-${code}`;

/** How many steps there are (0 when the text is not steps). */
export function stepCount(text: string): number {
  const listed = /\n\s*\n/.test(text) || /^\s*(?:[-*]|\d+\.)\s/m.test(text);
  return behaviorSteps(listed ? text : text.replace(/\n/g, '\n\n')).length;
}

/** True when a check says it is not tied to any step of a Behavior with `steps` steps. */
export const isUntied = (c: { step?: number | null }, steps: number) =>
  steps > 0 && (c.step == null || c.step < 1 || c.step > steps);

export function BehaviorSteps({ text, criteria = [] }: { text: string; criteria?: StepCheck[] }) {
  const t = useMessages(BEHAVIOR_STEPS);
  // One paragraph per line (no blank lines, no list marks) is also one step per line.
  const listed = /\n\s*\n/.test(text) || /^\s*(?:[-*]|\d+\.)\s/m.test(text);
  const steps = behaviorSteps(listed ? text : text.replace(/\n/g, '\n\n'));
  if (steps.length === 0) return <Markdown>{text}</Markdown>;
  // Gaps are only flagged once the criteria say which step they check (older data does not).
  const tied = criteria.some((c) => c.step != null);
  return (
    <ol className="flex flex-col gap-3" data-behavior-steps>
      {steps.map((s) => (
        <li key={s.n} className="grid grid-cols-[1.5rem_1fr] gap-x-2">
          <span className="text-sm font-medium text-fg-3 tabular-nums">{s.n}.</span>
          <div className="flex flex-col gap-1">
            <p className="text-md font-semibold text-fg">{s.title}</p>
            {s.detail.map((d, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: detail lines are positional
              <p key={i} className="text-sm text-fg-2">
                {d}
              </p>
            ))}
            <StepChecks checks={criteria.filter((c) => c.step === s.n)} gap={tied} gapText={t.noCheckForStep} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function StepChecks({ checks, gap, gapText }: { checks: StepCheck[]; gap: boolean; gapText: string }) {
  if (checks.length === 0) return gap ? <p className="text-xs text-fg-3" data-step-gap>{gapText}</p> : null;
  return (
    <ul className="flex flex-col gap-0.5" data-step-checks>
      {checks.map((c, i) => {
        const body = (
          <>
            {c.code ? <Code>{c.code}</Code> : null} <span>{c.title}</span>
          </>
        );
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a check may have no code yet
          <li key={c.code ?? i} className="text-xs text-fg-2">
            {c.code ? (
              <a href={`#${checkAnchor(c.code)}`} className="hover:underline">
                {body}
              </a>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A section's content: steps when it is the Behavior, prose otherwise. */
export function SectionContent({
  title,
  text,
  className,
  criteria,
}: {
  title: string;
  text: string;
  className?: string;
  criteria?: StepCheck[];
}) {
  return title === BEHAVIOR_TITLE ? <BehaviorSteps text={text} criteria={criteria} /> : <Markdown className={className}>{text}</Markdown>;
}
