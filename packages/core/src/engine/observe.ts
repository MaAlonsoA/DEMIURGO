// The span of a durable step (spec §7.4): it hangs from the command that created the entity of the
// flow, through `trace_contexts`, so a step that resumes after a restart still joins the interaction
// that asked for it; with no row it is a root. The attempt counts the repetitions of the same step
// in the same workflow in this process (DBOS retries a step in place); after a restart it starts
// at 1 again and the ingester tells them apart by time.

import { DBOS } from '@dbos-inc/dbos-sdk';
import { ATTR, type EntityName } from '@demiurgo/domain';
import type { Attributes, SpanHandle } from '../observe/observer.ts';
import { traceParentOf } from '../observe/trace-contexts.ts';
import type { Services } from '../services.ts';

export type StepEntity = { type: EntityName; id: string };

const attempts = new Map<string, number>();
/** Entries kept: a step of a workflow that finished long ago is forgotten. */
const MAX_TRACKED_STEPS = 10_000;

/** Only for tests: forgets every attempt counted so far. */
export function resetStepAttempts(): void {
  attempts.clear();
}

function nextAttempt(key: string): number {
  const n = (attempts.get(key) ?? 0) + 1;
  attempts.delete(key);
  attempts.set(key, n);
  if (attempts.size > MAX_TRACKED_STEPS) {
    const oldest = attempts.keys().next().value;
    if (oldest !== undefined) attempts.delete(oldest);
  }
  return n;
}

/** The id of the workflow this step runs in, or null outside DBOS (the inline engine). */
function currentWorkflowId(): string | null {
  try {
    return DBOS.workflowID ?? null;
  } catch {
    return null;
  }
}

/**
 * Runs the body of a step inside its span. `entity` is the entity of the flow (`ai_run` for runs,
 * `message` for answers, `knowledge_update` for updates, `batch` for ideas); `resultOf` gives the
 * `demiurgo.step.result` when the step has one.
 */
export async function stepSpan<T>(
  s: Services,
  step: string,
  entity: StepEntity | null,
  attrs: Attributes,
  fn: (span: SpanHandle) => Promise<T>,
  resultOf?: (result: T) => string | undefined,
): Promise<T> {
  const workflowId = currentWorkflowId();
  const attempt = nextAttempt(`${workflowId ?? entity?.id ?? ''}:${step}`);
  const parent = entity ? await traceParentOf(s.db, entity.type, entity.id).catch(() => undefined) : undefined;
  return s.observer.span(
    step,
    { ...attrs, [ATTR.workflowId]: workflowId, [ATTR.stepAttempt]: attempt },
    async (span) => {
      const result = await fn(span);
      const outcome = resultOf?.(result);
      if (outcome !== undefined) span.setAttributes({ [ATTR.stepResult]: outcome });
      return result;
    },
    parent,
  );
}

/** A root of the system (§7.2): reconciliation at startup and deferred starts with no interaction. */
export function systemInteraction<T>(s: Services, component: string, fn: () => Promise<T>): Promise<T> {
  return s.observer.interaction(
    { channel: 'system', actor: `system:${component}`, actorType: 'system', command: component },
    () => fn(),
  );
}
