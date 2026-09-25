// The operation CLI (§11): replay of the archive, derive, retention on the raw tables only, check
// against an operational-like base, ask with a stored question, and the partitions.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ask, formatTable, prepareQuestion } from '../src/ask.ts';
import { checkAgainstOperational } from '../src/check.ts';
import { parseArgs } from '../src/cli.ts';
import { ensureMonthPartitions } from '../src/db/migrator.ts';
import { deriveAll } from '../src/derive.ts';
import { replayFile } from '../src/replay.ts';
import { RAW_TABLES, dropPartitions, parseMonth, rawPartitionsBefore } from '../src/retention.ts';
import { IDS } from './fixtures/ids.ts';
import { type EvidenceDatabase, count, createEvidenceDatabase, useEvidenceDatabase } from './support/db.ts';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const base = useEvidenceDatabase();
let archive: string;

const cli = (args: string[]) =>
  run(process.execPath, [CLI, ...args], {
    env: { ...process.env, DEMIURGO_EVIDENCE_DATABASE_URL: base().url },
    encoding: 'utf8',
  });

beforeAll(async () => {
  const f = JSON.parse(await readFile(new URL('./fixtures/interaction.otlp.json', import.meta.url), 'utf8')) as {
    traces: unknown;
    logs: unknown;
  };
  const dir = await mkdtemp(join(tmpdir(), 'dmg-evidence-'));
  archive = join(dir, 'otlp-2026-09-26.jsonl');
  // The Collector's archive: one export request per line, traces and logs interleaved.
  await writeFile(archive, `${JSON.stringify(f.traces)}\n${JSON.stringify(f.logs)}\n\n`, 'utf8');
});

describe('replay', () => {
  it('ingests every line of an archive file, once', async () => {
    const summary = await replayFile(base().pool, archive);
    expect(summary).toMatchObject({ lines: 2, ingested: 2, skipped: 0 });
    expect(summary.receipts.map((r) => r.origin)).toEqual(['replay:otlp-2026-09-26.jsonl', 'replay:otlp-2026-09-26.jsonl']);
    expect(await count(base().pool, 'spans')).toBe(17);
    expect(await count(base().pool, 'runs')).toBe(2);
    const spans = await count(base().pool, 'spans');
    const texts = await count(base().pool, 'texts');
    await replayFile(base().pool, archive);
    expect(await count(base().pool, 'spans')).toBe(spans);
    expect(await count(base().pool, 'texts')).toBe(texts);
    expect(await count(base().pool, 'ingest_receipts')).toBe(4);
  });
});

describe('derive', () => {
  it('produces human.accepted for the proposal.accept whose journal names a batch of a known run, once', async () => {
    await base().pool.query('delete from evaluations');
    const client = await base().pool.connect();
    try {
      expect(await deriveAll(client)).toBe(1);
      expect(await deriveAll(client)).toBe(0);
    } finally {
      client.release();
    }
    const { rows } = await base().pool.query<Record<string, unknown>>('select * from evaluations');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      target_type: 'run',
      target_id: IDS.run1,
      name: 'human.accepted',
      score: 1,
      source: 'human',
      by_actor: 'human:ana',
    });
  });

  it('a retry with an override scores the original run as retried on another engine', async () => {
    const trace = 'f'.repeat(32);
    const at = new Date().toISOString();
    await base().pool.query('select ensure_month_partitions_at($1::timestamptz[])', [[at]]);
    await base().pool.query(
      `insert into commands (trace_id, span_id, command, actor, entity_type, entity_id, outcome, started_at, ended_at)
       values ($1, 'aaaaaaaaaaaaaaaa', 'run.retry', 'human:ana', 'ai_run', $2, 'ok', $3, $3)`,
      [trace, IDS.run2, at],
    );
    await base().pool.query(
      `insert into journal_payloads (trace_id, span_id, at, event_seq, before, after) values ($1, 'aaaaaaaaaaaaaaaa', $2, 9, null, $3)`,
      [
        trace,
        at,
        JSON.stringify({
          retry_of: IDS.run1,
          engine: { provider: 'codex', model: 'gpt-5-codex' },
          override: { provider: 'codex', model: 'gpt-5-codex' },
        }),
      ],
    );
    const client = await base().pool.connect();
    try {
      expect(await deriveAll(client)).toBe(1);
    } finally {
      client.release();
    }
    const { rows } = await base().pool.query<Record<string, unknown>>(
      "select * from evaluations where name = 'human.retried_other_engine'",
    );
    expect(rows[0]).toMatchObject({ target_id: IDS.run1, score: 0, trace_id: trace });
  });
});

const month = (d: Date) => `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

describe('partitions', () => {
  it('ensure_month_partitions creates the current and the next month for every partitioned table, idempotently', async () => {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const { rows } = await base().pool.query<{ relname: string }>(
      "select relname from pg_class where relname ~ '^(spans|commands|provider_events|cli_requests|journal_payloads|unmapped_records)_[0-9]{4}_[0-9]{2}$' order by relname",
    );
    for (const t of ['spans', 'commands', 'provider_events', 'cli_requests', 'journal_payloads', 'unmapped_records']) {
      expect(rows.map((r) => r.relname)).toContain(`${t}_${month(now)}`);
      expect(rows.map((r) => r.relname)).toContain(`${t}_${month(next)}`);
    }
    expect(await ensureMonthPartitions(base().pool, 1)).toEqual([]);
    const created = await ensureMonthPartitions(base().pool, 3);
    expect(created.length).toBe(12);
  });
});

describe('retention', () => {
  it('refuses without --yes, lists what it would drop, and drops only raw partitions older than the month', async () => {
    await base().pool.query("select ensure_month_partitions_at(array['2025-01-15'::timestamptz, '2025-02-15'::timestamptz])");
    const old = await rawPartitionsBefore(base().pool, '2025-02');
    expect(old.map((p) => p.partition).sort()).toEqual(RAW_TABLES.map((t) => `${t}_2025_01`).sort());
    // The CLI without --yes: nothing dropped.
    const { stdout } = await cli(['retention', '--raw-before', '2025-02']);
    expect(stdout).toContain('would drop provider_events_2025_01');
    expect(stdout).toContain('Nothing dropped: add --yes to drop them.');
    expect(await rawPartitionsBefore(base().pool, '2025-02')).toHaveLength(4);
    await dropPartitions(base().pool, old);
    expect(await rawPartitionsBefore(base().pool, '2025-02')).toHaveLength(0);
    // Spans and commands of the same month are untouched: never raw.
    const { rows } = await base().pool.query<{ relname: string }>(
      "select relname from pg_class where relname in ('spans_2025_01', 'commands_2025_01')",
    );
    expect(rows).toHaveLength(2);
    expect(() => parseMonth('2025-1')).toThrow('YYYY-MM');
  });
});

describe('check', () => {
  let operational: EvidenceDatabase;
  beforeAll(async () => {
    operational = await createEvidenceDatabase(false);
    await operational.pool.query('create table ai_runs (id uuid primary key, state text)');
    await operational.pool.query('insert into ai_runs (id, state) values ($1, $2), ($3, $4)', [
      IDS.run1,
      'applied',
      '0199a000-0000-7000-8000-00000000c009',
      'requested',
    ]);
  });
  afterAll(async () => {
    await operational.drop();
  });

  it('lists the runs missing on each side', async () => {
    const report = await checkAgainstOperational(base().pool, operational.url);
    expect(report).toEqual({
      operational: 2,
      evidence: 2,
      missingInEvidence: ['0199a000-0000-7000-8000-00000000c009'],
      onlyInEvidence: [IDS.run2],
    });
  });
});

describe('ask', () => {
  it('binds :params, and session-reuse lists the calls of a run and of its base chain', async () => {
    const prepared = prepareQuestion('select :run::uuid as r, :other, :run', { run: 'a', other: 'b' });
    expect(prepared.text).toBe('select $1::uuid as r, $2, $1');
    expect(prepared.values).toEqual(['a', 'b']);
    expect(() => prepareQuestion('select :missing', {})).toThrow('--missing');
    const { columns, rows } = await ask(base().pool, 'session-reuse', { run: IDS.run2 });
    expect(columns).toContain('verdict');
    expect(rows.map((r) => [r[columns.indexOf('run_id')], r[columns.indexOf('mode')], r[columns.indexOf('verdict')]])).toEqual([
      [IDS.run1, 'fresh', 'none'],
      [IDS.run2, 'resumed', 'reused'],
    ]);
    const table = formatTable(columns, rows);
    expect(table).toContain('reused');
    expect(table).toContain('(2 rows)');
  });

  it('the CLI prints the table', async () => {
    const { stdout, stderr } = await cli(['ask', 'session-reuse', '--run', IDS.run2]);
    expect(stderr).toContain('Did this run resume a conversation session');
    expect(stdout).toContain('cache_ratio');
    expect(stdout).toContain('0.842');
    expect(stdout).toContain('(2 rows)');
  });

  it('parseArgs reads positionals, options and flags', () => {
    expect(parseArgs(['ask', 'session-reuse', '--run', 'x', '--yes'])).toEqual({
      command: 'ask',
      positional: ['session-reuse'],
      options: { run: 'x', yes: 'true' },
    });
  });
});
