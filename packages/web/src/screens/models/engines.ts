// Pure logic of Models & providers: which engines can be chosen (only what discovery found), how
// choosing a provider or a model moves the rest of the choice, and the words for an engine.

import type { AgentInfo, Catalog, Engine, ProviderModel, Resolution } from '../../api/models.ts';

const PROVIDER_ORDER = ['claude', 'codex', 'opencode', 'simulated'];
const AGENT_ORDER = ['onboarding', 'explorer', 'epic_planner', 'feature_designer', 'task_planner', 'design_director', 'design_system_designer', 'builder', 'pr_reviewer', 'designer', 'knowledge_classifier', 'knowledge_reviewer', 'echo'];

const rank = (list: string[], id: string): number => {
  const i = list.indexOf(id);
  return i < 0 ? list.length : i;
};

/** Providers that offer at least one model, in a fixed order (a provider not signed in still lists its models). */
export function choosableProviders(catalogs: readonly Catalog[]): Catalog[] {
  return catalogs
    .filter((c) => c.models.length > 0 && PROVIDER_ORDER.includes(c.provider))
    .toSorted((a, b) => rank(PROVIDER_ORDER, a.provider) - rank(PROVIDER_ORDER, b.provider));
}

export function modelsOf(catalogs: readonly Catalog[], provider: string): ProviderModel[] {
  return catalogs.find((c) => c.provider === provider)?.models ?? [];
}

export function effortsOf(catalogs: readonly Catalog[], provider: string, model: string): string[] {
  return modelsOf(catalogs, provider).find((m) => m.id === model)?.efforts ?? [];
}

function effortFor(m: ProviderModel, wanted: string | null): string | null {
  if (m.efforts.length === 0) return null;
  if (wanted && m.efforts.includes(wanted)) return wanted;
  if (m.defaultEffort && m.efforts.includes(m.defaultEffort)) return m.defaultEffort;
  // Without a declared default (Claude), the middle of the scale rather than the lowest.
  return m.efforts.includes('medium') ? 'medium' : (m.efforts[0] ?? null);
}

/** The first model of a provider with its default effort, or null if it offers none. */
export function firstEngine(catalogs: readonly Catalog[], provider: string): Engine | null {
  const m = modelsOf(catalogs, provider)[0];
  return m ? { provider, model: m.id, effort: effortFor(m, null) } : null;
}

export function withProvider(catalogs: readonly Catalog[], provider: string): Engine | null {
  return firstEngine(catalogs, provider);
}

/** Another model of the same provider: the effort stays if the new model offers it. */
export function withModel(catalogs: readonly Catalog[], engine: Engine, model: string): Engine {
  const m = modelsOf(catalogs, engine.provider).find((x) => x.id === model);
  return { provider: engine.provider, model, effort: m ? effortFor(m, engine.effort) : null };
}

/** «Codex · GPT-6-Sol · high», with the labels discovery gave (or the ids, if it's gone). */
export function engineLabel(engine: Engine, catalogs: readonly Catalog[]): string {
  const c = catalogs.find((x) => x.provider === engine.provider);
  const model = c?.models.find((m) => m.id === engine.model)?.label ?? engine.model;
  return [c?.label ?? engine.provider, model, ...(engine.effort ? [engine.effort] : [])].join(' · ');
}

const SOURCE_WORDS = { group: 'from its group', agent: 'its own model', override: 'this time', fallback: 'its backup' } as const;

/** What runs the agent, and where that comes from; or what the person has to do so it can run. */
export function resolutionLine(r: Resolution | null, catalogs: readonly Catalog[]): { tone: 'ok' | 'problem'; text: string } {
  if (!r || r.status === 'unassigned') return { tone: 'problem', text: 'No model: DEMIURGO cannot run it.' };
  if (r.status === 'unavailable') {
    const backup = r.fallback?.problem ? ` Its backup can't run either: ${r.fallback.problem}` : '';
    return { tone: 'problem', text: `${r.reason}${backup}` };
  }
  if (r.source === 'fallback' && r.replaced) {
    return {
      tone: 'ok',
      text: `${engineLabel(r, catalogs)} (its backup, because ${engineLabel(r.replaced, catalogs)} can't run: ${r.replaced.reason})`,
    };
  }
  return { tone: 'ok', text: `${engineLabel(r, catalogs)} (${SOURCE_WORDS[r.source]})` };
}

/** The backup a task falls back to, and where it comes from: «Codex · GPT-6-Luna · low (its own)». */
export function fallbackLine(
  own: Engine | null,
  group: Engine | null,
  catalogs: readonly Catalog[],
): { engine: Engine; text: string } | null {
  if (own) return { engine: own, text: `${engineLabel(own, catalogs)} (its own)` };
  if (group) return { engine: group, text: `${engineLabel(group, catalogs)} (from its group)` };
  return null;
}

export function agentOrder(a: string, b: string): number {
  return rank(AGENT_ORDER, a) - rank(AGENT_ORDER, b);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(2))}M`;
  return n.toLocaleString('en-GB');
}

/** The part of DEMIURGO an agent is, by its id: "Explorer" (the id itself when it isn't known). */
export function agentSection(id: string, agents: readonly Pick<AgentInfo, 'id' | 'section'>[] | undefined): string {
  return agents?.find((a) => a.id === id)?.section ?? id;
}

/** The failures of an engine by kind, in words: "2 invalid output, 1 timeout" (every "_" a space). */
export function failureKindsText(failures: Record<string, number>): string {
  return Object.entries(failures)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${n} ${kind.replaceAll('_', ' ')}`)
    .join(', ');
}

/**
 * What a change of engine did, said once it applied (DESIGN.md §3.9): "Deep thinking now uses Codex
 * · GPT-6 · medium.", "Ask DEMIURGO now uses Claude · Opus · high instead of its group's.",
 * "Ask DEMIURGO follows its group again."
 */
export function changeWords(
  name: string,
  change: { kind: 'group' | 'agent'; engine: Engine | null },
  catalogs: readonly Catalog[],
): string {
  if (change.kind === 'group') {
    return change.engine ? `${name} now uses ${engineLabel(change.engine, catalogs)}.` : `${name} has no engine now.`;
  }
  return change.engine
    ? `${name} now uses ${engineLabel(change.engine, catalogs)} instead of its group's.`
    : `${name} follows its group again.`;
}

/**
 * What a change of backup did: "Deep thinking falls back to Codex · GPT-6-Luna · low.", "Deep
 * thinking has no backup now.", "Translation falls back to … instead of its group's backup.",
 * "Translation takes its group's backup again." (or "has no backup now", without a group).
 */
export function fallbackChangeWords(
  name: string,
  change: { kind: 'group' | 'agent'; engine: Engine | null; inGroup: boolean },
  catalogs: readonly Catalog[],
): string {
  if (change.engine) {
    const instead = change.kind === 'agent' && change.inGroup ? " instead of its group's backup" : '';
    return `${name} falls back to ${engineLabel(change.engine, catalogs)}${instead}.`;
  }
  return change.kind === 'agent' && change.inGroup ? `${name} takes its group's backup again.` : `${name} has no backup now.`;
}
