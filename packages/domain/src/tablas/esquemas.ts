// Esquemas de las tablas de datos (`design/datos/*.yaml`) y sus reglas de coherencia.
// Las reglas implementan I1 y I3 sobre los datos: un estado de autoridad solo lo alcanza
// un comando decisivo y un comando decisivo solo lo ejecuta una persona.

import { z } from 'zod';

export const TIPOS_ACTOR = ['human', 'agent_external', 'agent_run', 'system'] as const;
export type TipoActor = (typeof TIPOS_ACTOR)[number];

const estadoDocumento = z.enum(['propuesto', 'aprobado', 'sustituido', 'descartado']);
const RE_COMANDO = /^[a-z_]+\.[a-z_]+$/;

export const esquemaCapacidades = z
  .object({
    codigo: z.literal('DAT-CAP-001'),
    version: z.number().int().positive(),
    estado: estadoDocumento,
    actores: z.object({
      human: z.string(),
      agent_external: z.string(),
      agent_run: z.string(),
      system: z.string(),
    }),
    comandos: z.record(
      z.string().regex(RE_COMANDO),
      z
        .object({
          entidad: z.string().regex(/^[a-z_]+$/),
          permitido: z.array(z.enum(TIPOS_ACTOR)).min(1),
          decisivo: z.boolean(),
          descripcion: z.string().min(1),
        })
        .strict(),
    ),
    consultas: z.record(
      z.string().regex(/^query\.[a-z_]+$/),
      z.object({ permitido: z.array(z.enum(TIPOS_ACTOR)).min(1), descripcion: z.string().min(1) }).strict(),
    ),
  })
  .strict();

export const esquemaTransiciones = z
  .object({
    codigo: z.literal('DAT-TRA-001'),
    version: z.number().int().positive(),
    estado: estadoDocumento,
    entidades: z.record(
      z.string().regex(/^[a-z_]+$/),
      z
        .object({
          etiqueta: z.string().min(1),
          implementado_en: z.string().regex(/^S\d+$/),
          estados: z.record(z.string().regex(/^[a-z_]+$/), z.string().min(1)),
          autoridad: z.array(z.string()),
          transiciones: z
            .array(
              z
                .object({
                  comando: z.string().regex(RE_COMANDO),
                  desde: z.union([z.literal('nuevo'), z.array(z.string()).min(1)]),
                  hacia: z.string(),
                  guardas: z.array(z.string().regex(/^[a-z_0-9]+$/)).optional(),
                })
                .strict(),
            )
            .min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type TablaCapacidades = z.infer<typeof esquemaCapacidades>;
export type TablaTransiciones = z.infer<typeof esquemaTransiciones>;

/**
 * Invariantes fijadas en código, no en los datos: editar las tablas no puede relajarlas.
 * Estados que solo alcanza una persona (I1) y lo único que pueden hacer los agentes (I2).
 */
export const ESTADOS_DE_AUTORIDAD_MINIMOS: Readonly<Record<string, readonly string[]>> = {
  question: ['confirmed'],
  record_version: ['approved'],
  taxonomy: ['approved'],
  proposal: ['accepted', 'accepted_edited'],
  batch: ['accepted'],
  change_set: ['scope_accepted', 'accepted'],
  acceptance_check: ['mapped'],
};

/** Comandos que puede ejecutar cada tipo de agente: conversar, registrar fuentes y proponer. */
export const COMANDOS_PERMITIDOS_A_AGENTES: Readonly<Record<'agent_external' | 'agent_run', readonly string[]>> = {
  agent_external: ['message.post', 'source.register', 'batch.submit', 'proposal.create'],
  agent_run: ['message.post', 'batch.submit', 'proposal.create'],
};

/** Consultas que un agente externo nunca puede usar. */
export const CONSULTAS_VEDADAS_A_AGENTES: readonly string[] = ['query.projects', 'query.tokens'];

/** Devuelve la lista de incoherencias entre ambas tablas, en español. Vacía si son coherentes. */
export function incoherenciasTablas(cap: TablaCapacidades, tra: TablaTransiciones): string[] {
  const errores: string[] = [];
  for (const [entidad, estados] of Object.entries(ESTADOS_DE_AUTORIDAD_MINIMOS)) {
    for (const e of estados) {
      if (!tra.entidades[entidad]?.autoridad.includes(e))
        errores.push(`${entidad}: «${e}» debe ser un estado de autoridad (I1).`);
    }
  }
  for (const [nombre, c] of Object.entries(cap.comandos)) {
    for (const tipo of ['agent_external', 'agent_run'] as const) {
      if (c.permitido.includes(tipo) && !COMANDOS_PERMITIDOS_A_AGENTES[tipo].includes(nombre)) {
        errores.push(`${nombre}: un ${tipo} solo puede conversar, registrar fuentes y proponer (I2).`);
      }
    }
  }
  for (const q of CONSULTAS_VEDADAS_A_AGENTES) {
    if (cap.consultas[q]?.permitido.includes('agent_external')) errores.push(`${q}: vedada a los agentes externos.`);
  }
  const usados = new Set<string>();
  for (const [entidad, def] of Object.entries(tra.entidades)) {
    const estados = new Set(Object.keys(def.estados));
    for (const a of def.autoridad) {
      if (!estados.has(a)) errores.push(`${entidad}: el estado de autoridad «${a}» no existe.`);
    }
    const claves = new Set<string>();
    const alcanzables = new Set<string>();
    for (const t of def.transiciones) {
      usados.add(t.comando);
      const c = cap.comandos[t.comando];
      if (!c) {
        errores.push(`${entidad}: el comando «${t.comando}» no está en la matriz de capacidades.`);
        continue;
      }
      if (c.entidad !== entidad) errores.push(`${t.comando}: la matriz lo asigna a «${c.entidad}», no a «${entidad}».`);
      if (!estados.has(t.hacia)) errores.push(`${entidad}: «${t.comando}» lleva a un estado inexistente «${t.hacia}».`);
      const origenes = t.desde === 'nuevo' ? ['nuevo'] : t.desde;
      for (const o of origenes) {
        if (o !== 'nuevo' && !estados.has(o)) errores.push(`${entidad}: «${t.comando}» sale de un estado inexistente «${o}».`);
        const clave = `${o}|${t.comando}`;
        if (claves.has(clave)) errores.push(`${entidad}: la transición «${t.comando}» desde «${o}» está duplicada.`);
        claves.add(clave);
      }
      if (def.autoridad.includes(t.hacia)) {
        if (!c.decisivo) errores.push(`${t.comando}: alcanza el estado de autoridad «${t.hacia}» y debe ser decisivo.`);
      }
    }
    // Estados alcanzables desde «nuevo».
    let cambio = true;
    alcanzables.add('nuevo');
    while (cambio) {
      cambio = false;
      for (const t of def.transiciones) {
        const origenes = t.desde === 'nuevo' ? ['nuevo'] : t.desde;
        if (origenes.some((o) => alcanzables.has(o)) && !alcanzables.has(t.hacia)) {
          alcanzables.add(t.hacia);
          cambio = true;
        }
      }
    }
    for (const e of estados) {
      if (!alcanzables.has(e)) errores.push(`${entidad}: el estado «${e}» no es alcanzable.`);
    }
  }
  for (const [nombre, c] of Object.entries(cap.comandos)) {
    if (!usados.has(nombre)) errores.push(`${nombre}: el comando no aparece en ninguna transición.`);
    if (!tra.entidades[c.entidad]) errores.push(`${nombre}: la entidad «${c.entidad}» no tiene tabla de transiciones.`);
    if (c.decisivo && (c.permitido.length !== 1 || c.permitido[0] !== 'human')) {
      errores.push(`${nombre}: un comando decisivo solo puede estar permitido a «human».`);
    }
    if (c.decisivo) {
      const def = tra.entidades[c.entidad];
      const alcanzaAutoridad = def?.transiciones.some((t) => t.comando === nombre && def.autoridad.includes(t.hacia));
      if (!alcanzaAutoridad) errores.push(`${nombre}: es decisivo pero no alcanza ningún estado de autoridad.`);
    }
  }
  return errores;
}
