// Reacciones a los eventos de autoridad (aprobar una versión, aceptar una propuesta, aprobar
// la taxonomía). S2 registra aquí el encolado de «Actualizar conocimiento» (§7.3).

import type { CommandContext } from '../bus/types.ts';

export type AuthorityObject = { type: string; id: string; version: number | null };

/** Descartar un borrador: retira del conocimiento lo que había proyectado (no es autoridad, pero la cambia). */
export const DISCARD_TRIGGER = 'record_version_discard';
export type Reaction = (ctx: CommandContext, object: AuthorityObject) => Promise<void>;

const REACTIONS: Reaction[] = [];

export function registerAuthorityReaction(r: Reaction): void {
  REACTIONS.push(r);
}

/** Se llama dentro de la transacción del comando decisivo, después de aplicar su efecto. */
export async function onAuthorityEvent(ctx: CommandContext, object: AuthorityObject): Promise<void> {
  for (const r of REACTIONS) await r(ctx, object);
}
