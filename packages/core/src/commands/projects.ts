// Comandos de proyecto.

import { z } from 'zod';
import { manejador, registrarManejadores } from '../bus/manejadores.ts';

registrarManejadores({
  'project.create': manejador({
    datos: z.object({ nombre: z.string().trim().min(1).max(120) }).strict(),
    async aplicar(ctx, datos, _e, hacia) {
      const { id } = await ctx.trx
        .insertInto('projects')
        .values({ name: datos.nombre, state: hacia })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entidadId: id, proyectoId: id, despues: { nombre: datos.nombre } };
    },
  }),

  'project.archive': manejador({
    datos: z.object({ motivo: z.string().trim().max(500).optional() }).strict(),
    async aplicar(_ctx, datos, e) {
      return { entidadId: e?.id ?? '', despues: { motivo: datos.motivo ?? null } };
    },
  }),
});
