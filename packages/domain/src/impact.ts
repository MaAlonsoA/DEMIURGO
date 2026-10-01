// Deterministic impact of a change: «suspect links», the requirements-traceability practice where a
// change to an upstream item flags the items downstream of it for review (IBM DOORS and Jama call
// them «suspect links»). Nothing is stored or guessed: a record is suspect when its current version
// is based on an older version of another record than that record's current one, until the person
// says it still holds (the link is then checked against the newer version).

/** The link types that say «this rests on that»: a change upstream puts what follows under suspicion. */
export const SUSPECT_LINK_TYPES: readonly string[] = ['based_on', 'design_of'];

export type Suspect = { upstream: string; from: number; to: number };

export type ImpactLink = {
  type: string;
  /** The record the link goes out of, and the version it leaves from. */
  from: { code: string; n: number };
  /** The record it points to, and the version it points to. */
  to: { code: string; n: number };
  /** The upstream version the person last confirmed this link against («Still valid»), if any. */
  checkedAgainst?: number | null;
};

/**
 * `current`: the current (last approved) version of each record by code. A link is suspect when the
 * downstream version it leaves from is itself the current one, and the upstream record has a newer
 * current version than the one it points to, and nobody confirmed it against that newer version.
 */
export function suspectOf(link: ImpactLink, current: ReadonlyMap<string, number>): Suspect | null {
  if (!SUSPECT_LINK_TYPES.includes(link.type)) return null;
  if (current.get(link.from.code) !== link.from.n) return null;
  const now = current.get(link.to.code);
  if (now === undefined || now <= link.to.n) return null;
  if ((link.checkedAgainst ?? 0) >= now) return null;
  return { upstream: link.to.code, from: link.to.n, to: now };
}

/** The links that are suspect, each with its `suspect`. */
export function suspectLinks<L extends ImpactLink>(
  links: readonly L[],
  current: ReadonlyMap<string, number>,
): (L & { suspect: Suspect })[] {
  const out: (L & { suspect: Suspect })[] = [];
  for (const l of links) {
    const suspect = suspectOf(l, current);
    if (suspect) out.push({ ...l, suspect });
  }
  return out;
}

/** The sentence for a suspect record, in product language. */
export function suspectReason(s: Suspect): string {
  return `It is based on ${s.upstream} v${s.from}, which is now v${s.to}: review it against the change.`;
}
