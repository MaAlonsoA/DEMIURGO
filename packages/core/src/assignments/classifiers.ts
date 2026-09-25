// The knowledge classifier of each project (FDR-AGE-002): the knowledge_classifier agent on the
// engine the person assigned, and the cascade to knowledge_reviewer when it has one too. Without an
// engine there is no silent fallback: classifying fails with what the person has to do, and the
// knowledge update is rejected until they choose a model and retry it.

import { type Classifier, type EngineSource, type Provider, composeSystem } from '@demiurgo/domain';
import { type LoadedAgent, loadAgentCatalog } from '../agents/catalog.ts';
import { PRIMITIVE_RULES, createAgentClassifier } from '../classifier/agent-classifier.ts';
import { createCascadeClassifier } from '../classifier/cascade.ts';
import { createSimulatedClassifier } from '../classifier/simulated.ts';
import type { Services } from '../services.ts';
import { resolutionProblem, resolveEngine } from './assignments.ts';
import { type CallDeps, callProvider, currentUpdateId, noCallSession } from './calls.ts';

export const CLASSIFIER_AGENT = 'knowledge_classifier';
export const REVIEWER_AGENT = 'knowledge_reviewer';

/** A classifier that can't run: any call fails with the reason. Its id marks what it recorded. */
export function unavailableClassifier(reason: string): Classifier {
  const fail = async (): Promise<never> => {
    throw new Error(reason);
  };
  return { id: 'unassigned', choice: fail, score: fail, noul: fail };
}

/**
 * A classifier agent on a provider, every call through `callProvider` so it leaves its trace
 * (spec §7.8): the update that caused it, and a `prompt_hash` of the system actually sent, the
 * primitive's rules included. `pnpm cli evaluate-classifier` can build its classifier here too.
 */
export function classifierOnProvider(
  deps: CallDeps,
  provider: Provider,
  agent: LoadedAgent,
  engine: { model: string; effort: string | null; source: EngineSource | null },
  projectId: string | null,
): Classifier {
  return createAgentClassifier({
    id: `agent:${agent.id}@${agent.version}/${provider.id}/${engine.model}/${engine.effort ?? 'default'}`,
    system: (_primitive, rules) => composeSystem(agent, agent.skillDefinitions, rules).system,
    invoke: (call) =>
      callProvider(
        deps,
        provider,
        {
          projectId,
          runId: null,
          updateId: currentUpdateId(),
          agent: agent.id,
          agentVersion: agent.version,
          promptHash: composeSystem(agent, agent.skillDefinitions, PRIMITIVE_RULES[call.primitive]).promptHash,
          engineSource: engine.source,
          session: noCallSession(),
          attempt: 1,
          inputHash: null,
          schemaHash: null,
          schemaVersion: null,
          packHash: null,
          retryOf: null,
        },
        {
          system: call.system,
          input: call.input,
          schema: call.schema,
          model: engine.model,
          effort: engine.effort,
          session: { mode: 'none' },
          timeMs: agent.timeLimitSeconds * 1000,
        },
      ),
  });
}

async function classifierOf(
  s: Services,
  projectId: string,
  agent: LoadedAgent,
): Promise<{ ok: true; classifier: Classifier } | { ok: false; problem: string }> {
  const r = await resolveEngine(s.db, s.providers, { agent: agent.id });
  const problem = resolutionProblem(agent.id, r);
  if (problem || r.status !== 'ok') return { ok: false, problem: problem ?? `${agent.id} cannot run.` };
  if (r.provider === 'simulated') return { ok: true, classifier: createSimulatedClassifier() };
  const provider = s.providers.get(r.provider);
  if (!provider) return { ok: false, problem: `${r.provider} isn't available here.` };
  return {
    ok: true,
    classifier: classifierOnProvider(s, provider, agent, { model: r.model, effort: r.effort, source: r.source }, projectId),
  };
}

export function agentClassifiers(services: () => Services): (projectId: string) => Promise<Classifier> {
  return async (projectId) => {
    const s = services();
    const catalog = await loadAgentCatalog();
    const agent = catalog.get(CLASSIFIER_AGENT);
    if (!agent) return unavailableClassifier(`There is no ${CLASSIFIER_AGENT} agent.`);
    const base = await classifierOf(s, projectId, agent);
    if (!base.ok) return unavailableClassifier(base.problem);
    const reviewerAgent = catalog.get(REVIEWER_AGENT);
    const reviewer = reviewerAgent ? await classifierOf(s, projectId, reviewerAgent) : null;
    return reviewer?.ok ? createCascadeClassifier(base.classifier, reviewer.classifier) : base.classifier;
  };
}
