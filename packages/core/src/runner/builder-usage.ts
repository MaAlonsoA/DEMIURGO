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
};

export function usageCollector(provider: 'claude' | 'codex'): UsageCollector {
  let pending = '';
  let claudeResult: string | undefined;
  const codexTurns: string[] = [];
  const take = (line: string) => {
    if (provider === 'claude') {
      if (line.includes('"type":"result"') || /"type"\s*:\s*"result"/.test(line)) claudeResult = line;
    } else if (line.includes('turn.completed')) {
      codexTurns.push(line);
    }
  };
  return {
    add(chunk) {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) take(line);
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
