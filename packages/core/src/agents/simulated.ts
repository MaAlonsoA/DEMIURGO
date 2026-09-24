// Deterministic simulated agent: the same action with the same context pack gives the same
// output (AC-ESQ-001-09). Used in CI and in tests; scripts let you force invalid outputs,
// errors or delays.

import type { AgentAction, AgentRequest, AgentPort, AgentResult } from '@demiurgo/domain';

export type Script = (p: AgentRequest) => unknown;

export type SimulatedOptions = {
  scripts?: Partial<Record<AgentAction, Script>>;
  delayMs?: number;
  /** Called right when each invocation starts (e.g. to signal a test). */
  onInvoke?: (p: AgentRequest) => void;
  /** Forced agent error, with no output. */
  failure?: { failureKind: 'agent_error' | 'infra' | 'timeout'; message: string };
};

type AnyObject = Record<string, unknown>;
const obj = (v: unknown): AnyObject => (typeof v === 'object' && v !== null ? (v as AnyObject) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown, def = ''): string => (typeof v === 'string' ? v : def);

function truncate(t: string, n: number): string {
  const clean = t.replace(/\s+/g, ' ').trim();
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
}

export const DEFAULT_SCRIPTS: Record<AgentAction, Script> = {
  echo(p) {
    const text = txt(obj(obj(p.context.content).input).text);
    return { reply: text ? `Echo: ${truncate(text, 1900)}` : 'Echo: (empty)' };
  },

  exploration_chat(p) {
    const c = obj(p.context.content);
    const messages = list(c.messages).map(obj);
    const last = messages.toReversed().find((m) => txt(m.author).startsWith('human:') || txt(m.author).startsWith('agent:'));
    const text = txt(last?.text, txt(c.purpose));
    const pending = list(c.questions)
      .map(obj)
      .filter((q) => q.state === 'pending');
    const wantsToDecide =
      /\b(decid|elegimos|elijo|quiero|vamos a|usaremos|decide|chosen|choose|i want|we'll use|let's go with|going with)/i.test(
        text,
      );
    const output: AnyObject = {
      reply: `Got it: "${truncate(text, 300)}". ${wantsToDecide ? 'I suggest recording it as a decision.' : 'I need to pin down something more.'}`,
      observations: [{ type: 'hypothesis', text: `The main intent is: ${truncate(text, 200)}` }],
      questions: [],
      inferences: [],
      proposals: [],
    };
    if (wantsToDecide) {
      (output.proposals as unknown[]).push({
        type: 'decision',
        title: truncate(text, 120),
        context: truncate(`Exploration: ${txt(c.purpose)}`, 2900),
        decision: truncate(text, 2900),
        consequences: 'The feature needs to be designed with verifiable acceptance criteria.',
      });
      const first = pending[0];
      if (first && typeof first.id === 'string') {
        (output.inferences as unknown[]).push({
          question_id: first.id,
          conclusion: truncate(text, 1400),
          reasoning: 'The person expressed it in their last message.',
        });
      }
    } else if (pending.length === 0) {
      (output.questions as unknown[]).push({
        question: 'Who will use the product first, and what do they need to do?',
        reason: 'Defines the scope of the first design.',
        impact: 'high',
      });
    }
    return output;
  },

  design_proposal(p) {
    const c = obj(p.context.content);
    const d = obj(c.decision);
    const title = truncate(txt(d.title, 'Feature'), 140);
    return {
      fdr: {
        title: `Design: ${title}`,
        goal: truncate(`Turn decision ${txt(d.code)} into product: ${txt(d.decision, title)}`, 2900),
        scope: "The decision's main walkthrough, start to finish, for a single person.",
        out_of_scope: 'External integrations and multiple concurrent users.',
        behavior: `The person completes the main walkthrough of "${title}" and sees the result confirmed.`,
        criteria: [
          {
            title: 'Main walkthrough',
            statement: `Given an empty project, when the person completes the "${title}" walkthrough, then they see the result saved.`,
            verification: 'automatic',
            check: 'An end-to-end test runs through the flow and checks the result.',
          },
          {
            title: 'Understandable error',
            statement: 'Given an invalid input, when the person submits it, then they see a message that explains what to fix.',
            verification: 'automatic',
            check: 'A test submits an invalid input and checks the message.',
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
