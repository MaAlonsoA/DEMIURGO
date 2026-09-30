// A feature's Behavior as a numbered list of steps: the lead sentence of each point, and the rest of
// its paragraph quieter underneath. Parsing is `behaviorSteps` of the domain.

import { behaviorSteps } from '../../../domain/src/views.ts';
import { Markdown } from './Markdown.tsx';

/** The section that reads as steps; records are always written in English. */
export const BEHAVIOR_TITLE = 'Behavior';

export function BehaviorSteps({ text }: { text: string }) {
  // One paragraph per line (no blank lines, no list marks) is also one step per line.
  const listed = /\n\s*\n/.test(text) || /^\s*(?:[-*]|\d+\.)\s/m.test(text);
  const steps = behaviorSteps(listed ? text : text.replace(/\n/g, '\n\n'));
  if (steps.length === 0) return <Markdown>{text}</Markdown>;
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
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A section's content: steps when it is the Behavior, prose otherwise. */
export function SectionContent({ title, text, className }: { title: string; text: string; className?: string }) {
  return title === BEHAVIOR_TITLE ? <BehaviorSteps text={text} /> : <Markdown className={className}>{text}</Markdown>;
}
