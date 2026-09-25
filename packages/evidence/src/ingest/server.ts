// The OTLP/JSON receiver of the ingester (§11): `node:http`, no framework. 200 only once the
// transaction committed; 503 when anything fails, so the Collector retries from its persistent queue.
// Metrics are accepted and discarded. Bodies up to 64 MiB, plain or gzip.

import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';
import type { Pool } from 'pg';
import { type IngestReceipt, ingest, parseRequest } from './ingest.ts';

export const MAX_BODY_BYTES = 64 * 1024 * 1024;

export type IngestServerOptions = {
  pool: Pool;
  host: string;
  port: number;
  onReceipt?: (receipt: IngestReceipt) => void;
  onError?: (error: unknown) => void;
};

export type IngestServer = { server: Server; port: number; close(): Promise<void> };

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLarge('Body larger than 64 MiB.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

const ROUTES = new Set(['/v1/traces', '/v1/logs', '/v1/metrics']);

export async function handle(options: IngestServerOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? '').split('?')[0] ?? '';
  if (!ROUTES.has(path)) return reply(res, 404, { error: 'Not found.' });
  if (req.method !== 'POST') return reply(res, 405, { error: 'POST only.' });
  let raw: Buffer;
  try {
    raw = await readBody(req);
    if ((req.headers['content-encoding'] ?? '').toLowerCase() === 'gzip') raw = gunzipSync(raw);
  } catch (error) {
    if (error instanceof BodyTooLarge) return reply(res, 413, { error: error.message });
    return reply(res, 400, { error: 'Unreadable body.' });
  }
  if (path === '/v1/metrics') return reply(res, 200, {});
  let request: unknown;
  try {
    request = JSON.parse(raw.toString('utf8'));
  } catch {
    return reply(res, 400, { error: 'The body is not JSON.' });
  }
  const parsed = parseRequest(request);
  if (parsed.kind === null) return reply(res, 400, { error: 'Neither resourceSpans nor resourceLogs.' });
  try {
    const receipt = await ingest(options.pool, parsed, 'collector');
    options.onReceipt?.(receipt);
    // The OTLP export response: an empty partial-success means everything was accepted.
    return reply(res, 200, {});
  } catch (error) {
    options.onError?.(error);
    return reply(res, 503, { error: 'The evidence base did not accept the batch; retry.' });
  }
}

export function startIngestServer(options: IngestServerOptions): Promise<IngestServer> {
  const server = createServer((req, res) => {
    handle(options, req, res).catch((error: unknown) => {
      options.onError?.(error);
      if (!res.headersSent) reply(res, 503, { error: 'Unexpected failure; retry.' });
    });
  });
  server.requestTimeout = 120_000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      resolve({
        server,
        port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((e) => (e ? fail(e) : done()));
            server.closeAllConnections();
          }),
      });
    });
  });
}
