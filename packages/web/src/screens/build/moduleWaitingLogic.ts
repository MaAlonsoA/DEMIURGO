// Groups the queue's «waits because both change X» entries by what blocks them (item, blocking task). Pure.

import type { BuildQueue } from '../../api/types.ts';

export type ModuleWaitingEntry = NonNullable<NonNullable<BuildQueue['auto']>['module_waiting']>[number];
export type ModuleKind = ModuleWaitingEntry['kind'];

export type ModuleWaitingGroup = {
  item: string;
  kind: ModuleKind;
  hotspot?: { tasks: number; of: number };
  /** The task being built that holds the item. */
  with: string;
  source: ModuleWaitingEntry['with_source'];
  /** The ready tasks that wait for it, in queue order, once each. */
  waiting: string[];
};

export function groupModuleWaiting(entries: readonly ModuleWaitingEntry[]): ModuleWaitingGroup[] {
  const groups = new Map<string, ModuleWaitingGroup>();
  for (const e of entries) {
    const key = `${e.item}\u0000${e.with}`;
    const g = groups.get(key);
    if (g) {
      if (!g.waiting.includes(e.code)) g.waiting.push(e.code);
    } else {
      groups.set(key, { item: e.item, kind: e.kind, ...(e.hotspot ? { hotspot: e.hotspot } : {}), with: e.with, source: e.with_source, waiting: [e.code] });
    }
  }
  return [...groups.values()];
}

/** The kinds present, in first-seen order, for the heading. */
export function kindsOf(groups: readonly ModuleWaitingGroup[]): ModuleKind[] {
  return [...new Set(groups.map((g) => g.kind))];
}

/** The item without its kind prefix: `table:strength_sets` shows as `strength_sets`; a file path stays. */
export const itemLabel = (item: string): string => item.replace(/^(table|route|page|server_action):/, '');
