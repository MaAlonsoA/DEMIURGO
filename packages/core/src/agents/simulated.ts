// Deterministic simulator: the same action with the same context pack gives the same output
// (AC-ESQ-001-09). It is the simulated provider, used in CI and in tests (and offered only with the
// dev tools); scripts let you force invalid outputs, errors or delays.

import {
  type AgentAction,
  type AgentResult,
  type Provider,
  type ProviderEvent,
  type SessionRequest,
  fingerprint,
} from '@demiurgo/domain';

/** What a script simulates: the action and its context pack. */
export type SimulatedTask = { action: string; context: { hash: string; content: unknown } };

/** What the simulator receives in each invocation: the task, the output schema and the composed prompt. */
export type SimulatedInvocation = SimulatedTask & {
  schema?: Record<string, unknown>;
  system?: string;
  input?: string;
  session?: SessionRequest;
  timeMs?: number;
};

export type Script = (p: SimulatedInvocation) => unknown;

export type SimulatedOptions = {
  scripts?: Partial<Record<AgentAction, Script>>;
  delayMs?: number;
  /** Called right when each invocation starts (e.g. to signal a test). */
  onInvoke?: (p: SimulatedInvocation) => void;
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
      purpose: null,
      reply: `Got it: "${truncate(text, 300)}". ${wantsToDecide ? 'I suggest recording it as a decision.' : 'I need to pin down something more.'}`,
      observations: [{ type: 'hypothesis', text: `The main intent is: ${truncate(text, 200)}` }],
      questions: [],
      question_options: pending
        .filter((q) => typeof q.id === 'string')
        .slice(0, 8)
        .map((q) => ({ question_id: q.id, options: [
          { answer: 'Yes', implies: 'It becomes a requirement of the first version.' },
          { answer: 'Not for now', implies: 'It stays out of scope; it can come back later.' },
        ], question: null, reason: null })),
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
        options: [
          { answer: 'Only me, to design my own products', implies: 'A single-user app: no accounts, roles or sharing yet.' },
          { answer: 'A small team', implies: 'Accounts and shared projects are needed from the start.' },
        ],
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

function scriptFor(options: SimulatedOptions, action: string): Script {
  const known = action as AgentAction;
  const script = options.scripts?.[known] ?? DEFAULT_SCRIPTS[known];
  if (!script) throw new Error(`The simulator has no script for "${action}".`);
  return script;
}

/** Waits for the configured delay, unless the signal aborts first: then it says so. */
async function delay(ms: number | undefined, signal: AbortSignal | undefined): Promise<'aborted' | 'done'> {
  if (!ms) return signal?.aborted ? 'aborted' : 'done';
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
  return signal?.aborted ? 'aborted' : 'done';
}

/**
 * The simulator as a provider (FDR-AGE-002): only offered with the dev tools, and what the tests
 * assign. It runs the script of the invocation's task and streams started → message → result.
 * With a session it returns a stable id, so session continuity can be tested without quota.
 */
export function createSimulatedProvider(options: SimulatedOptions = {}): Provider {
  const common = { provider: 'simulated', model: 'simulated' } as const;
  return {
    id: 'simulated',
    label: 'Simulated',
    sessions: true,
    async discover() {
      return {
        provider: 'simulated',
        label: 'Simulated',
        installed: true,
        version: '1',
        ready: true,
        message: null,
        sessions: true,
        models: [{ id: 'simulated', label: 'Simulated (deterministic)', efforts: [], defaultEffort: null }],
      };
    },
    async run(inv): Promise<AgentResult> {
      const task = inv.task ?? { action: 'echo', context: { hash: '', content: {} } };
      const received = {
        ...task,
        schema: inv.schema,
        system: inv.system,
        input: inv.input,
        session: inv.session,
        timeMs: inv.timeMs,
      };
      options.onInvoke?.(received);
      const emit = (kind: ProviderEvent['kind'], raw: unknown) => inv.onEvent?.({ kind, raw: JSON.stringify(raw) });
      const start = Date.now();
      emit('started', { type: 'started', action: task.action, session: inv.session.mode });
      const sessionId =
        inv.session.mode === 'resumed'
          ? inv.session.id
          : inv.session.mode === 'fresh'
            ? `sim-${fingerprint({ context: task.context.hash, start }).slice(0, 12)}`
            : undefined;
      const withSession = sessionId === undefined ? {} : { sessionId };
      if ((await delay(options.delayMs, inv.signal)) === 'aborted') {
        return { state: 'error', failureKind: 'cancelled', message: 'Cancelled.', rawEvents: '', ...common };
      }
      const usage = {
        inputTokens: inv.input.length,
        outputTokens: 0,
        durationMs: Date.now() - start,
        provenance: { inputTokens: 'simulated:input.length', outputTokens: 'simulated:output.length' },
      };
      if (options.failure) {
        emit('error', { type: 'error', message: options.failure.message });
        return {
          state: 'error',
          failureKind: options.failure.failureKind,
          message: options.failure.message,
          usage,
          rawEvents: '',
          ...common,
          ...withSession,
        };
      }
      const output = scriptFor(options, task.action)(received);
      const raw = JSON.stringify(output);
      emit('message', { type: 'message', text: raw.slice(0, 200) });
      emit('result', { type: 'result', output });
      return {
        state: 'ok',
        rawOutput: output,
        usage: { ...usage, outputTokens: raw.length },
        rawEvents: raw,
        ...common,
        ...withSession,
      };
    },
  };
}
