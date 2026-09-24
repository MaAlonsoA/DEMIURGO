// Reactions to authority events (approving a version, accepting a proposal, approving
// the taxonomy). S2 registers here the enqueuing of "Update knowledge" (§7.3).

import type { CommandContext } from '../bus/types.ts';

export type AuthorityObject = { type: string; id: string; version: number | null };

/** Discarding a draft: withdraws from knowledge what it had projected (not authority, but it changes it). */
export const DISCARD_TRIGGER = 'record_version_discard';
export type Reaction = (ctx: CommandContext, object: AuthorityObject) => Promise<void>;

const REACTIONS: Reaction[] = [];

export function registerAuthorityReaction(r: Reaction): void {
  REACTIONS.push(r);
}

/** Called within the decisive command's transaction, after applying its effect. */
export async function onAuthorityEvent(ctx: CommandContext, object: AuthorityObject): Promise<void> {
  for (const r of REACTIONS) await r(ctx, object);
}
