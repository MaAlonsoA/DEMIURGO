// Token usage and cost of a builder run, read from the CLI's event stream while it streams (the stored
// transcript is only a tail, so the final `result` event of a long run would be lost). It reuses the
// parsers of the providers: Claude's `result` event (`usageOf` in agents/claude-cli.ts) and Codex's
// `turn.completed` events (`summarize` + `usageOf` in providers/codex.ts), so the shape is `ai_runs.usage`.

import type { Usage } from '@demiurgo/domain';
import { claudeUsageOf, cliResultSchema } from '../agents/claude-cli.ts';
import { codexUsageOf, summarizeCodexLines } from '../providers/codex.ts';

export type UsageCollector = {
  /** Feeds a chunk of stdout (any split; lines are reassembled). */
  add(chunk: string): void;
  /** The usage seen so far, or undefined when the stream carried none. */
  usage(durationMs: number): Usage | undefined;
  /**
   * Input tokens (cached ones included) of the last turn the stream showed: the size of the conversation the model saw
   * last, which is what fills a session's context window. Claude: the `usage` of the last `assistant` event; Codex: the
   * last `turn.completed`. Undefined when the stream carried no per-turn usage.
   */
  lastTurnInputTokens(): number | undefined;
  /** The CLI version the stream announced (Claude's `init` event: `claude_code_version`), or undefined (Codex announces none). */
  cliVersion(): string | undefined;
  /** The model Claude's `init` event says it runs (`model`), or undefined (Codex never says). */
  modelReported(): string | undefined;
};

/** The `model` of a Claude `system` `init` line, or undefined. */
export function claudeInitModelOf(line: string): string | undefined {
  if (!line.includes('"init"')) return undefined;
  try {
    const e = JSON.parse(line) as { type?: unknown; subtype?: unknown; model?: unknown };
    return e.type === 'system' && e.subtype === 'init' && typeof e.model === 'string' && e.model ? e.model : undefined;
  } catch {
    return undefined;
  }
}

/** The `claude_code_version` of a Claude `system` `init` line, or undefined. */
export function claudeInitVersionOf(line: string): string | undefined {
  if (!line.includes('claude_code_version')) return undefined;
  try {
    const e = JSON.parse(line) as { type?: unknown; subtype?: unknown; claude_code_version?: unknown };
    return e.type === 'system' && e.subtype === 'init' && typeof e.claude_code_version === 'string' ? e.claude_code_version : undefined;
  } catch {
    return undefined;
  }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The per-turn input size of a Claude `assistant` line (input + cache reads + cache creation), or undefined. */
export function claudeTurnInputOf(line: string): number | undefined {
  if (!/"type"\s*:\s*"assistant"/.test(line)) return undefined;
  try {
    const e = JSON.parse(line) as { type?: unknown; message?: { usage?: Record<string, unknown> } };
    const u = e.type === 'assistant' ? e.message?.usage : undefined;
    if (!u) return undefined;
    return num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens);
  } catch {
    return undefined;
  }
}

/** The input size of a Codex `turn.completed` line (its `input_tokens` already counts the cached ones), or undefined. */
export function codexTurnInputOf(line: string): number | undefined {
  try {
    const e = JSON.parse(line) as { type?: unknown; usage?: Record<string, unknown> };
    return e.type === 'turn.completed' && typeof e.usage?.input_tokens === 'number' ? e.usage.input_tokens : undefined;
  } catch {
    return undefined;
  }
}

export function usageCollector(provider: 'claude' | 'codex'): UsageCollector {
  let pending = '';
  let claudeResult: string | undefined;
  const codexTurns: string[] = [];
  let lastTurn: number | undefined;
  let version: string | undefined;
  let reportedModel: string | undefined;
  const take = (line: string) => {
    if (provider === 'claude') {
      version ??= claudeInitVersionOf(line);
      reportedModel ??= claudeInitModelOf(line);
      const turn = claudeTurnInputOf(line);
      if (turn !== undefined && turn > 0) lastTurn = turn;
      if (line.includes('"type":"result"') || /"type"\s*:\s*"result"/.test(line)) claudeResult = line;
    } else if (line.includes('turn.completed')) {
      codexTurns.push(line);
      lastTurn = codexTurnInputOf(line) ?? lastTurn;
    }
  };
  return {
    add(chunk) {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) take(line);
    },
    modelReported() {
      if (pending) {
        take(pending);
        pending = '';
      }
      return reportedModel;
    },
    cliVersion() {
      if (pending) {
        take(pending);
        pending = '';
      }
      return version;
    },
    lastTurnInputTokens() {
      if (pending) {
        take(pending);
        pending = '';
      }
      return lastTurn;
    },
    usage(durationMs) {
      if (pending) {
        take(pending);
        pending = '';
      }
      if (provider === 'claude') {
        if (claudeResult === undefined) return undefined;
        try {
          const parsed = cliResultSchema.safeParse(JSON.parse(claudeResult));
          return parsed.success && parsed.data.type === 'result' ? claudeUsageOf(parsed.data, durationMs, true) : undefined;
        } catch {
          return undefined;
        }
      }
      const summary = summarizeCodexLines(codexTurns);
      return summary.turns > 0 ? codexUsageOf(summary, durationMs) : undefined;
    },
  };
}
