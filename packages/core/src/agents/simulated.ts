// Agente simulado determinista: la misma acción con el mismo context pack da la misma salida
// (AC-ESQ-001-09). Se usa en la CI y en las pruebas; los guiones permiten forzar salidas
// inválidas, errores o demoras.

import type { AgentAction, AgentRequest, AgentPort, AgentResult } from '@demiurgo/domain';

export type Script = (p: AgentRequest) => unknown;

export type SimulatedOptions = {
  scripts?: Partial<Record<AgentAction, Script>>;
  delayMs?: number;
  /** Se llama justo al empezar cada invocación (p. ej. para señalar a una prueba). */
  onInvoke?: (p: AgentRequest) => void;
  /** Error forzado del agente, sin salida. */
  failure?: { failureKind: 'agent_error' | 'infra' | 'timeout'; message: string };
};

type AnyObject = Record<string, unknown>;
const obj = (v: unknown): AnyObject => (typeof v === 'object' && v !== null ? (v as AnyObject) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown, def = ''): string => (typeof v === 'string' ? v : def);

function trim(t: string, n: number): string {
  const clean = t.replace(/\s+/g, ' ').trim();
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
}

export const DEFAULT_SCRIPTS: Record<AgentAction, Script> = {
  echo(p) {
    const text = txt(obj(obj(p.context.content).input).text);
    return { reply: text ? `Eco: ${trim(text, 1900)}` : 'Eco: (vacío)' };
  },

  exploration_chat(p) {
    const c = obj(p.context.content);
    const messages = list(c.messages).map(obj);
    const last = messages.toReversed().find((m) => txt(m.author).startsWith('human:') || txt(m.author).startsWith('agent:'));
    const text = txt(last?.text, txt(c.purpose));
    const pending = list(c.questions)
      .map(obj)
      .filter((q) => q.state === 'pending');
    const wantsToDecide = /\b(decid|elegimos|elijo|quiero|vamos a|usaremos)/i.test(text);
    const output: AnyObject = {
      reply: `Entendido: «${trim(text, 300)}». ${wantsToDecide ? 'Propongo registrarlo como decisión.' : 'Necesito concretar algo más.'}`,
      observations: [{ type: 'hypothesis', text: `La intención principal es: ${trim(text, 200)}` }],
      questions: [],
      inferences: [],
      proposals: [],
    };
    if (wantsToDecide) {
      (output.proposals as unknown[]).push({
        type: 'decision',
        title: trim(text, 120),
        context: trim(`Exploración: ${txt(c.purpose)}`, 2900),
        decision: trim(text, 2900),
        consequences: 'Hay que diseñar la funcionalidad con criterios de aceptación verificables.',
      });
      const first = pending[0];
      if (first && typeof first.id === 'string') {
        (output.inferences as unknown[]).push({
          question_id: first.id,
          conclusion: trim(text, 1400),
          reasoning: 'La persona lo ha expresado en su último mensaje.',
        });
      }
    } else if (pending.length === 0) {
      (output.questions as unknown[]).push({
        question: '¿Quién usará primero el producto y qué necesita hacer?',
        reason: 'Define el alcance del primer diseño.',
        impact: 'high',
      });
    }
    return output;
  },

  design_proposal(p) {
    const c = obj(p.context.content);
    const d = obj(c.decision);
    const title = trim(txt(d.title, 'Feature'), 140);
    return {
      fdr: {
        title: `Diseño: ${title}`,
        goal: trim(`Llevar a producto la decisión ${txt(d.code)}: ${txt(d.decision, title)}`, 2900),
        scope: 'El recorrido principal de la decisión, de principio a fin, para una persona.',
        out_of_scope: 'Integraciones externas y varios usuarios a la vez.',
        behavior: `La persona realiza el recorrido principal de «${title}» y ve el resultado confirmado.`,
        criteria: [
          {
            title: 'Recorrido principal',
            statement: `Dado un proyecto vacío, cuando la persona completa el recorrido de «${title}», entonces ve el resultado guardado.`,
            verification: 'automatic',
            check: 'Una prueba de extremo a extremo recorre el flujo y comprueba el resultado.',
          },
          {
            title: 'Error comprensible',
            statement:
              'Dado un dato inválido, cuando la persona lo envía, entonces ve un mensaje en español que explica qué corregir.',
            verification: 'automatic',
            check: 'Una prueba envía un dato inválido y comprueba el mensaje.',
          },
        ],
      },
    };
  },
};

export function createSimulatedAgent(options: SimulatedOptions = {}): AgentPort {
  return {
    provider: 'simulated',
    async execute(p: AgentRequest): Promise<AgentResult> {
      options.onInvoke?.(p);
      const start = Date.now();
      if (options.delayMs) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, options.delayMs);
          p.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('cancelled'));
          });
        }).catch(() => undefined);
        if (p.signal?.aborted) {
          return {
            state: 'error',
            failureKind: 'cancelled',
            message: 'Cancelled.',
            rawEvents: '',
            provider: 'simulated',
            model: 'simulated',
          };
        }
      }
      const usage = {
        inputTokens: JSON.stringify(p.context.content).length,
        outputTokens: 0,
        durationMs: Date.now() - start,
      };
      if (options.failure) {
        return {
          state: 'error',
          failureKind: options.failure.failureKind,
          message: options.failure.message,
          usage,
          rawEvents: '',
          provider: 'simulated',
          model: 'simulated',
        };
      }
      const script = options.scripts?.[p.action] ?? DEFAULT_SCRIPTS[p.action];
      const output = script(p);
      const raw = JSON.stringify(output);
      return {
        state: 'ok',
        rawOutput: output,
        usage: { ...usage, outputTokens: raw.length },
        rawEvents: raw,
        provider: 'simulated',
        model: 'simulated',
      };
    },
  };
}
