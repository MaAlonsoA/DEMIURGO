// Context packs: inmutables e identificados por su hash (I7). Construir dos veces el mismo
// pack devuelve el existente sin crear otro.

import { huella } from '@demiurgo/domain';
import { z } from 'zod';
import { manejador, registrarManejadores } from '../bus/manejadores.ts';

export const esquemaPack = z
  .object({
    rol: z.string().min(1),
    constructor: z.string().min(1),
    presupuesto: z.record(z.string(), z.number().int().nonnegative()),
    version_grafo: z.number().int().nonnegative(),
    dependencias: z.array(z.object({ tipo: z.string(), id: z.string(), version: z.number().int().nullable() }).strict()),
    contenido: z.unknown(),
  })
  .strict();

export type DatosPack = z.infer<typeof esquemaPack>;

export function hashPack(p: DatosPack): string {
  return huella({
    rol: p.rol,
    constructor: p.constructor,
    presupuesto: p.presupuesto,
    version_grafo: p.version_grafo,
    dependencias: p.dependencias,
    contenido: p.contenido,
  });
}

registrarManejadores({
  'context_pack.build': manejador({
    datos: esquemaPack,
    async aplicar(ctx, datos, _e, hacia) {
      const hash = hashPack(datos);
      const previo = await ctx.trx
        .selectFrom('context_packs')
        .select('id')
        .where('project_id', '=', ctx.proyectoId)
        .where('hash', '=', hash)
        .executeTakeFirst();
      if (previo) return { entidadId: previo.id, sinCambios: true, resultado: { hash } };
      const { id } = await ctx.trx
        .insertInto('context_packs')
        .values({
          project_id: ctx.proyectoId,
          role: datos.rol,
          builder: datos.constructor,
          budget: JSON.stringify(datos.presupuesto),
          graph_version: datos.version_grafo,
          dependencies: JSON.stringify(datos.dependencias),
          content: JSON.stringify(datos.contenido ?? null),
          hash,
          state: hacia,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entidadId: id, despues: { rol: datos.rol, hash, version_grafo: datos.version_grafo }, resultado: { hash } };
    },
  }),
});
