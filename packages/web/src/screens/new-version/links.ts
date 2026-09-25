// Links written by hand, born with their version (links are never added to a version that already
// exists): the types a person chooses, the records a link can point to (their current version, or
// the latest when none is approved yet), and the list the person builds.

import type { ProductRow } from '../../api/types.ts';
import type { LinkInput } from './form.ts';

/** What a person links by hand. "Comes from" and "Derived from" are set by DEMIURGO itself. */
export const MANUAL_LINK_TYPES = ['based_on', 'design_of', 'covers', 'conflicts_with'] as const;

export type LinkTarget = { code: string; version: number; title: string; type: ProductRow['type'] };

/** The records a link can point to, by code, except the record being written. */
export function linkTargets(
  state: { designs: readonly ProductRow[]; decisions: readonly ProductRow[] } | undefined,
  except?: string,
): LinkTarget[] {
  return [...(state?.designs ?? []), ...(state?.decisions ?? [])]
    .filter((r) => r.code !== except)
    .map((r) => ({ code: r.code, version: r.current ?? r.latest.n, title: r.title, type: r.type }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

const same = (a: LinkInput, b: LinkInput) => a.type === b.type && a.target.code === b.target.code;

export function addLink(links: readonly LinkInput[], link: LinkInput): LinkInput[] {
  return links.some((l) => same(l, link)) ? [...links] : [...links, link];
}

export function removeLink(links: readonly LinkInput[], link: LinkInput): LinkInput[] {
  return links.filter((l) => !same(l, link));
}

/** The links of a new version: the ones it carries, where a link the person adds takes the place of the same one. */
export function mergeLinks(carried: readonly LinkInput[], added: readonly LinkInput[]): LinkInput[] {
  return [...carried.filter((c) => !added.some((a) => same(a, c))), ...added];
}
