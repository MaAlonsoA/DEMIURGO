// Only the explicit `run` command imports this module. No application, DB or assignment lookup.
import { typeSafeEvaluationKey } from '../env.ts';
import { readFile } from 'node:fs/promises';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { composeSystem, fingerprint, INTERPRETATION_RULES } from '@demiurgo/domain';
import { loadAgentCatalog } from '../agents/catalog.ts';
import { createAgentClassifier } from '../classifier/agent-classifier.ts';
import { createJevClassifier } from '../classifier/jev.ts';
import { createOpenCodeProvider, openCodeModels } from '../providers/opencode.ts';
import { configurationId, type Config, type Engines } from './runner.ts';

export async function liveEngines(config: Config): Promise<Engines> {
  let telemetry: unknown[] = [];
  const id = configurationId(config);
  let qwen: Engines['primary'] | undefined;
  if (config.engine !== 'jev') {
    const raw = await readFile(config.qwen.configPath, 'utf8');
    const entry = openCodeModels(JSON.parse(raw.replace(/^\uFEFF/, '').replace(/^\s*\/\/.*$/gm, ''))).find(
      (m) => m.model.id === config.qwen.model,
    );
    if (!entry) throw new Error('Requested Qwen model is absent from the explicit OpenCode configuration.');
    if (config.qwen.effort !== null && !Object.hasOwn(entry.variants, config.qwen.effort))
      throw new Error('Requested effort is absent from the model variants.');
    const effectiveOptions = { ...entry.options, ...(config.qwen.effort ? entry.variants[config.qwen.effort] : {}) };
    const provider = createOpenCodeProvider({
      configPath: config.qwen.configPath,
      maxAttempts: 3,
      fetch: async (url, init) => {
        // Credentials and headers are never copied into the trace.
        telemetry.push({
          type: 'http_request',
          provider: 'qwen',
          url: url instanceof Request ? url.url : url.toString(),
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
        });
        return fetch(url, init);
      },
    });
    const historicalAgent = config.contract === 'historical' ? (await loadAgentCatalog()).get('knowledge_classifier') : undefined;
    if (config.contract === 'historical' && !historicalAgent) throw new Error('Historical classifier agent is unavailable.');
    qwen = createAgentClassifier({
      id: `benchmark:qwen:${config.qwen.model}@${id}:${fingerprint(effectiveOptions)}`,
      system: (_primitive, rules) =>
        historicalAgent
          ? composeSystem(historicalAgent, historicalAgent.skillDefinitions, rules).system
          : [
              'Classify each item independently. Use exactly the supplied option definitions. Respond once per ID. Return calibrated confidence and a short explanation in English.',
              INTERPRETATION_RULES,
              ...rules,
            ].join('\n'),
      invoke: async (call) => {
        if ((await readFile(config.qwen.configPath, 'utf8')) !== raw)
          throw new Error('OpenCode configuration changed during the benchmark. Start a new run.');
        const result = await provider.run({
          system: call.system,
          input: call.input,
          schema: call.schema,
          model: config.qwen.model,
          effort: config.qwen.effort,
          session: { mode: 'none' },
          timeMs: 180_000,
        });
        telemetry.push({
          type: 'qwen_result',
          requestedModel: config.qwen.model,
          effectiveOptions,
          effort: config.qwen.effort,
          promptHash: fingerprint(call),
          result,
        });
        return result;
      },
    });
  }
  let jev: Engines['primary'] | undefined;
  if (config.engine !== 'qwen') {
    const apiKey = typeSafeEvaluationKey();
    if (!apiKey) throw new Error('Explicit run requires TYPESAFE_API_KEY for Jev.');
    const client = new TypeSafeClient({
      apiKey,
      defaultModel: config.jev.model,
      timeout: 30_000,
      retry: { maxRetries: 0 },
      fetch: async (url, init) => {
        const start = Date.now();
        telemetry.push({
          type: 'http_request',
          provider: 'jev',
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
        });
        try {
          const response = await fetch(url, init);
          const raw = await response.clone().text();
          let result: unknown;
          try {
            result = JSON.parse(raw);
          } catch {
            result = { raw };
          }
          telemetry.push({
            type: 'jev_result',
            requestedModel: config.jev.model,
            httpStatus: response.status,
            result,
            durationMs: Date.now() - start,
          });
          return response;
        } catch (error) {
          telemetry.push({ type: 'jev_error', durationMs: Date.now() - start, error: String(error) });
          throw error;
        }
      },
    });
    // Serial requests preserve all partial failures in their originating batch. SDK retries are disabled.
    jev = createJevClassifier({ model: config.jev.model, concurrency: 1, client });
    jev = { ...jev, id: `${jev.id}@${id}` };
  }
  return {
    primary: (config.engine === 'qwen' ? qwen : jev)!,
    ...(config.engine === 'cascade' ? { reviewer: qwen! } : {}),
    takeTelemetry: () => {
      const out = telemetry;
      telemetry = [];
      return out;
    },
  };
}
