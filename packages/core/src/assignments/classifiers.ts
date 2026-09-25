// The knowledge classifier of each project (FDR-AGE-002): the knowledge_classifier agent on the
// engine the person assigned, and the cascade to knowledge_reviewer when it has one too. Without an
// engine there is no silent fallback: classifying fails with what the person has to do, and the
// knowledge update is rejected until they choose a model and retry it.

import { type Classifier, composeSystem } from '@demiurgo/domain';
import { type LoadedAgent, loadAgentCatalog } from '../agents/catalog.ts';
import { createAgentClassifier } from '../classifier/agent-classifier.ts';
import { createCascadeClassifier } from '../classifier/cascade.ts';
import { createSimulatedClassifier } from '../classifier/simulated.ts';
import type { Services } from '../services.ts';
import { resolutionProblem, resolveEngine } from './assignments.ts';
import { callProvider } from './calls.ts';

export const CLASSIFIER_AGENT = 'knowledge_classifier';
export const REVIEWER_AGENT = 'knowledge_reviewer';

/** A classifier that can't run: any call fails with the reason. Its id marks what it recorded. */
export function unavailableClassifier(reason: string): Classifier {
  const fail = async (): Promise<never> => {
    throw new Error(reason);
  };
  return { id: 'unassigned', choice: fail, score: fail, noul: fail };
}

async function classifierOf(
  s: Services,
  projectId: string,
  agent: LoadedAgent,
): Promise<{ ok: true; classifier: Classifier } | { ok: false; problem: string }> {
  const r = await resolveEngine(s.db, s.providers, { projectId, agent: agent.id });
  const problem = resolutionProblem(agent.id, r);
  if (problem || r.status !== 'ok') return { ok: false, problem: problem ?? `${agent.id} cannot run.` };
  if (r.provider === 'simulated') return { ok: true, classifier: createSimulatedClassifier() };
  const provider = s.providers.get(r.provider);
  if (!provider) return { ok: false, problem: `${r.provider} isn't available here.` };
  return {
    ok: true,
    classifier: createAgentClassifier({
      id: `agent:${agent.id}@${agent.version}/${r.provider}/${r.model}/${r.effort ?? 'default'}`,
      system: (_primitive, rules) => composeSystem(agent, agent.skillDefinitions, rules).system,
      invoke: (call) =>
        callProvider(
          s.db,
          provider,
          {
            projectId,
            runId: null,
            agent: agent.id,
            agentVersion: agent.version,
            promptHash: composeSystem(agent, agent.skillDefinitions, []).promptHash,
          },
          {
            system: call.system,
            input: call.input,
            schema: call.schema,
            model: r.model,
            effort: r.effort,
            session: { mode: 'none' },
            timeMs: agent.timeLimitSeconds * 1000,
          },
        ),
    }),
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
