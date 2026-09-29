// Every epic with its plan (its list, each line's state), from the epics' current versions: what the
// board, the Epics page and "Next step" read.

import { useQueries } from '@tanstack/react-query';
import { recordQuery } from '../../api/queries.ts';
import type { ProductRow, ProductState } from '../../api/types.ts';
import type { EpicRef } from './DesignNext.tsx';
import { type EpicPlan, epicGroups, epicPlan, featuresSection } from './logic.ts';

export type EpicState = {
  epic: ProductRow;
  features: ProductRow[];
  plan: EpicPlan;
  /** What "Design the next one" needs: only for an approved epic. */
  ref: EpicRef | null;
  /** Its walk-through is checked and every feature of its list is built. */
  delivered: boolean;
};

export function useEpicPlans(projectId: string, state: ProductState | undefined): EpicState[] | undefined {
  const rows = state ? [...state.designs, ...state.decisions] : [];
  const { groups } = epicGroups(rows);
  const records = useQueries({ queries: groups.map((g) => recordQuery(projectId, g.epic.code)) });
  if (!state || records.some((r) => !r.data)) return undefined;
  return groups.map((g, i) => {
    const record = records[i]?.data;
    const current = record?.versions.find((v) => v.n === record.current);
    const shown = current ?? record?.versions.find((v) => v.id === g.epic.latest_id);
    const plan = epicPlan(g.epic, featuresSection(shown?.sections ?? []), g.features, rows, state.explorations);
    return {
      epic: g.epic,
      features: g.features,
      plan,
      ref:
        record && current
          ? { code: record.code, title: current.title, currentId: current.id, versionIds: record.versions.map((v) => v.id) }
          : null,
      delivered:
        g.epic.implementation === 'implemented' && plan.lines.length > 0 && plan.lines.every((l) => l.state === 'built'),
    };
  });
}
