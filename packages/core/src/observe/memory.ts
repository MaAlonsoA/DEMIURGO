// The observer of the tests: the same SDK, exporting into memory as each note ends, so a test sees
// exactly what the OTLP observer would send. `toOtlpJson` serializes it with the exporter's own
// transformer: the fixtures of the evidence ingester come from here.

import { JsonLogsSerializer, JsonTraceSerializer } from '@opentelemetry/otlp-transformer';
import { InMemoryLogRecordExporter } from '@opentelemetry/sdk-logs';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { type Logger, silentLogger } from '../services.ts';
import { type ReadableLogRecord, type ReadableSpan, type SdkObserver, createSdkObserver } from './core.ts';
import type { ObserveOptions } from './observer.ts';

export type LogRecordShape = ReadableLogRecord;

export type MemoryObserver = SdkObserver & {
  spans(): ReadableSpan[];
  logs(): ReadonlyArray<LogRecordShape>;
  reset(): void;
  /** OTLP/JSON, as the exporter would put it on the wire. */
  toOtlpJson(): { traces: unknown; logs: unknown };
};

export type MemoryObserverOptions = Partial<ObserveOptions> & { logger?: Logger; clock?: () => Date };

export function createMemoryObserver(options: MemoryObserverOptions = {}): MemoryObserver {
  const spanExporter = new InMemorySpanExporter();
  const logExporter = new InMemoryLogRecordExporter();
  const { logger, clock, ...given } = options;
  const base = createSdkObserver({
    options: { mode: 'otlp', endpoint: '', environment: 'test', serviceVersion: 'test', instance: 'test', ...given },
    logger: logger ?? silentLogger,
    ...(clock ? { clock } : {}),
    batch: false,
    spanExporter,
    logExporter,
  });
  const decoder = new TextDecoder();
  const toJson = (bytes: Uint8Array | undefined): unknown => (bytes ? JSON.parse(decoder.decode(bytes)) : null);
  return {
    ...base,
    spans: () => spanExporter.getFinishedSpans(),
    logs: () => logExporter.getFinishedLogRecords(),
    reset: () => {
      spanExporter.reset();
      logExporter.reset();
      base.resetTextCache();
    },
    toOtlpJson: () => ({
      traces: toJson(JsonTraceSerializer.serializeRequest(spanExporter.getFinishedSpans())),
      logs: toJson(JsonLogsSerializer.serializeRequest(logExporter.getFinishedLogRecords())),
    }),
  };
}
