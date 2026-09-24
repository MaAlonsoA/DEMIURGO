// Esquemas de las tablas de datos (`design/datos/*.yaml`) y sus reglas de coherencia.
// Las reglas implementan I1 y I3 sobre los datos: un estado de autoridad solo lo alcanza
// un comando decisivo y un comando decisivo solo lo ejecuta una persona.

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
 * Invariantes fijadas en código, no en los datos: editar las tablas no puede relajarlas.
 * Estados que solo alcanza una persona (I1) y lo único que pueden hacer los agentes (I2).
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

/** Comandos que puede ejecutar cada tipo de agente: conversar, registrar fuentes y proponer. */
export const ALLOWED_AGENT_COMMANDS: Readonly<Record<'agent_external' | 'agent_run', readonly string[]>> = {
  agent_external: ['message.post', 'source.register', 'batch.submit', 'proposal.create'],
  agent_run: ['message.post', 'batch.submit', 'proposal.create'],
};

/** Consultas que un agente externo nunca puede usar. */
export const QUERIES_FORBIDDEN_TO_AGENTS: readonly string[] = ['query.projects', 'query.tokens'];

/** Incoherencias entre ambas tablas y con las invariantes fijadas en código. Vacía si todo cuadra. */
export function tableInconsistencies(cap: CapabilitiesTable, trans: TransitionsTable): string[] {
  return [...structuralInconsistencies(cap, trans), ...invariantInconsistencies(cap, trans)];
}

/** Invariantes fijadas en código (I1 e I2) que los datos no pueden relajar. */
export function invariantInconsistencies(cap: CapabilitiesTable, trans: TransitionsTable): string[] {
  const errors: string[] = [];
  for (const [entity, states] of Object.entries(MINIMUM_AUTHORITY_STATES)) {
    for (const e of states) {
      if (!trans.entities[entity]?.authority.includes(e))
        errors.push(`${entity}: «${e}» debe ser un estado de autoridad (I1).`);
    }
  }
  for (const [name, c] of Object.entries(cap.commands)) {
    for (const type of ['agent_external', 'agent_run'] as const) {
      if (c.allowed.includes(type) && !ALLOWED_AGENT_COMMANDS[type].includes(name)) {
        errors.push(`${name}: un ${type} solo puede conversar, registrar fuentes y proponer (I2).`);
      }
    }
  }
  for (const q of QUERIES_FORBIDDEN_TO_AGENTS) {
    if (cap.queries[q]?.allowed.includes('agent_external')) errors.push(`${q}: vedada a los agentes externos.`);
  }
  return errors;
}

/** Coherencia interna de los datos: comandos, estados, alcanzabilidad y decisivos. */
export function structuralInconsistencies(cap: CapabilitiesTable, trans: TransitionsTable): string[] {
  const errors: string[] = [];
  const used = new Set<string>();
  for (const [entity, def] of Object.entries(trans.entities)) {
    const states = new Set(Object.keys(def.states));
    for (const a of def.authority) {
      if (!states.has(a)) errors.push(`${entity}: el estado de autoridad «${a}» no existe.`);
    }
    const keys = new Set<string>();
    const reachable = new Set<string>();
    for (const t of def.transitions) {
      used.add(t.command);
      const c = cap.commands[t.command];
      if (!c) {
        errors.push(`${entity}: el comando «${t.command}» no está en la matriz de capacidades.`);
        continue;
      }
      if (c.entity !== entity) errors.push(`${t.command}: la matriz lo asigna a «${c.entity}», no a «${entity}».`);
      if (!states.has(t.to)) errors.push(`${entity}: «${t.command}» lleva a un estado inexistente «${t.to}».`);
      const origins = t.from === 'new' ? ['new'] : t.from;
      for (const o of origins) {
        if (o !== 'new' && !states.has(o)) errors.push(`${entity}: «${t.command}» sale de un estado inexistente «${o}».`);
        const key = `${o}|${t.command}`;
        if (keys.has(key)) errors.push(`${entity}: la transición «${t.command}» desde «${o}» está duplicada.`);
        keys.add(key);
      }
      if (def.authority.includes(t.to)) {
        if (!c.decisive) errors.push(`${t.command}: alcanza el estado de autoridad «${t.to}» y debe ser decisivo.`);
      }
    }
    // Estados alcanzables desde «nuevo».
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
      if (!reachable.has(e)) errors.push(`${entity}: el estado «${e}» no es alcanzable.`);
    }
  }
  for (const [name, c] of Object.entries(cap.commands)) {
    if (!used.has(name)) errors.push(`${name}: el comando no aparece en ninguna transición.`);
    if (!trans.entities[c.entity]) errors.push(`${name}: la entidad «${c.entity}» no tiene tabla de transiciones.`);
    if (c.decisive && (c.allowed.length !== 1 || c.allowed[0] !== 'human')) {
      errors.push(`${name}: un comando decisivo solo puede estar permitido a «human».`);
    }
    if (c.decisive) {
      const def = trans.entities[c.entity];
      const reachesAuthority = def?.transitions.some((t) => t.command === name && def.authority.includes(t.to));
      if (!reachesAuthority) errors.push(`${name}: es decisivo pero no alcanza ningún estado de autoridad.`);
    }
  }
  return errors;
}
