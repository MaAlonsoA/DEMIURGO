// Every epic with its plan (its planned features, each with its state), from the product state: what
// the board, the Epics page and "Next step" read.

import type { ProductRow, ProductState } from '../../api/types.ts';
import type { EpicRef } from './DesignNext.tsx';
import { type EpicPlan, epicGroups, epicPlan, plannedOf } from './logic.ts';

export type EpicState = {
  epic: ProductRow;
  features: ProductRow[];
  plan: EpicPlan;
  /** What "Design the next one" needs: only for an approved epic. */
  ref: EpicRef | null;
  /** Its walk-through is checked and every feature of its list is built. */
  delivered: boolean;
};

/** What "Design the next one" needs of an epic: its current version; null while it is a draft. */
export function epicRef(epic: ProductRow): EpicRef | null {
  return epic.current_id
    ? { code: epic.code, title: epic.title, currentId: epic.current_id, versionIds: [epic.current_id, epic.latest_id] }
    : null;
}

export function epicPlans(state: ProductState): EpicState[] {
  const rows = [...state.designs, ...state.decisions];
  return epicGroups(rows).groups.map((g) => {
    const plan = epicPlan(g.epic, plannedOf(state, g.epic.code), g.features, rows, state.explorations);
    return {
      epic: g.epic,
      features: g.features,
      plan,
      ref: epicRef(g.epic),
      delivered:
        g.epic.implementation === 'implemented' && plan.lines.length > 0 && plan.lines.every((l) => l.state === 'built'),
    };
  });
}

export function useEpicPlans(_projectId: string, state: ProductState | undefined): EpicState[] | undefined {
  return state ? epicPlans(state) : undefined;
}
