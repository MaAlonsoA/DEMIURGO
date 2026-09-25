// The HTTP receiver (§11): 200 only after the commit, 503 when the base is unreachable so the
// Collector retries, metrics discarded, gzip accepted.

import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type IngestServer, startIngestServer } from '../src/ingest/server.ts';
import { count, useEvidenceDatabase } from './support/db.ts';

const base = useEvidenceDatabase();
let server: IngestServer;
let fixture: { traces: unknown; logs: unknown };

const post = (port: number, path: string, body: string | Buffer, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });

beforeAll(async () => {
  fixture = JSON.parse(await readFile(new URL('./fixtures/interaction.otlp.json', import.meta.url), 'utf8')) as typeof fixture;
  server = await startIngestServer({ pool: base().pool, host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await server.close();
});

describe('ingest server', () => {
  it('answers 200 to a valid traces post once the batch is committed, and to logs', async () => {
    const res = await post(server.port, '/v1/traces', JSON.stringify(fixture.traces));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(await count(base().pool, 'spans')).toBeGreaterThan(0);
    const logs = await post(server.port, '/v1/logs', JSON.stringify(fixture.logs));
    expect(logs.status).toBe(200);
    expect(await count(base().pool, 'texts')).toBeGreaterThan(0);
    expect(await count(base().pool, 'ingest_receipts')).toBe(2);
  });

  it('accepts a gzip body', async () => {
    const res = await post(server.port, '/v1/logs', gzipSync(Buffer.from(JSON.stringify(fixture.logs))), {
      'content-encoding': 'gzip',
    });
    expect(res.status).toBe(200);
  });

  it('discards metrics with 200 and rejects what is not OTLP', async () => {
    expect((await post(server.port, '/v1/metrics', '{"resourceMetrics":[]}')).status).toBe(200);
    expect((await post(server.port, '/v1/traces', 'not json')).status).toBe(400);
    expect((await post(server.port, '/v1/traces', '{"nothing":true}')).status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${server.port}/v1/traces`)).status).toBe(405);
    expect((await post(server.port, '/other', '{}')).status).toBe(404);
    expect(await count(base().pool, 'ingest_receipts')).toBe(3);
  });

  it('answers 503 when the evidence base is unreachable, so the Collector retries', async () => {
    const dead = new Pool({
      connectionString: 'postgres://nobody:nothing@127.0.0.1:1/none',
      max: 1,
      connectionTimeoutMillis: 2000,
    });
    dead.on('error', () => undefined);
    const errors: unknown[] = [];
    const broken = await startIngestServer({ pool: dead, host: '127.0.0.1', port: 0, onError: (e) => errors.push(e) });
    try {
      const res = await post(broken.port, '/v1/traces', JSON.stringify(fixture.traces));
      expect(res.status).toBe(503);
      expect(errors).toHaveLength(1);
    } finally {
      await broken.close();
      await dead.end();
    }
  });
});
