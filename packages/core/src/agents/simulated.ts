// Deterministic simulator: the same action with the same context pack gives the same output
// (AC-ESQ-001-09). It is the simulated provider, used in CI and in tests (and offered only with the
// dev tools); scripts let you force invalid outputs, errors or delays.

import {
  type AgentAction,
  type AgentResult,
  type AgentResultDetails,
  type Provider,
  type ProviderEvent,
  type ProviderTrace,
  type SessionRequest,
  type Usage,
  fingerprint,
} from '@demiurgo/domain';

/** What the simulator reports as its command line: it launches nothing. */
export const SIMULATED_COMMAND = 'simulated';

/** What a script simulates: the action and its context pack. */
export type SimulatedTask = { action: string; context: { hash: string; content: unknown } };

/** What the simulator receives in each invocation: the task, the output schema and the composed prompt. */
export type SimulatedInvocation = SimulatedTask & {
  schema?: Record<string, unknown>;
  system?: string;
  input?: string;
  session?: SessionRequest;
  timeMs?: number;
  trace?: ProviderTrace;
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

const SIMULATED_OPTIONS = [
  { answer: 'Yes', implies: 'It becomes a requirement of the first version.', exclusive: false },
  { answer: 'Not for now', implies: 'It stays out of scope; it can come back later.', exclusive: false },
];

/** In a test idea, asks the simulated onboarding to infer every pending question but the last two. */
export const INFER_MARKER = '[infer]';

/** In a test message, asks the simulated explorer to change the definition's constraints to its first sentence. */
export const REDEFINE_MARKER = '[redefine]';

/** The first sentence of a text, at most 200 characters. */
function firstSentence(text: string): string {
  return (
    text
      .trim()
      .split(/(?<=[.!?])\s/)[0]
      ?.slice(0, 200) ?? ''
  );
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
    // The run's schema asks for the options of some questions by id: answer in that shape.
    const asked = obj(obj(p.schema?.properties).question_options);
    const narrowed = asked.type === 'object' ? list(asked.required).filter((id): id is string => typeof id === 'string') : null;
    const wantsToDecide =
      /\b(decid|elegimos|elijo|quiero|vamos a|usaremos|decide|chosen|choose|i want|we'll use|let's go with|going with)/i.test(
        text,
      );
    const output: AnyObject = {
      purpose: null,
      reply: `Got it: "${truncate(text, 300)}". ${wantsToDecide ? 'I suggest recording it as a decision.' : 'I need to pin down something more.'}`,
      observations: [{ type: 'hypothesis', text: `The main intent is: ${truncate(text, 200)}` }],
      questions: [],
      question_options: narrowed
        ? Object.fromEntries(
            narrowed.map((id) => [id, { options: SIMULATED_OPTIONS, multiple: false, question: null, reason: null }]),
          )
        : pending
            .filter((q) => typeof q.id === 'string')
            .slice(0, 8)
            .map((q) => ({ question_id: q.id, options: SIMULATED_OPTIONS, multiple: false, question: null, reason: null })),
      inferences: [],
      proposals: [],
      ready_to_draft: null,
    };
    // A side conversation (Go deeper): the answer it led to, worded from the person's last words there.
    if (obj(p.schema?.properties).conversation_option) {
      output.conversation_option = {
        answer: `From our talk: ${truncate(text, 200)}`,
        implies: 'It is what the side conversation arrived at.',
      };
    }
    const definition = obj(c.product_definition);
    if (text.includes(REDEFINE_MARKER) && definition.code) {
      // A decision in this thread that changes the approved definition: its constraints now say the
      // message's first sentence, quoted as the person wrote it.
      const sentence = firstSentence(text.replace(REDEFINE_MARKER, ''));
      if (sentence) {
        (output.proposals as unknown[]).push({
          type: 'definition_change',
          section: 'Constraints',
          content: sentence,
          reason: `Decided in this thread: ${sentence}`,
          quotes: [sentence],
        });
      }
    } else if (wantsToDecide) {
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
          quotes: [text.slice(0, 200)],
        });
      }
    } else if (text.includes(INFER_MARKER)) {
      // Deterministic Day 1 for the tests: the idea answers every pending question but the last two,
      // each inferred from its first sentence (the quote), so the person confirms them and answers two.
      const sentence = firstSentence(text.replace(INFER_MARKER, ''));
      for (const q of pending.slice(0, -2)) {
        if (typeof q.id !== 'string' || !sentence) continue;
        (output.inferences as unknown[]).push({
          question_id: q.id,
          conclusion: `From the idea: ${sentence}`,
          reasoning: 'The idea says it in its first sentence.',
          quotes: [sentence],
        });
      }
    } else if (pending.length === 0) {
      (output.questions as unknown[]).push({
        question: 'Who will use the product first, and what do they need to do?',
        reason: 'Defines the scope of the first design.',
        impact: 'high',
        multiple: false,
        options: [
          {
            answer: 'Only me, to design my own products',
            implies: 'A single-user app: no accounts, roles or sharing yet.',
            exclusive: false,
          },
          { answer: 'A small team', implies: 'Accounts and shared projects are needed from the start.', exclusive: false },
        ],
      });
    }
    return output;
  },

  // The simulated reviewer finds the records coherent.
  coherence_review() {
    return { findings: [] };
  },

  epic_plan(p) {
    const c = obj(p.context.content);
    const title = truncate(txt(c.purpose, 'Capability'), 120);
    return {
      reply: 'Here is a draft of the epic with its features in order.',
      epic: {
        title,
        domain: 'simulated_epic',
        goal: `Let the person complete the capability "${title}" end to end.`,
        out_of_scope: 'Integrations with other systems and multiple concurrent users.',
        done_when: 'A person can walk the whole capability from start to finish and see the result saved.',
        criteria: [
          {
            title: 'Whole walk',
            given: 'an empty project',
            when: 'the person walks the whole capability',
            then: 'they reach the end and see the result saved',
            verification: 'automatic',
            check: 'An end-to-end test walks the capability and checks the result.',
          },
        ],
        features: [
          { name: 'Thinnest walk', summary: 'Lets the person go through the capability from start to end in its simplest form.' },
          { name: 'Edit and correct', summary: 'Lets the person change what they entered before finishing.' },
          { name: 'Review the result', summary: 'Lets the person see and share the outcome.' },
        ],
      },
      sources: [],
    };
  },

  feature_design(p) {
    const c = obj(p.context.content);
    const name = truncate(txt(obj(obj(c.feature_design).planned_feature).name, 'Feature'), 120);
    const step = (title: string, given: string, when: string, then: string, n: number) => ({
      title,
      given,
      when,
      then,
      verification: 'automatic',
      check: `A test checks: ${title}.`,
      step: n,
    });
    return {
      reply: 'Here is the design of the feature.',
      result: {
        kind: 'feature',
        feature: {
          title: name,
          goal: `Let the person do "${name}".`,
          scope: 'The main walk, start to finish, for a single person.',
          out_of_scope: 'External integrations and multiple concurrent users.',
          steps: [
            'The person opens the screen and sees what they can do.',
            'They enter the information.',
            'They confirm it.',
            'They see the result saved.',
          ],
          criteria: [
            step('Screen opens', 'a project', 'the person opens the screen', 'they see the available actions', 1),
            step('Information entered', 'the screen is open', 'the person enters valid information', 'it is accepted', 2),
            step('Invalid information', 'the screen is open', 'the person enters invalid information', 'they see a message that explains what to fix', 2),
            step('Confirmation', 'valid information is entered', 'the person confirms', 'the system records it', 3),
            step('Result shown', 'the information is recorded', 'the person looks at the result', 'they see it saved', 4),
          ],
          size: 'M',
          size_reason: 'It touches one screen and one command.',
          needs: [],
        },
      },
      sources: [],
    };
  },

  task_plan(p) {
    const c = obj(p.context.content);
    const uncovered = list(c.uncovered).filter((x): x is string => typeof x === 'string');
    const all = list(obj(c.feature).criteria)
      .map((k) => txt(obj(k).code))
      .filter(Boolean);
    const codes = uncovered.length > 0 ? uncovered : all.slice(0, 1);
    const half = Math.ceil(codes.length / 2);
    const groups = codes.length > 1 ? [codes.slice(0, half), codes.slice(half)] : [codes];
    const title = truncate(txt(obj(c.feature).title, 'Feature'), 100);
    return {
      reply: `Here are the tasks for "${title}".`,
      tasks: groups.map((covers, i) => ({
        title: `${title}: part ${i + 1}`,
        goal: `Build part ${i + 1} of "${title}".`,
        scope: 'One vertical slice through every layer, checkable on its own.',
        covers,
        size: 'M',
        size_reason: 'It touches one screen and one command.',
        split: null,
        walking_skeleton: i === 0 && c.first_feature === true,
      })),
      sources: [],
    };
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
        behavior: `1. The person completes the main walkthrough of "${title}".\n2. They see the result confirmed.`,
        criteria: [
          {
            title: 'Main walkthrough',
            statement: `Given an empty project, when the person completes the "${title}" walkthrough, then they see the result saved.`,
            verification: 'automatic',
            check: 'An end-to-end test runs through the flow and checks the result.',
            step: 1,
          },
          {
            title: 'Understandable error',
            statement: 'Given an invalid input, when the person submits it, then they see a message that explains what to fix.',
            verification: 'automatic',
            check: 'A test submits an invalid input and checks the message.',
            step: 2,
          },
        ],
      },
    };
  },
};

/** Scripts of the tasks that aren't agent runs: the reading translation marks each text with its language. */
const SERVICE_SCRIPTS: Readonly<Record<string, Script>> = {
  translation(p) {
    const content = obj(p.context.content);
    const lang = txt(content.target_language, 'es');
    return {
      fields: list(content.fields)
        .map(obj)
        .map((f) => ({ key: txt(f.key), text: `[${lang}] ${txt(f.text)}` })),
    };
  },
};

function scriptFor(options: SimulatedOptions, action: string): Script {
  const known = action as AgentAction;
  const script = options.scripts?.[known] ?? DEFAULT_SCRIPTS[known] ?? SERVICE_SCRIPTS[action];
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
      const received: SimulatedInvocation = {
        ...task,
        schema: inv.schema,
        system: inv.system,
        input: inv.input,
        session: inv.session,
        timeMs: inv.timeMs,
        ...(inv.trace ? { trace: inv.trace } : {}),
      };
      options.onInvoke?.(received);
      const emit = (kind: ProviderEvent['kind'], raw: unknown) => inv.onEvent?.({ kind, raw: JSON.stringify(raw) });
      const start = Date.now();
      emit('started', { type: 'started', action: task.action, session: inv.session.mode });
      // Like Claude, it keeps the id the engine decided for a new session; without one it makes its own.
      const sessionId =
        inv.session.mode === 'resumed'
          ? inv.session.id
          : inv.session.mode === 'fresh'
            ? (inv.session.id ?? `sim-${fingerprint({ context: task.context.hash, start }).slice(0, 12)}`)
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
      // The same evidence the real adapters leave (§7.6), so the whole circuit runs in the tests.
      const details = (u: Usage): AgentResultDetails => ({ rawUsage: u, cliCommand: [SIMULATED_COMMAND] });
      if (options.failure) {
        emit('error', { type: 'error', message: options.failure.message });
        return {
          state: 'error',
          failureKind: options.failure.failureKind,
          message: options.failure.message,
          usage,
          rawEvents: '',
          details: details(usage),
          ...common,
          ...withSession,
        };
      }
      const output = scriptFor(options, task.action)(received);
      const raw = JSON.stringify(output);
      emit('message', { type: 'message', text: raw.slice(0, 200) });
      emit('result', { type: 'result', output });
      const finalUsage = { ...usage, outputTokens: raw.length };
      return {
        state: 'ok',
        rawOutput: output,
        usage: finalUsage,
        rawEvents: raw,
        details: details(finalUsage),
        ...common,
        ...withSession,
      };
    },
  };
}
