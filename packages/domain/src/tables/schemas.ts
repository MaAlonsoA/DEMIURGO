// Schemas for the data tables (`design/data/*.yaml`) and their consistency rules.
// The rules implement I1 and I3 on the data: an authority state is only reached by
// a decisive command, and a decisive command is only run by a person.

import { z } from 'zod';

export const ACTOR_TYPES = ['human', 'agent_external', 'agent_run', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

const documentStatus = z.enum(['proposed', 'approved', 'superseded', 'discarded']);
const RE_COMMAND = /^[a-z_]+\.[a-z_]+$/;

export const capabilitiesSchema = z
  .object({
    code: z.literal('DAT-CAP-001'),
    version: z.number().int().positive(),
    state: documentStatus,
    actors: z.object({
      human: z.string(),
      agent_external: z.string(),
      agent_run: z.string(),
      system: z.string(),
    }),
    commands: z.record(
      z.string().regex(RE_COMMAND),
      z
        .object({
          entity: z.string().regex(/^[a-z_]+$/),
          allowed: z.array(z.enum(ACTOR_TYPES)).min(1),
          decisive: z.boolean(),
          description: z.string().min(1),
        })
        .strict(),
    ),
    queries: z.record(
      z.string().regex(/^query\.[a-z_]+$/),
      z.object({ allowed: z.array(z.enum(ACTOR_TYPES)).min(1), description: z.string().min(1) }).strict(),
    ),
  })
  .strict();

export const transitionsSchema = z
  .object({
    code: z.literal('DAT-TRA-001'),
    version: z.number().int().positive(),
    state: documentStatus,
    entities: z.record(
      z.string().regex(/^[a-z_]+$/),
      z
        .object({
          label: z.string().min(1),
          implemented_in: z.string().regex(/^S\d+$/),
          states: z.record(z.string().regex(/^[a-z_]+$/), z.string().min(1)),
          authority: z.array(z.string()),
          transitions: z
            .array(
              z
                .object({
                  command: z.string().regex(RE_COMMAND),
                  from: z.union([z.literal('new'), z.array(z.string()).min(1)]),
                  to: z.string(),
                  guards: z.array(z.string().regex(/^[a-z_0-9]+$/)).optional(),
                })
                .strict(),
            )
            .min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type CapabilitiesTable = z.infer<typeof capabilitiesSchema>;
export type TransitionsTable = z.infer<typeof transitionsSchema>;

/**
 * Invariants fixed in code, not in the data: editing the tables cannot relax them.
 * States only a person can reach (I1) and the only things agents can do (I2).
 */
export const MINIMUM_AUTHORITY_STATES: Readonly<Record<string, readonly string[]>> = {
  question: ['confirmed'],
  record_version: ['approved'],
  taxonomy: ['approved'],
  proposal: ['accepted', 'accepted_edited'],
  batch: ['accepted'],
  change_set: ['scope_accepted', 'accepted'],
  acceptance_check: ['mapped'],
};

/** Commands each agent type can run: converse, register sources and propose. */
export const ALLOWED_AGENT_COMMANDS: Readonly<Record<'agent_external' | 'agent_run', readonly string[]>> = {
  agent_external: ['message.post', 'source.register', 'batch.submit', 'proposal.create'],
  agent_run: ['message.post', 'batch.submit', 'proposal.create'],
};

/** Queries an external agent can never use. */
export const QUERIES_FORBIDDEN_TO_AGENTS: readonly string[] = ['query.projects', 'query.tokens'];

/** Inconsistencies between the two tables and with the invariants fixed in code. Empty if everything checks out. */
export function tableInconsistencies(cap: CapabilitiesTable, trans: TransitionsTable): string[] {
  return [...structuralInconsistencies(cap, trans), ...invariantInconsistencies(cap, trans)];
}

/** Invariants fixed in code (I1 and I2) that the data cannot relax. */
export function invariantInconsistencies(cap: CapabilitiesTable, trans: TransitionsTable): string[] {
  const errors: string[] = [];
  for (const [entity, states] of Object.entries(MINIMUM_AUTHORITY_STATES)) {
    for (const e of states) {
      if (!trans.entities[entity]?.authority.includes(e)) errors.push(`${entity}: "${e}" must be an authority state (I1).`);
    }
  }
  for (const [name, c] of Object.entries(cap.commands)) {
    for (const type of ['agent_external', 'agent_run'] as const) {
      if (c.allowed.includes(type) && !ALLOWED_AGENT_COMMANDS[type].includes(name)) {
        errors.push(`${name}: a ${type} can only converse, register sources and propose (I2).`);
      }
    }
  }
  for (const q of QUERIES_FORBIDDEN_TO_AGENTS) {
    if (cap.queries[q]?.allowed.includes('agent_external')) errors.push(`${q}: forbidden to external agents.`);
  }
  return errors;
}

/** Internal consistency of the data: commands, states, reachability and decisiveness. */
export function structuralInconsistencies(cap: CapabilitiesTable, trans: TransitionsTable): string[] {
  const errors: string[] = [];
  const used = new Set<string>();
  for (const [entity, def] of Object.entries(trans.entities)) {
    const states = new Set(Object.keys(def.states));
    for (const a of def.authority) {
      if (!states.has(a)) errors.push(`${entity}: authority state "${a}" does not exist.`);
    }
    const keys = new Set<string>();
    const reachable = new Set<string>();
    for (const t of def.transitions) {
      used.add(t.command);
      const c = cap.commands[t.command];
      if (!c) {
        errors.push(`${entity}: command "${t.command}" is not in the capabilities matrix.`);
        continue;
      }
      if (c.entity !== entity) errors.push(`${t.command}: the matrix assigns it to "${c.entity}", not to "${entity}".`);
      if (!states.has(t.to)) errors.push(`${entity}: "${t.command}" leads to a nonexistent state "${t.to}".`);
      const origins = t.from === 'new' ? ['new'] : t.from;
      for (const o of origins) {
        if (o !== 'new' && !states.has(o)) errors.push(`${entity}: "${t.command}" leaves from a nonexistent state "${o}".`);
        const key = `${o}|${t.command}`;
        if (keys.has(key)) errors.push(`${entity}: transition "${t.command}" from "${o}" is duplicated.`);
        keys.add(key);
      }
      if (def.authority.includes(t.to)) {
        if (!c.decisive) errors.push(`${t.command}: reaches authority state "${t.to}" and must be decisive.`);
      }
    }
    // States reachable from "new".
    let change = true;
    reachable.add('new');
    while (change) {
      change = false;
      for (const t of def.transitions) {
        const origins = t.from === 'new' ? ['new'] : t.from;
        if (origins.some((o) => reachable.has(o)) && !reachable.has(t.to)) {
          reachable.add(t.to);
          change = true;
        }
      }
    }
    for (const e of states) {
      if (!reachable.has(e)) errors.push(`${entity}: state "${e}" is not reachable.`);
    }
  }
  for (const [name, c] of Object.entries(cap.commands)) {
    if (!used.has(name)) errors.push(`${name}: command does not appear in any transition.`);
    if (!trans.entities[c.entity]) errors.push(`${name}: entity "${c.entity}" has no transitions table.`);
    if (c.decisive && (c.allowed.length !== 1 || c.allowed[0] !== 'human')) {
      errors.push(`${name}: a decisive command can only be allowed for "human".`);
    }
    if (c.decisive) {
      const def = trans.entities[c.entity];
      const reachesAuthority = def?.transitions.some((t) => t.command === name && def.authority.includes(t.to));
      if (!reachesAuthority) errors.push(`${name}: is decisive but does not reach any authority state.`);
    }
  }
  return errors;
}
