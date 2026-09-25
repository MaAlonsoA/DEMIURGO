// Who did something (DESIGN.md §6.5): a person, DEMIURGO, an outside agent or an automatic rule.
// People are round; DEMIURGO is a square monogram in the accent; agents are a square robot; rules
// a bolt — an agent is never mistaken for a person (R29, R26).

import type { Actor } from '../api/types.ts';
import { cn } from '../lib/cn.ts';
import { type Who as WhoValue, WHO_PHRASES, whoOf } from '../words.ts';
import { AgentIcon, AutomaticIcon, PersonIcon } from './icons.tsx';

export function WhoAvatar({ kind, size = 20, className }: { kind: WhoValue['kind']; size?: number; className?: string }) {
  const icon = Math.round(size * 0.62);
  if (kind === 'demiurgo')
    return (
      <span
        aria-hidden
        data-who="demiurgo"
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-xs bg-accent font-semibold text-on-accent',
          className,
        )}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
      >
        D
      </span>
    );
  if (kind === 'agent')
    return (
      <span
        aria-hidden
        data-who="agent"
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-xs border border-edge-strong bg-sunken text-fg-2',
          className,
        )}
        style={{ width: size, height: size }}
      >
        <AgentIcon size={icon} />
      </span>
    );
  if (kind === 'automatic')
    return (
      <span
        aria-hidden
        data-who="automatic"
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full border border-edge-strong bg-sunken text-fg-2',
          className,
        )}
        style={{ width: size, height: size }}
      >
        <AutomaticIcon size={icon} />
      </span>
    );
  return (
    <span
      aria-hidden
      data-who="you"
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-fg text-panel', className)}
      style={{ width: size, height: size }}
    >
      <PersonIcon size={icon} />
    </span>
  );
}

/** The name shown for a who ("You", "DEMIURGO", "Agent · claude-code", "Automatic"). */
export function whoName(who: WhoValue): string {
  if (who.kind === 'agent') return `Agent · ${who.name}`;
  return who.name;
}

/**
 * Avatar + name. `actor` is an actor string ("human:ana", "agent:run:…") or object; `model` names
 * DEMIURGO's engine when known. The phrase of the kind is the element's title for pointer users;
 * the name itself carries the meaning.
 */
export function Who({
  actor,
  model,
  size = 20,
  showName = true,
  className,
  prefix,
}: {
  actor: string | Actor;
  model?: string | null;
  size?: number;
  showName?: boolean;
  className?: string;
  /** Words before the name ("Proposed by"). */
  prefix?: string;
}) {
  const who = whoOf(actor, model);
  const name = whoName(who);
  const detail = who.kind === 'demiurgo' && who.detail ? ` · ${who.detail}` : '';
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)} title={`${name} · ${WHO_PHRASES[who.kind]}`}>
      <WhoAvatar kind={who.kind} size={size} />
      {showName ? (
        <span className="truncate">
          {prefix ? `${prefix} ` : ''}
          {name}
          {detail ? <span className="text-fg-3">{detail}</span> : null}
        </span>
      ) : (
        <span className="sr-only">{name}</span>
      )}
    </span>
  );
}
