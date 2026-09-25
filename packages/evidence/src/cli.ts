// Operation CLI of the evidence stack: `pnpm evidence <subcommand>` (spec §11).
// Configuration from the environment: DEMIURGO_EVIDENCE_DATABASE_URL, DEMIURGO_EVIDENCE_HOST, DEMIURGO_EVIDENCE_PORT.

import { Pool } from 'pg';
import { ask, formatTable, listQuestions } from './ask.ts';
import { checkAgainstOperational } from './check.ts';
import { readConfig } from './config.ts';
import { ensureMonthPartitions, migrate } from './db/migrator.ts';
import { deriveAll } from './derive.ts';
import { startIngestServer } from './ingest/server.ts';
import { replayFile } from './replay.ts';
import { dropPartitions, parseMonth, rawPartitionsBefore } from './retention.ts';

const USAGE = `Usage: pnpm evidence <subcommand>

Subcommands:
  migrate                          apply the evidence base migrations and create this month's and next month's partitions
  serve                            migrate, then run the OTLP/JSON ingester (127.0.0.1:4319 by default)
  replay <archive files...>        re-ingest OTLP/JSON lines from the file archive (idempotent)
  derive                           recompute the derived human evaluations from every command
  retention --raw-before YYYY-MM [--yes]
                                   drop the monthly partitions of the raw tables older than that month;
                                   without --yes it only lists them
  check --operational <url>        compare the runs of the operational base with the evidence base (read-only)
  ask <question> [--param value]   answer a stored question (packages/evidence/questions/<question>.sql)

Environment:
  DEMIURGO_EVIDENCE_DATABASE_URL   postgres://evidence:evidence-local@127.0.0.1:55434/demiurgo_evidence by default
  DEMIURGO_EVIDENCE_HOST, DEMIURGO_EVIDENCE_PORT
`;

export type ParsedArgs = { command: string | undefined; positional: string[]; options: Record<string, string> };

/** `<command> <positional…> --key value --flag`: a `--key` followed by another `--` or nothing is a flag (`true`). */
export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const positional: string[] = [];
  const options: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] ?? '';
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        options[key] = next;
        i += 1;
      } else options[key] = 'true';
    } else positional.push(arg);
  }
  return { command, positional, options };
}

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const err = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

async function main(argv: string[]): Promise<number> {
  const { command, positional, options } = parseArgs(argv);
  const config = readConfig();
  if (!command || command === 'help' || command === '--help') {
    process.stderr.write(USAGE);
    return command ? 0 : 2;
  }
  const pool = new Pool({ connectionString: config.databaseUrl, max: 5 });
  pool.on('error', (e) => err(`pool error: ${e.message}`));
  try {
    switch (command) {
      case 'migrate': {
        const applied = await migrate(pool);
        const partitions = await ensureMonthPartitions(pool, 1);
        out(`Applied ${applied.length} migration(s)${applied.length ? `: ${applied.join(', ')}` : ''}.`);
        out(`Partitions created: ${partitions.length ? partitions.join(', ') : 'none (all present)'}.`);
        return 0;
      }
      case 'serve': {
        const applied = await migrate(pool);
        if (applied.length) out(JSON.stringify({ event: 'migrated', applied }));
        const created = await ensureMonthPartitions(pool, 1);
        if (created.length) out(JSON.stringify({ event: 'partitions', created }));
        const server = await startIngestServer({
          pool,
          host: config.host,
          port: config.port,
          onReceipt: (r) => out(JSON.stringify({ event: 'receipt', ...r })),
          onError: (e) => err(JSON.stringify({ event: 'error', message: e instanceof Error ? e.message : String(e) })),
        });
        out(
          JSON.stringify({
            event: 'listening',
            host: config.host,
            port: server.port,
            database: config.databaseUrl.replace(/:[^:@/]+@/, ':***@'),
          }),
        );
        const hourly = setInterval(() => {
          ensureMonthPartitions(pool, 1)
            .then((c) => {
              if (c.length) out(JSON.stringify({ event: 'partitions', created: c }));
            })
            .catch((e: unknown) => err(JSON.stringify({ event: 'error', message: String(e) })));
        }, 3_600_000);
        await new Promise<void>((resolve) => {
          const stop = (signal: string) => {
            out(JSON.stringify({ event: 'stopping', signal }));
            clearInterval(hourly);
            server.close().then(resolve, resolve);
          };
          process.once('SIGINT', () => stop('SIGINT'));
          process.once('SIGTERM', () => stop('SIGTERM'));
        });
        return 0;
      }
      case 'replay': {
        if (positional.length === 0) throw new Error('replay needs at least one archive file.');
        await migrate(pool);
        for (const file of positional) {
          const s = await replayFile(pool, file, (r) => out(JSON.stringify({ event: 'receipt', ...r })));
          out(`${s.file}: ${s.lines} line(s), ${s.ingested} ingested, ${s.skipped} skipped.`);
        }
        return 0;
      }
      case 'derive': {
        const client = await pool.connect();
        try {
          await client.query('begin');
          const created = await deriveAll(client);
          await client.query('commit');
          out(`Derived evaluations: ${created} new.`);
        } catch (e) {
          await client.query('rollback').catch(() => undefined);
          throw e;
        } finally {
          client.release();
        }
        return 0;
      }
      case 'retention': {
        const before = parseMonth(options['raw-before']);
        const partitions = await rawPartitionsBefore(pool, before);
        if (partitions.length === 0) {
          out(`No raw partitions before ${before}.`);
          return 0;
        }
        for (const p of partitions)
          out(`${options.yes === 'true' ? 'drop' : 'would drop'} ${p.partition} (${p.table}, ${p.month})`);
        if (options.yes !== 'true') {
          out('Nothing dropped: add --yes to drop them.');
          return 0;
        }
        await dropPartitions(pool, partitions);
        out(`Dropped ${partitions.length} partition(s).`);
        return 0;
      }
      case 'check': {
        const url = options.operational;
        if (!url || url === 'true') throw new Error('check needs --operational <url>.');
        const r = await checkAgainstOperational(pool, url);
        out(`Operational runs: ${r.operational}. Evidence runs: ${r.evidence}.`);
        out(`Missing in evidence (${r.missingInEvidence.length}):${r.missingInEvidence.map((id) => `\n  ${id}`).join('')}`);
        out(`Only in evidence (${r.onlyInEvidence.length}):${r.onlyInEvidence.map((id) => `\n  ${id}`).join('')}`);
        return r.missingInEvidence.length === 0 ? 0 : 1;
      }
      case 'ask': {
        const question = positional[0];
        if (!question) {
          out(`Questions: ${(await listQuestions()).join(', ')}`);
          return 2;
        }
        const { columns, rows, header } = await ask(pool, question, options);
        if (header) err(header);
        out(formatTable(columns, rows));
        return 0;
      }
      default:
        err(`Unknown subcommand: ${command}\n`);
        process.stderr.write(USAGE);
        return 2;
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('cli.ts')) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      err(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    },
  );
}
