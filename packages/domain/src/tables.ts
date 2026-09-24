// Acceso tipado a las tablas generadas desde design/datos/.

import type { ActorTypeWithUnknown } from './actors.ts';
import { CAPABILITIES, TRANSITIONS } from './generated/tables.ts';

export { CAPABILITIES, TRANSITIONS };

export type CommandName = keyof typeof CAPABILITIES.commands;
export type QueryName = keyof typeof CAPABILITIES.queries;
export type EntityName = keyof typeof TRANSITIONS.entities;

type CommandDef = { entity: string; allowed: readonly string[]; decisive: boolean; description: string };
type TransitionDef = { command: string; from: 'new' | readonly string[]; to: string; guards?: readonly string[] };
type EntityDef = {
  label: string;
  implemented_in: string;
  states: Readonly<Record<string, string>>;
  authority: readonly string[];
  transitions: readonly TransitionDef[];
};

const commands = CAPABILITIES.commands as Readonly<Record<string, CommandDef>>;
const queries = CAPABILITIES.queries as Readonly<Record<string, { allowed: readonly string[]; description: string }>>;
const entities = TRANSITIONS.entities as Readonly<Record<string, EntityDef>>;

export const COMMAND_NAMES = Object.keys(commands) as CommandName[];
export const QUERY_NAMES = Object.keys(queries) as QueryName[];
export const ENTITY_NAMES = Object.keys(entities) as EntityName[];

export function isCommand(name: string): name is CommandName {
  return Object.hasOwn(commands, name);
}

export function commandDefinition(c: CommandName): CommandDef {
  return commands[c] as CommandDef;
}

export function entityDefinition(e: EntityName): EntityDef {
  return entities[e] as EntityDef;
}

export function entityOf(c: CommandName): EntityName {
  return commandDefinition(c).entity as EntityName;
}

export function allowedForCommand(c: CommandName, type: ActorTypeWithUnknown): boolean {
  return type !== 'unknown' && commandDefinition(c).allowed.includes(type);
}

/**
 * Invariante en código (I10): el componente de sistema del conocimiento solo escribe
 * conocimiento derivado, clasificaciones, evaluaciones de ideas y propuestas. Aunque la matriz
 * permita un comando a `system`, este componente no puede ejecutar otro (no se relaja editando
 * los datos).
 */
export const COMMANDS_BY_COMPONENT: Readonly<Record<string, readonly string[]>> = {
  knowledge: [
    'knowledge_update.enqueue',
    'knowledge_update.classify',
    'knowledge_update.verify',
    'knowledge_update.apply',
    'knowledge_update.reject',
    'knowledge_node.project',
    'knowledge_node.invalidate',
    'knowledge_edge.project',
    'knowledge_edge.invalidate',
    'classification.record',
    'classification.hold',
    'idea_assessment.record',
    'batch.submit',
    'proposal.create',
  ],
};

/** Si el actor es un componente de sistema con lista cerrada, ¿puede ejecutar el comando? */
export function allowedForComponent(c: CommandName, actor: { type: string; component?: string }): boolean {
  if (actor.type !== 'system' || !actor.component) return true;
  const list = COMMANDS_BY_COMPONENT[actor.component];
  return !list || list.includes(c);
}

export function allowedForQuery(q: QueryName, type: ActorTypeWithUnknown): boolean {
  return type !== 'unknown' && (queries[q]?.allowed.includes(type) ?? false);
}

export function isDecisive(c: CommandName): boolean {
  return commandDefinition(c).decisive;
}

export function isCreation(c: CommandName): boolean {
  const def = entityDefinition(entityOf(c));
  return def.transitions.some((t) => t.command === c && t.from === 'new');
}

export type Transition = { to: string; guards: readonly string[] };

/** Busca la transición (entidad, estado, comando). `estado` null significa «nuevo». */
export function findTransition(entity: EntityName, state: string | null, command: CommandName): Transition | null {
  for (const t of entityDefinition(entity).transitions) {
    if (t.command !== command) continue;
    const matches = state === null ? t.from === 'new' : t.from !== 'new' && t.from.includes(state);
    if (matches) return { to: t.to, guards: t.guards ?? [] };
  }
  return null;
}

export function stateLabel(entity: EntityName, state: string): string {
  return entityDefinition(entity).states[state] ?? state;
}

export function entityLabel(entity: EntityName): string {
  return entityDefinition(entity).label;
}

export function isAuthorityState(entity: EntityName, state: string): boolean {
  return entityDefinition(entity).authority.includes(state);
}

/** Incrementos en orden, para saber qué entidades están implementadas. */
const INCREMENT_ORDER = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];

export function implementedIn(entity: EntityName, currentIncrement: string): boolean {
  return INCREMENT_ORDER.indexOf(entityDefinition(entity).implemented_in) <= INCREMENT_ORDER.indexOf(currentIncrement);
}

export function allGuards(): string[] {
  const s = new Set<string>();
  for (const e of Object.values(entities)) for (const t of e.transitions) for (const g of t.guards ?? []) s.add(g);
  return [...s].sort();
}
