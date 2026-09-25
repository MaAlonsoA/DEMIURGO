// `demiurgo.context.manifest` (§6.3, §9.1) → `context_manifests` + `context_fragments`. Phase 3 emits
// it; the shape is fixed by the domain's `Manifest`, so it is mapped from now on.

import { ATTR, type Manifest, manifestSummary } from '@demiurgo/domain';
import type { FlatLog } from '../otlp.ts';
import { type MapContext, bool, int, jsonAttr, jsonb, str, unmapped, uuidAttr } from './common.ts';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseManifest(body: unknown): Manifest | null {
  let parsed: unknown = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      return null;
    }
  }
  if (!isObject(parsed) || !Array.isArray(parsed.fragments)) return null;
  return parsed as unknown as Manifest;
}

export async function mapManifest(ctx: MapContext, log: FlatLog): Promise<void> {
  const a = log.attributes;
  const packHash = str(a, ATTR.packHash);
  const manifest = parseManifest(log.body);
  if (packHash === null || manifest === null) {
    await unmapped(ctx, 'log', 'manifest without pack hash or fragments', log, log.time);
    return;
  }
  const summary = manifestSummary(manifest);
  await ctx.client.query(
    `insert into context_manifests (pack_hash, pack_id, project_id, builder, role, graph_version, budget, candidates,
       fragments, included_chars, dropped_count, built_trace_id, built_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     on conflict (pack_hash) do update set
       pack_id = coalesce(excluded.pack_id, context_manifests.pack_id),
       project_id = coalesce(excluded.project_id, context_manifests.project_id),
       builder = excluded.builder, role = coalesce(excluded.role, context_manifests.role),
       graph_version = excluded.graph_version, budget = excluded.budget, candidates = excluded.candidates,
       fragments = excluded.fragments, included_chars = excluded.included_chars, dropped_count = excluded.dropped_count,
       built_trace_id = coalesce(context_manifests.built_trace_id, excluded.built_trace_id),
       built_at = least(context_manifests.built_at, excluded.built_at)`,
    [
      packHash,
      uuidAttr(a, ATTR.packId),
      uuidAttr(a, ATTR.projectId),
      str(a, ATTR.packBuilder) ?? manifest.builder,
      str(a, ATTR.packRole),
      int(a, ATTR.graphVersion) ?? manifest.graphVersion,
      jsonb(jsonAttr(a, ATTR.packBudget) ?? manifest.budget),
      manifest.candidates,
      manifest.fragments.length,
      summary.includedChars,
      summary.droppedCount,
      bool(a, ATTR.packReused) ? null : log.traceId,
      bool(a, ATTR.packReused) ? null : log.time,
    ],
  );
  ctx.counts.upserted += 1;
  for (const f of manifest.fragments) {
    await ctx.client.query(
      `insert into context_fragments (pack_hash, seq, section, source_type, source_id, source_version, source_event_seq,
         text_hash, chars, original_chars, decision, reason, score, position)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (pack_hash, seq) do nothing`,
      [
        packHash,
        f.seq,
        f.section,
        f.source?.type ?? null,
        f.source?.id ?? null,
        f.source?.version ?? null,
        f.source?.eventSeq ?? null,
        f.textHash,
        f.chars,
        f.originalChars,
        f.decision,
        f.reason,
        f.score,
        f.position,
      ],
    );
  }
}
