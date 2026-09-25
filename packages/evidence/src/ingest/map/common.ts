// What every mapper shares: the transaction, the counters of the batch, and small readers of
// attribute values that never throw (a bad value is a null column, never a lost note).

import { createHash } from 'node:crypto';
import { RESOURCE, SERVICE_NAME } from '@demiurgo/domain';
import type { PoolClient } from 'pg';
import type { Attrs, FlatLog, FlatSpan } from '../otlp.ts';

export type MapContext = {
  client: PoolClient;
  counts: { upserted: number; unmapped: number };
  /** `${traceId}:${spanId}` of every command touched in this batch: the derived evaluations run for them. */
  touchedCommands: Set<string>;
  origin: string;
};

export type SpanSource = 'demiurgo' | 'claude_code' | 'codex' | 'other';

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const str = (attrs: Attrs, key: string): string | null => {
  const v = attrs[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
};

export const num = (attrs: Attrs, key: string): number | null => {
  const v = attrs[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

export const int = (attrs: Attrs, key: string): number | null => {
  const v = num(attrs, key);
  return v === null ? null : Math.trunc(v);
};

export const bool = (attrs: Attrs, key: string): boolean | null => {
  const v = attrs[key];
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
};

/** A UUID (any version) or null: the uuid columns never see anything else. */
export const uuid = (v: unknown): string | null => (typeof v === 'string' && RE_UUID.test(v) ? v.toLowerCase() : null);
export const uuidAttr = (attrs: Attrs, key: string): string | null => uuid(attrs[key]);

/** The list attribute as a string array (a single string counts as one element). */
export const list = (attrs: Attrs, key: string): string[] | null => {
  const v = attrs[key];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') return [v];
  return null;
};

/** A JSON attribute (a string the emitter serialized) as a value; a non-JSON string is kept as is. */
export const jsonAttr = (attrs: Attrs, key: string): unknown => {
  const v = attrs[key];
  if (v === undefined) return null;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return v;
  }
};

/** A value for a jsonb parameter (pg needs the string), or null. */
export const jsonb = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));

/** A timestamp attribute (ISO string or Unix milliseconds) as ISO, or null. */
export const stampAttr = (attrs: Attrs, key: string): string | null => {
  const v = attrs[key];
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString();
  if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return v;
  return null;
};

export const durationMs = (start: string, end: string | null): number | null =>
  end === null ? null : Math.max(0, Date.parse(end) - Date.parse(start));

/** Which service emitted the note (§11): ours, a CLI, or something else. */
export function sourceOf(resource: Attrs): SpanSource {
  const name = str(resource, RESOURCE.serviceName) ?? '';
  if (name === SERVICE_NAME) return 'demiurgo';
  const lower = name.toLowerCase();
  if (lower.includes('claude')) return 'claude_code';
  if (lower.includes('codex')) return 'codex';
  return 'other';
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, canonical(o[k])]),
    );
  }
  return v;
}

/** SHA-256 of the record with its keys sorted: the id of a log record that carries none (§11). */
export function recordHash(record: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(record)) ?? 'null', 'utf8')
    .digest('hex');
}

/** Keeps a note the ingester could not map, by its own fingerprint, so a replay does not double it. */
export async function unmapped(
  ctx: MapContext,
  kind: 'span' | 'log',
  reason: string,
  record: FlatSpan | FlatLog,
  at: string,
): Promise<void> {
  await ctx.client.query(
    `insert into unmapped_records (id, at, kind, reason, record) values ($1, $2, $3, $4, $5)
     on conflict (id, at) do nothing`,
    [recordHash(record), at, kind, reason, JSON.stringify(record)],
  );
  ctx.counts.unmapped += 1;
}

export function touchCommand(ctx: MapContext, traceId: string, spanId: string): void {
  ctx.touchedCommands.add(`${traceId}:${spanId}`);
}
