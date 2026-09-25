// `pnpm evidence replay <files…>`: re-ingests the Collector's file archive (§12, §14.1), one OTLP/JSON
// export request per line, each line its own transaction and receipt (`replay:<file>`). Idempotent.

import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import type { Pool } from 'pg';
import { type IngestReceipt, ingest, parseRequest } from './ingest/ingest.ts';

export type ReplaySummary = { file: string; lines: number; ingested: number; skipped: number; receipts: IngestReceipt[] };

export async function replayFile(pool: Pool, file: string, onReceipt?: (r: IngestReceipt) => void): Promise<ReplaySummary> {
  const origin = `replay:${basename(file)}`;
  const source = file.endsWith('.gz') ? createReadStream(file).pipe(createGunzip()) : createReadStream(file);
  const lines = createInterface({ input: source, crlfDelay: Number.POSITIVE_INFINITY });
  const summary: ReplaySummary = { file, lines: 0, ingested: 0, skipped: 0, receipts: [] };
  for await (const line of lines) {
    const text = line.trim();
    if (text === '') continue;
    summary.lines += 1;
    let request: unknown;
    try {
      request = JSON.parse(text);
    } catch {
      summary.skipped += 1;
      continue;
    }
    const parsed = parseRequest(request);
    if (parsed.kind !== 'traces' && parsed.kind !== 'logs') {
      summary.skipped += 1;
      continue;
    }
    const receipt = await ingest(pool, parsed, origin);
    summary.ingested += 1;
    summary.receipts.push(receipt);
    onReceipt?.(receipt);
  }
  return summary;
}
