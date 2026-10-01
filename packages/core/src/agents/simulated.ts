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


/** A small design-system token set for the simulator: both themes, motion with its three curves and the reduced-motion rule. */
function simulatedTokens(accent: string) {
  const color = (light: string, dark: string) => ({ $value: { light, dark }, $type: 'color' });
  const dim = (v: string) => ({ $value: v, $type: 'dimension' });
  const duration = (v: string) => ({ $value: v, $type: 'duration' });
  const curve = (v: [number, number, number, number]) => ({ $value: v, $type: 'cubicBezier' });
  return {
    color: {
      'bg-page': color('#ffffff', '#121212'),
      'surface-raised': color('#f4f4f4', '#1e1e1e'),
      'text-primary': color('#161616', '#f4f4f4'),
      'text-muted': color('#525252', '#c6c6c6'),
      accent: color(accent, accent),
    },
    typography: {
      family: { sans: { $value: ['system-ui', 'sans-serif'], $type: 'fontFamily' } },
      size: { body: dim('1rem'), heading: dim('1.5rem') },
      lineHeight: { body: { $value: 1.5, $type: 'number' } },
    },
    space: { sm: dim('0.5rem'), md: dim('1rem') },
    radius: { control: dim('4px') },
    shadow: { raised: { $value: '0 1px 2px rgba(0,0,0,0.2)', $type: 'shadow' } },
    motion: {
      duration: { fast: duration('110ms'), moderate: duration('240ms') },
      easing: { standard: curve([0.2, 0, 0.38, 0.9]), entrance: curve([0, 0, 0.38, 0.9]), exit: curve([0.2, 0, 1, 0.9]) },
      scheme: 'productive' as const,
      reduced: 'Animations are replaced by an instant change under prefers-reduced-motion: reduce.',
    },
  };
}

const SIM_STATES = ['default', 'hover', 'focus', 'pressed', 'disabled'];

const SIM_COMPONENTS = [
  'Button',
  'IconButton',
  'TextInput',
  'Textarea',
  'Select',
  'Checkbox',
  'RadioGroup',
  'Switch',
  'Tabs',
  'Dialog',
  'Tooltip',
  'Toast',
];

function simulatedTile(name: string, accent: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:system-ui,sans-serif;margin:16px;background:#fff;color:#161616}
h1{font-size:1.5rem;margin:0 0 8px}.sw{display:inline-block;width:48px;height:48px;background:${accent};border-radius:4px}
button,input{font:inherit;padding:8px 12px;border-radius:4px;border:1px solid #525252;margin:4px}
.primary{background:${accent};color:#fff;border-color:${accent}}.hover{filter:brightness(1.1)}.focus{outline:2px solid ${accent};outline-offset:2px}.disabled{opacity:.5}
.dot{width:12px;height:12px;background:${accent};border-radius:50%;animation:move 1.2s cubic-bezier(0.2,0,0.38,0.9) infinite alternate}
@keyframes move{to{transform:translateX(48px)}}@media (prefers-reduced-motion:reduce){.dot{animation:none}}
</style></head><body><h1>${name}</h1><p>The quick brown fox jumps over the lazy dog.</p><span class="sw"></span>
<div><button class="primary">Default</button><button class="primary hover">Hover</button><button class="primary focus">Focus</button><button class="primary disabled" disabled>Disabled</button></div>
<div><input placeholder="Default"><input class="focus" placeholder="Focus"><input class="disabled" placeholder="Disabled" disabled></div><div class="dot"></div></body></html>`;
}

function simulatedSpecimen(name: string): string {
  const cells = SIM_STATES.map((st) => `<span class="c ${st}">${name} ${st}</span>`).join('');
  return `<style>.c{display:inline-block;margin:4px;padding:6px 10px;border:1px solid #525252;border-radius:4px;font-family:system-ui}.hover{background:#f4f4f4}.focus{outline:2px solid #0f62fe}.pressed{background:#e0e0e0}.disabled{opacity:.5}</style>${cells}`;
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
        // Each part builds on the one before it.
        depends_on: i === 0 ? [] : [i],
        waits_for_features: [],
      })),
      task_changes: [],
      sources: [],
    };
  },

  design_directions(p) {
    const c = obj(p.context.content);
    const base = obj(obj(c.design_system).base);
    const from = txt(base.name) ? `${txt(base.name)} with` : 'A new system with';
    const direction = (name: string, accent: string, why: string) => ({
      name,
      why,
      tokens: (({ color, typography, motion }) => ({ color, typography, motion }))(simulatedTokens(accent)),
      tile_html: simulatedTile(name, accent),
    });
    return {
      reply: 'Here are two visual directions.',
      directions: [
        direction('Calm', '#0f62fe', `${from} a calm, quiet personality for people who work for hours.`),
        direction('Bold', '#a2191f', `${from} a bolder personality that makes key moments stand out.`),
      ],
      sources: [],
    };
  },

  design_system_plan(p) {
    const c = obj(p.context.content);
    const base = obj(obj(c.design_system).base);
    const chosen = obj(c.chosen_direction);
    const direction = txt(chosen.name, 'Calm');
    const accentOf = (n: string) => (n === 'Bold' ? '#a2191f' : '#0f62fe');
    const publicBase = base.kind === 'public';
    return {
      reply: 'Here is the design system.',
      result: {
        title: `Design system: ${direction}`,
        sections: {
          Principles: 'Quiet by default. Clear before clever. Every state is designed.',
          'Visual direction': `The ${direction} direction: system type, one accent, generous contrast.`,
          Tokens: 'Color (light and dark), type, space, radius, shadow and motion, as DTCG tokens.',
          Components: `${SIM_COMPONENTS.length} components, each with all its states.`,
          Patterns: 'A form is a group of inputs with a primary button.',
          Motion: 'Productive motion: short, with the standard curve; reduced motion turns it off.',
          Accessibility: 'WCAG 2.2 AA: text contrast 4.5:1 in both themes and a visible focus ring.',
          Governance: 'A new component or token is a new version of the system that the person approves.',
        },
        spec: {
          base: publicBase
            ? { kind: 'public', name: txt(base.name), url: txt(base.url), license: txt(base.license) }
            : { kind: 'scratch' },
          principles: ['Quiet by default', 'Clear before clever', 'Every state is designed'],
          tokens: simulatedTokens(accentOf(direction)),
          components: SIM_COMPONENTS.map((name) => ({
            name,
            purpose: `The ${name} of the system.`,
            interactive: true,
            variants: ['primary', 'secondary'],
            states: SIM_STATES,
            accessibility: 'Reachable and operable by keyboard, with a visible focus ring.',
            specimen_html: simulatedSpecimen(name),
          })),
          patterns: [{ name: 'Form', purpose: 'Collects information and confirms it.', uses: ['TextInput', 'Button'] }],
          paths: { system: 'src/design-system/' },
        },
        change_note: null,
      },
      sources: [],
    };
  },

  screen_design(p) {
    const c = obj(p.context.content);
    const feature = obj(c.feature);
    const code = txt(feature.code, 'FDR-AAA-001');
    const title = truncate(txt(feature.title, 'Feature'), 100);
    const steps = list(feature.steps).map((s, i) => Number(obj(s).n) || i + 1);
    const names = list(obj(c.design_system).components)
      .map((k) => txt(obj(k).name))
      .filter(Boolean);
    const used = names.slice(0, 2);
    const html = (state: string, body: string) =>
      `<style>:root{--color-text:#161616;--color-bg:#ffffff;--space-4:16px;--radius-md:4px}.s{font-family:system-ui;padding:var(--space-4);color:var(--color-text);background:var(--color-bg);border-radius:var(--radius-md)}</style><main class="s" data-state="${state}">${body}</main>`;
    return {
      reply: `Here are the screens for "${title}".`,
      result: {
        title: `Screens: ${title}`,
        sections: {
          Flow: 'One screen: the person opens it, does the work and sees the result.',
          Screens: `${title}: the whole feature on one screen.`,
          States: 'Empty, loading, error and with data, all drawn with the design tokens.',
          Components: `It uses ${used.join(' and ') || 'the components of the design system'}.`,
        },
        spec: {
          feature: { code, version: Number(feature.version) || 1 },
          no_ui: null,
          screens: [
            {
              id: 'main',
              name: title,
              purpose: `Lets the person do "${title}" from start to finish.`,
              steps: steps.length > 0 ? steps : [1],
              components: used,
              states: {
                empty: html('empty', '<h1>Nothing here yet</h1><p>Add the first item to get started.</p>'),
                loading: html('loading', '<p role="status" aria-busy="true">Loading…</p>'),
                error: html('error', '<p role="alert">Something went wrong. Try again.</p>'),
                data: html('data', `<h1>${title}</h1><p>Here is what you have.</p>`),
              },
            },
          ],
          flow: [],
        },
        change_note: null,
      },
      sources: [],
    };
  },

  pr_review(p) {
    const c = obj(p.context.content);
    const diff = txt(c.diff);
    const codes = list(c.criteria)
      .map((k) => txt(obj(k).code))
      .filter(Boolean);
    // A criterion is covered when the diff has a test title that starts with its code.
    const titleOf = (code: string) => new RegExp(`['"\`](${code}[^'"\`]*)['"\`]`).exec(diff)?.[1] ?? null;
    // ... and CI has a passing case for it (the checker rejects `covered` without one).
    const passing = new Set(list(obj(c.ci).tests).filter((t) => obj(t).result === 'pass').map((t) => txt(obj(t).code)));
    const criteria = codes.map((code) => {
      const found = titleOf(code);
      const test = found !== null && passing.has(code) ? found : null;
      return { code, test_name: test, covered: test !== null, note: test ? 'A test with this code is in the diff.' : 'No passing test with this code is in the diff and in CI.' };
    });
    const missing = criteria.filter((k) => !k.covered).map((k) => k.code);
    if (missing.length === 0)
      return { verdict: 'approve', summary: 'Every criterion of the task has a test in the diff.', comments: [], criteria, sources: [] };
    return {
      verdict: 'request_changes',
      summary: `No passing test (in the diff and in CI) for ${missing.join(', ')}.`,
      comments: [{ path: 'tests', line: null, severity: 'blocking', body: `Add an automated test whose title starts with ${missing.join(', ')} and make it pass in CI.` }],
      criteria,
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
