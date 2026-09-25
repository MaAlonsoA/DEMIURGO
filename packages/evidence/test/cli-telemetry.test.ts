// Phase 4 of the evidence base (spec §5.4, §13, §17): the transcript chunks of the sessions, the
// transcript columns of calls and sessions, the API requests of the CLIs next to the official usage
// (`v_cli_requests_by_call`), and `v_session_reuse` preferring the per-request cache figures.

import { readFile } from 'node:fs/promises';
import { createMemoryObserver } from '@demiurgo/core';
import { ATTR, SPAN, sha256Hex } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { ask } from '../src/ask.ts';
import { ingest } from '../src/ingest/ingest.ts';
import { parseLogs, parseTraces } from '../src/ingest/otlp.ts';
import { IDS } from './fixtures/ids.ts';
import { count, useEvidenceDatabase } from './support/db.ts';

type Fixture = { traces?: unknown; logs?: unknown };

const fixture = async (name: string): Promise<Fixture> =>
  JSON.parse(await readFile(new URL(`./fixtures/${name}.otlp.json`, import.meta.url), 'utf8')) as Fixture;

const base = useEvidenceDatabase();

const CHUNKS = ['{"type":"user","text":"What is the purpose?"}\n', '{"type":"assistant","text":"To design itself."}\n'] as const;
const TRANSCRIPT_PATH = 'C:\\Users\\ana\\.claude\\projects\\C--Users-ana-sessions-claude-9bdc7f28\\4d3c2b1a.jsonl';
const CALL3 = '0199a000-0000-7000-8000-00000000d003';
const CALL4 = '0199a000-0000-7000-8000-00000000d004';

/** What `callProvider` emits for a session's transcript (§5.4): the chunks, and the call span with the file. */
async function transcriptNotes(): Promise<{ traces: unknown; logs: unknown }> {
  const o = createMemoryObserver({ environment: 'test', serviceVersion: 'fixture', instance: '8100' });
  const emit = async (callId: string, chunk: string, offset: number, extra: Record<string, string | number> = {}) =>
    o.span(
      `${SPAN.invokeAgent} explorer`,
      {
        [ATTR.callId]: callId,
        [ATTR.sessionId]: IDS.session,
        [ATTR.sessionMode]: 'resumed',
        [ATTR.providerId]: 'claude',
        [ATTR.genAiAgentName]: 'explorer',
        [ATTR.transcriptPath]: TRANSCRIPT_PATH,
        ...extra,
      },
      async () => {
        o.text('transcript_chunk', chunk, {
          [ATTR.sessionId]: IDS.session,
          [ATTR.transcriptOffset]: offset,
          [ATTR.transcriptPath]: TRANSCRIPT_PATH,
          [ATTR.callId]: callId,
        });
      },
    );
  await emit(CALL3, CHUNKS[0], 0);
  await emit(CALL4, CHUNKS[1], Buffer.byteLength(CHUNKS[0]), {
    [ATTR.transcriptSize]: Buffer.byteLength(CHUNKS[0] + CHUNKS[1]),
    [ATTR.transcriptHash]: sha256Hex(CHUNKS[0] + CHUNKS[1]),
  });
  // A chunk without a session: kept as a text, but no chunk row.
  o.text('transcript_chunk', 'orphan\n', { [ATTR.transcriptOffset]: 0 });
  return o.toOtlpJson();
}

beforeAll(async () => {
  const interaction = await fixture('interaction');
  await ingest(base().pool, { spans: parseTraces(interaction.traces), logs: parseLogs(interaction.logs) }, 'collector');
  const claude = await fixture('claude-code');
  await ingest(base().pool, { spans: parseTraces(claude.traces), logs: parseLogs(claude.logs) }, 'collector');
  const codex = await fixture('codex');
  await ingest(base().pool, { logs: parseLogs(codex.logs) }, 'collector');
});

describe('transcripts', () => {
  it('each transcript_chunk text becomes a row of transcript_chunks by session and offset, once', async () => {
    const notes = await transcriptNotes();
    // Chunks first: the order of arrival never matters (§11).
    await ingest(base().pool, { logs: parseLogs(notes.logs) }, 'collector');
    await ingest(base().pool, { spans: parseTraces(notes.traces) }, 'collector');
    const { rows } = await base().pool.query<Record<string, unknown>>(
      'select session_id, "offset", call_id, chars, text_hash from transcript_chunks order by "offset"',
    );
    expect(rows).toEqual([
      {
        session_id: IDS.session,
        offset: '0',
        call_id: CALL3,
        chars: CHUNKS[0].length,
        text_hash: sha256Hex(CHUNKS[0]),
      },
      {
        session_id: IDS.session,
        offset: String(Buffer.byteLength(CHUNKS[0])),
        call_id: CALL4,
        chars: CHUNKS[1].length,
        text_hash: sha256Hex(CHUNKS[1]),
      },
    ]);
    // The texts themselves, by fingerprint, with the orphan among them.
    expect(await count(base().pool, 'texts', "kind = 'transcript_chunk'")).toBe(3);
    expect(await count(base().pool, 'unmapped_records', "reason like 'transcript chunk without%'")).toBe(1);
    // Again (a re-emission after a restart): the same rows.
    await ingest(base().pool, { logs: parseLogs(notes.logs) }, 'collector');
    expect(await count(base().pool, 'transcript_chunks')).toBe(2);
  });

  it('the call keeps the transcript path, size and hash, and the session its path', async () => {
    const call = await base().pool.query<Record<string, unknown>>(
      'select transcript_path, transcript_size, transcript_hash from provider_calls where call_id = $1',
      [CALL4],
    );
    expect(call.rows[0]).toEqual({
      transcript_path: TRANSCRIPT_PATH,
      transcript_size: String(Buffer.byteLength(CHUNKS[0] + CHUNKS[1])),
      transcript_hash: sha256Hex(CHUNKS[0] + CHUNKS[1]),
    });
    const session = await base().pool.query<Record<string, unknown>>(
      'select transcript_path from sessions where session_id = $1',
      [IDS.session],
    );
    expect(session.rows[0]).toEqual({ transcript_path: TRANSCRIPT_PATH });
  });
});

describe('the CLI requests next to the official usage', () => {
  it('v_cli_requests_by_call counts the requests of each call, sums their tokens and gives the delta against the call', async () => {
    const { rows } = await base().pool.query<Record<string, unknown>>(
      'select * from v_cli_requests_by_call where call_id in ($1, $2) order by started_at',
      [IDS.call1, IDS.call2],
    );
    expect(rows).toHaveLength(2);
    // Claude Code: one api_request with the same figures the CLI printed in its result.
    expect(rows[0]).toMatchObject({
      call_id: IDS.call1,
      source: 'claude_code',
      requests: '1',
      errors: '0',
      max_attempt: 1,
      telemetry_duration_ms: 2300,
      telemetry_uncached_input: '9000',
      telemetry_cache_read: '0',
      telemetry_cache_write: '1000',
      telemetry_output: '400',
      telemetry_cost_usd: 0.042,
      official_uncached_input: '9000',
      official_cache_read: '0',
      official_cache_write: '1000',
      official_output: '400',
      delta_uncached: '0',
      delta_cache_read: '0',
      delta_cache_write: '0',
      delta_output: '0',
    });
    expect(rows[0]?.first_request_at).toEqual(rows[0]?.last_request_at);
    // Codex: the request event carries the time, the sse_event the tokens; the official call said 500 cache writes.
    expect(rows[1]).toMatchObject({
      call_id: IDS.call2,
      source: 'codex',
      requests: '1',
      errors: '0',
      max_attempt: 1,
      telemetry_duration_ms: 1480,
      telemetry_uncached_input: '1000',
      telemetry_cache_read: '8000',
      telemetry_cache_write: null,
      telemetry_output: '300',
      telemetry_reasoning: '120',
      official_uncached_input: '1000',
      official_cache_read: '8000',
      official_cache_write: '500',
      delta_uncached: '0',
      delta_cache_read: '0',
      delta_cache_write: null,
      delta_output: '0',
    });
    expect(Date.parse(String(rows[1]?.last_request_at))).toBeGreaterThanOrEqual(Date.parse(String(rows[1]?.first_request_at)));
    // A call the CLI reported nothing about still appears, with zero requests.
    const { rows: none } = await base().pool.query<Record<string, unknown>>(
      'select requests, telemetry_uncached_input, delta_uncached from v_cli_requests_by_call where call_id = $1',
      [CALL3],
    );
    expect(none[0]).toEqual({ requests: '0', telemetry_uncached_input: null, delta_uncached: null });
  });

  it('v_session_reuse uses the per-request cache figures when the CLI reported them, else the call figures', async () => {
    const { rows } = await base().pool.query<Record<string, unknown>>(
      'select call_id, mode, verdict, cache_ratio, tokens_cache_read, tokens_cache_write, figures_source from v_session_reuse order by started_at',
    );
    expect(rows.map((r) => [r.call_id, r.mode, r.verdict, r.figures_source, r.tokens_cache_read, r.tokens_cache_write])).toEqual([
      [IDS.call1, 'fresh', 'none', 'telemetry', '0', '1000'],
      // Codex never reports cache writes per request: the call's own 500 stays next to the 8000 read.
      [IDS.call2, 'resumed', 'reused', 'telemetry', '8000', '500'],
      [CALL3, 'resumed', 'lost', 'official', null, null],
      [CALL4, 'resumed', 'lost', 'official', null, null],
    ]);
    expect(rows[1]?.cache_ratio).toBeCloseTo(8000 / 9500, 3);
  });

  it('the cli-requests question lists every request under the calls of a run', async () => {
    const { columns, rows } = await ask(base().pool, 'cli-requests', { run: IDS.run2 });
    expect(columns).toEqual(expect.arrayContaining(['call_id', 'event', 'attempt', 'cache_read', 'output', 'error_status']));
    expect(rows.map((r) => [r[columns.indexOf('call_id')], r[columns.indexOf('event')]])).toEqual([
      [IDS.call2, 'codex.api_request'],
      [IDS.call2, 'codex.sse_event'],
    ]);
    const claude = await ask(base().pool, 'cli-requests', { run: IDS.run1 });
    expect(claude.rows.map((r) => [r[claude.columns.indexOf('event')], r[claude.columns.indexOf('cache_write')]])).toEqual([
      ['claude_code.api_request', '1000'],
    ]);
  });
});
