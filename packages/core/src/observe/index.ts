// Observation notes (spec docs/superpowers/specs/2026-09-26-motor-observabilidad-design.md §7.1).

import type { Logger } from '../services.ts';
import { noopObserver } from './noop.ts';
import type { ObserveOptions, Observer } from './observer.ts';
import { createOtlpObserver } from './otlp.ts';

export * from './ids.ts';
export * from './observer.ts';
export {
  DROP_LOG_INTERVAL_MS,
  INERT_SPAN_ID,
  LOG_QUEUE,
  type ReadableLogRecord,
  type ReadableSpan,
  SPAN_QUEUE,
  type SdkObserver,
  TEXT_CACHE_SIZE,
  errorTypeOf,
  inertHandle,
  remoteSpanContext,
} from './core.ts';
export { type LogRecordShape, type MemoryObserver, type MemoryObserverOptions, createMemoryObserver } from './memory.ts';
export { noopObserver } from './noop.ts';
export { createOtlpObserver } from './otlp.ts';
export { traceParentOf } from './trace-contexts.ts';

/** The observer of a process, by `DEMIURGO_OBSERVE`. */
export function createObserver(options: ObserveOptions, logger: Logger): Observer {
  return options.mode === 'off' ? noopObserver : createOtlpObserver({ ...options, logger });
}
