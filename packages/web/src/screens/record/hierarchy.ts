// Where a record sits in the design hierarchy (DEF → EPC → FDR → task): the epics and features above
// it, from the top, following what each one rests on. The breadcrumb and the navigator read it.

import type { ProductRow, ProductState } from '../../api/types.ts';

const LEVELS = new Set(['epic', 'fdr']);

export function ancestorsOf(state: Pick<ProductState, 'designs' | 'decisions'> | undefined, code: string): ProductRow[] {
  if (!state) return [];
  const byCode = new Map([...state.designs, ...state.decisions].map((r) => [r.code, r]));
  const out: ProductRow[] = [];
  let at = byCode.get(code)?.based_on ?? null;
  while (at && out.length < 4) {
    const r = byCode.get(at);
    if (!r || !LEVELS.has(r.type) || out.some((o) => o.code === r.code)) break;
    out.unshift(r);
    at = r.based_on;
  }
  return out;
}
