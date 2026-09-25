// OTLP/JSON (what the Collector posts with `encoding: json`, and what the file archive keeps, one
// export request per line) parsed into flat records: one per span, one per log record, each with
// the resource attributes of its envelope. Values follow the OTLP JSON mapping: `intValue` is a
// string (int64), timestamps are strings of Unix nanoseconds, ids are hex.

export type Attrs = Record<string, unknown>;

export type FlatSpan = {
  resource: Attrs;
  scope: { name: string | null; version: string | null };
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: string;
  /** ISO 8601 with microseconds. */
  start: string;
  end: string | null;
  status: 'unset' | 'ok' | 'error';
  statusMessage: string | null;
  attributes: Attrs;
  links: { traceId: string; spanId: string; attributes: Attrs }[];
  events: { name: string; time: string; attributes: Attrs }[];
};

export type FlatLog = {
  resource: Attrs;
  scope: { name: string | null; version: string | null };
  traceId: string | null;
  spanId: string | null;
  time: string;
  eventName: string | null;
  body: unknown;
  attributes: Attrs;
  severity: number | null;
  severityText: string | null;
};

type Obj = Record<string, unknown>;

const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asString = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);

/** An OTLP `AnyValue` as a plain JavaScript value. */
export function anyValue(v: unknown): unknown {
  if (!isObject(v)) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('intValue' in v) {
    const raw = v.intValue;
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
      const n = Number(raw);
      return Number.isSafeInteger(n) ? n : raw;
    }
    return null;
  }
  if ('doubleValue' in v) return typeof v.doubleValue === 'number' ? v.doubleValue : Number(v.doubleValue);
  if ('boolValue' in v) return v.boolValue === true;
  if ('arrayValue' in v) return asArray((v.arrayValue as Obj | undefined)?.values).map(anyValue);
  if ('kvlistValue' in v) return keyValues((v.kvlistValue as Obj | undefined)?.values);
  if ('bytesValue' in v) return v.bytesValue;
  return null;
}

/** A list of `KeyValue` as a record. */
export function keyValues(list: unknown): Attrs {
  const out: Attrs = {};
  for (const kv of asArray(list)) {
    if (!isObject(kv) || typeof kv.key !== 'string') continue;
    out[kv.key] = anyValue(kv.value);
  }
  return out;
}

/** Unix nanoseconds (a string or a number) as ISO 8601 with microseconds; null when absent or zero. */
export function nanosToIso(v: unknown): string | null {
  let ns: bigint;
  try {
    if (typeof v === 'string' && /^\d+$/.test(v)) ns = BigInt(v);
    else if (typeof v === 'number' && Number.isFinite(v)) ns = BigInt(Math.round(v));
    else return null;
  } catch {
    return null;
  }
  if (ns <= 0n) return null;
  const ms = ns / 1_000_000n;
  const micros = (ns % 1_000_000n) / 1_000n;
  const iso = new Date(Number(ms)).toISOString();
  return `${iso.slice(0, -1)}${String(micros).padStart(3, '0')}Z`;
}

const SPAN_KINDS = ['unspecified', 'internal', 'server', 'client', 'producer', 'consumer'] as const;

function spanKind(v: unknown): string {
  if (typeof v === 'number') return SPAN_KINDS[v] ?? 'unspecified';
  if (typeof v === 'string') {
    const m = /^SPAN_KIND_(\w+)$/.exec(v);
    return m ? (m[1] ?? '').toLowerCase() : v.toLowerCase();
  }
  return 'unspecified';
}

function statusOf(v: unknown): { status: FlatSpan['status']; message: string | null } {
  if (!isObject(v)) return { status: 'unset', message: null };
  const code = v.code;
  const message = asString(v.message);
  if (code === 1 || code === 'STATUS_CODE_OK') return { status: 'ok', message };
  if (code === 2 || code === 'STATUS_CODE_ERROR') return { status: 'error', message };
  return { status: 'unset', message };
}

function scopeOf(v: unknown): FlatSpan['scope'] {
  return isObject(v) ? { name: asString(v.name), version: asString(v.version) } : { name: null, version: null };
}

/** Every span of an `ExportTraceServiceRequest`. Malformed spans (no ids) are skipped. */
export function parseTraces(request: unknown): FlatSpan[] {
  const out: FlatSpan[] = [];
  if (!isObject(request)) return out;
  for (const rs of asArray(request.resourceSpans)) {
    if (!isObject(rs)) continue;
    const resource = keyValues((rs.resource as Obj | undefined)?.attributes);
    for (const ss of asArray(rs.scopeSpans)) {
      if (!isObject(ss)) continue;
      const scope = scopeOf(ss.scope);
      for (const s of asArray(ss.spans)) {
        if (!isObject(s)) continue;
        const traceId = asString(s.traceId)?.toLowerCase() ?? '';
        const spanId = asString(s.spanId)?.toLowerCase() ?? '';
        const start = nanosToIso(s.startTimeUnixNano);
        if (!traceId || !spanId || !start) continue;
        const { status, message } = statusOf(s.status);
        out.push({
          resource,
          scope,
          traceId,
          spanId,
          parentSpanId: asString(s.parentSpanId)?.toLowerCase() || null,
          name: asString(s.name) ?? '',
          kind: spanKind(s.kind),
          start,
          end: nanosToIso(s.endTimeUnixNano),
          status,
          statusMessage: message,
          attributes: keyValues(s.attributes),
          links: asArray(s.links)
            .filter(isObject)
            .map((l) => ({
              traceId: asString(l.traceId)?.toLowerCase() ?? '',
              spanId: asString(l.spanId)?.toLowerCase() ?? '',
              attributes: keyValues(l.attributes),
            })),
          events: asArray(s.events)
            .filter(isObject)
            .map((e) => ({
              name: asString(e.name) ?? '',
              time: nanosToIso(e.timeUnixNano) ?? start,
              attributes: keyValues(e.attributes),
            })),
        });
      }
    }
  }
  return out;
}

/** Every log record of an `ExportLogsServiceRequest`. */
export function parseLogs(request: unknown): FlatLog[] {
  const out: FlatLog[] = [];
  if (!isObject(request)) return out;
  for (const rl of asArray(request.resourceLogs)) {
    if (!isObject(rl)) continue;
    const resource = keyValues((rl.resource as Obj | undefined)?.attributes);
    for (const sl of asArray(rl.scopeLogs)) {
      if (!isObject(sl)) continue;
      const scope = scopeOf(sl.scope);
      for (const r of asArray(sl.logRecords)) {
        if (!isObject(r)) continue;
        const attributes = keyValues(r.attributes);
        const time = nanosToIso(r.timeUnixNano) ?? nanosToIso(r.observedTimeUnixNano) ?? new Date().toISOString();
        const eventName = asString(r.eventName) ?? asString(attributes['event.name']);
        out.push({
          resource,
          scope,
          traceId: asString(r.traceId)?.toLowerCase() || null,
          spanId: asString(r.spanId)?.toLowerCase() || null,
          time,
          eventName,
          body: r.body === undefined ? null : anyValue(r.body),
          attributes,
          severity: typeof r.severityNumber === 'number' ? r.severityNumber : null,
          severityText: asString(r.severityText),
        });
      }
    }
  }
  return out;
}

/** Whether a parsed JSON document is a traces or a logs export request (an archive line is either). */
export function requestKind(request: unknown): 'traces' | 'logs' | 'metrics' | null {
  if (!isObject(request)) return null;
  if ('resourceSpans' in request) return 'traces';
  if ('resourceLogs' in request) return 'logs';
  if ('resourceMetrics' in request) return 'metrics';
  return null;
}
