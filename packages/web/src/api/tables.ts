// Allowed actions come from the tables (GET /api/tables and GET /api/commands), never from the UI:
// an entity in a state offers the commands whose transition leaves that state and whose actor is
// allowed by the capability matrix (AC-WEB-001-02). The UI only puts them into words.

import type { ActorType, CommandCatalog, JsonSchema, Tables } from './types.ts';

export type Action = {
  command: string;
  to: string;
  decisive: boolean;
  description: string;
  schema: JsonSchema | null;
};

export function actionsFor(
  tables: Tables,
  catalog: CommandCatalog | undefined,
  entity: string,
  state: string,
  actor: ActorType = 'human',
): Action[] {
  const def = tables.transitions.entities[entity];
  if (!def) return [];
  const seen = new Set<string>();
  const actions: Action[] = [];
  for (const t of def.transitions) {
    if (t.from === 'new' || !t.from.includes(state) || seen.has(t.command)) continue;
    const c = tables.capabilities.commands[t.command];
    if (!c?.allowed.includes(actor)) continue;
    if (catalog && catalog[t.command]?.implemented === false) continue;
    seen.add(t.command);
    actions.push({
      command: t.command,
      to: t.to,
      decisive: c.decisive,
      description: c.description,
      schema: catalog?.[t.command]?.data ?? null,
    });
  }
  return actions;
}

/** Can the actor create an entity with this command (a transition from "new")? */
export function canCreate(tables: Tables, command: string, actor: ActorType = 'human'): boolean {
  const c = tables.capabilities.commands[command];
  if (!c?.allowed.includes(actor)) return false;
  return tables.transitions.entities[c.entity]?.transitions.some((t) => t.command === command && t.from === 'new') ?? false;
}

export function isDecisive(tables: Tables, command: string): boolean {
  return tables.capabilities.commands[command]?.decisive ?? false;
}

/** Label of a state as the tables give it (the default word, spec §6). */
export function stateLabel(tables: Tables | undefined, entity: string, state: string): string {
  return tables?.transitions.entities[entity]?.states[state] ?? state;
}
