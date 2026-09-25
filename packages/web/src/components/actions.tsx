// Buttons according to the tables (AC-WEB-001-02): a button exists only if the tables allow a
// person that command from the entity's current state and the screen knows how to run it. The UI
// never decides what is allowed — it only puts the allowed commands into words.

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { commandsQuery, tablesQuery } from '../api/queries.ts';
import { type Action, actionsFor } from '../api/tables.ts';
import { cn } from '../lib/cn.ts';
import { commandWord } from '../words.ts';
import { Button, type ButtonSize, type ButtonVariant } from './Button.tsx';

export type ActionHandler = {
  run: (action: Action) => void;
  label?: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Why it is disabled or what it does, as the button's title. */
  hint?: string;
  pending?: boolean;
  pendingLabel?: string;
  icon?: ReactNode;
  /** The command it runs when the key is not one (a second button for the same command). */
  command?: string;
};

/** Allowed actions of an entity in a state, for a person. Empty while the tables load. */
export function useActions(entity: string, state: string | undefined): Action[] {
  const tables = useQuery(tablesQuery).data;
  const catalog = useQuery(commandsQuery).data;
  if (!tables || !state) return [];
  return actionsFor(tables, catalog, entity, state);
}

export function useAllows(entity: string, state: string | undefined): (command: string) => boolean {
  const actions = useActions(entity, state);
  return (command) => actions.some((a) => a.command === command);
}

/** Pure part: one button per allowed action that has a handler, in the handlers' order. */
export function ActionButtons({
  actions,
  handlers,
  className,
  children,
  size = 'md',
}: {
  actions: Action[];
  handlers: Record<string, ActionHandler | undefined>;
  className?: string;
  children?: ReactNode;
  size?: ButtonSize;
}) {
  const allowed = new Map(actions.map((a) => [a.command, a]));
  const buttons = Object.entries(handlers).flatMap(([key, h]) => {
    const command = h?.command ?? key;
    const action = allowed.get(command);
    if (!action || !h) return [];
    return [
      <Button
        key={key}
        size={size}
        variant={h.variant ?? (action.decisive ? 'primary' : 'secondary')}
        disabled={h.disabled}
        pending={h.pending}
        {...(h.pendingLabel ? { pendingLabel: h.pendingLabel } : {})}
        {...(h.icon ? { icon: h.icon } : {})}
        title={h.hint}
        data-command={command}
        onClick={() => h.run(action)}
      >
        {h.label ?? commandWord(command)}
      </Button>,
    ];
  });
  if (buttons.length === 0 && !children) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {buttons}
      {children}
    </div>
  );
}

/** Connected part: reads the tables and shows the allowed actions of the entity in its state. */
export function ActionBar({
  entity,
  state,
  handlers,
  className,
  children,
  size,
}: {
  entity: string;
  state: string;
  handlers: Record<string, ActionHandler | undefined>;
  className?: string;
  children?: ReactNode;
  size?: ButtonSize;
}) {
  const actions = useActions(entity, state);
  return (
    <ActionButtons actions={actions} handlers={handlers} {...(className ? { className } : {})} {...(size ? { size } : {})}>
      {children}
    </ActionButtons>
  );
}
