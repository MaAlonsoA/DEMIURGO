// The real observer: batched export over OTLP/HTTP to the collector at `DEMIURGO_OTLP_ENDPOINT`.

import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import type { Logger } from '../services.ts';
import { SPAN_QUEUE, type SdkObserver, createSdkObserver } from './core.ts';
import type { ObserveOptions } from './observer.ts';

export function createOtlpObserver(options: ObserveOptions & { logger: Logger }): SdkObserver {
  const base = options.endpoint.replace(/\/+$/, '');
  return createSdkObserver({
    options,
    logger: options.logger,
    batch: true,
    spanExporter: new OTLPTraceExporter({ url: `${base}/v1/traces`, timeoutMillis: SPAN_QUEUE.exportTimeoutMillis }),
    logExporter: new OTLPLogExporter({ url: `${base}/v1/logs`, timeoutMillis: SPAN_QUEUE.exportTimeoutMillis }),
  });
}
