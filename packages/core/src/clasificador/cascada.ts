// Cascada por confianza (§7.5 del plan): el clasificador base responde y lo que queda con
// confianza media lo revisa otro clasificador (normalmente un LLM mayor). Lo que siga sin
// confianza alta no se aplica solo: las categorías van a la persona y las relaciones quedan
// anotadas en la actualización. El id combina los dos, así que la caché por input_hash
// distingue la cascada del clasificador base y la reconstrucción la reproduce desde la caché.

import { type Clasificador, UMBRALES_POR_DEFECTO, type Umbrales, enrutarPorConfianza } from '@demiurgo/domain';

export function crearClasificadorEnCascada(
  base: Clasificador,
  revisor: Clasificador,
  umbrales: Umbrales = UMBRALES_POR_DEFECTO,
): Clasificador {
  return {
    id: `${base.id}>${revisor.id}`,
    async choice(items) {
      const respuestas = await base.choice(items);
      const medias = new Set(
        respuestas.filter((r) => enrutarPorConfianza(r.confianza, umbrales) === 'revisar_llm').map((r) => r.id),
      );
      if (medias.size === 0) return respuestas;
      const revisadas = new Map((await revisor.choice(items.filter((i) => medias.has(i.id)))).map((r) => [r.id, r]));
      return respuestas.map((r) => {
        const revisada = medias.has(r.id) ? revisadas.get(r.id) : undefined;
        return revisada ? { ...revisada, revisadoPor: revisor.id } : r;
      });
    },
    score: (items) => base.score(items),
    noul: (items) => base.noul(items),
  };
}
