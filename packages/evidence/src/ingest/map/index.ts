// The dispatcher: one mapper per note type, chosen by the service that emitted the note and by its
// name, with the vocabulary of `@demiurgo/domain`. Whatever does not match is kept as unmapped (§11).

import { LOG, SPAN } from '@demiurgo/domain';
import type { FlatLog, FlatSpan } from '../otlp.ts';
import { mapCall } from './call.ts';
import { mapCliLog, mapCliSpan } from './cli.ts';
import { mapCommand } from './command.ts';
import { type MapContext, sourceOf, unmapped } from './common.ts';
import { mapEvaluation } from './evaluation.ts';
import { mapInteraction } from './interaction.ts';
import { mapJournal } from './journal.ts';
import { mapManifest } from './manifest.ts';
import { mapProviderEvent } from './provider-event.ts';
import { mapRollback } from './rollback.ts';
import { insertSpan, touchInteraction } from './span.ts';
import { STEP_NAMES, mapStep } from './step.ts';
import { mapText } from './text.ts';

export type { MapContext } from './common.ts';

export async function mapSpan(ctx: MapContext, span: FlatSpan): Promise<void> {
  const source = sourceOf(span.resource);
  if (source !== 'demiurgo') {
    await mapCliSpan(ctx, span, source);
    return;
  }
  const head = span.name.split(' ', 1)[0] ?? '';
  if (head === SPAN.interaction) return mapInteraction(ctx, span);
  if (head === SPAN.command) return mapCommand(ctx, span);
  if (head === SPAN.invokeAgent) return mapCall(ctx, span);
  if (STEP_NAMES.has(span.name)) return mapStep(ctx, span);
  // Ours but unknown: kept as a span, and flagged so the gap is visible.
  const inserted = await insertSpan(ctx, span, 'demiurgo');
  await touchInteraction(ctx, span, inserted);
  await unmapped(ctx, 'span', `unknown span name: ${span.name}`, span, span.start);
}

export async function mapLog(ctx: MapContext, log: FlatLog): Promise<void> {
  const source = sourceOf(log.resource);
  if (source !== 'demiurgo') {
    await mapCliLog(ctx, log, source);
    return;
  }
  switch (log.eventName) {
    case LOG.text:
      return mapText(ctx, log);
    case LOG.providerEvent:
      return mapProviderEvent(ctx, log);
    case LOG.journal:
      return mapJournal(ctx, log);
    case LOG.transactionRollback:
      return mapRollback(ctx, log);
    case LOG.contextManifest:
      return mapManifest(ctx, log);
    case LOG.evaluation:
      return mapEvaluation(ctx, log);
    case LOG.dropped:
      return unmapped(ctx, 'log', 'dropped-notice', log, log.time);
    default:
      return unmapped(ctx, 'log', `unknown log record: ${log.eventName ?? '(unnamed)'}`, log, log.time);
  }
}
