// `pnpm evidence check --operational <url>` (§14.1, §14.3): the runs the operational base knows
// against the runs the evidence describes. Read-only on both sides; DEMIURGO never runs it.

import { Client, type Pool } from 'pg';

export type CheckReport = {
  operational: number;
  evidence: number;
  /** Runs of the operational base without a row in `runs`. */
  missingInEvidence: string[];
  /** Runs the evidence describes that the operational base does not know (a restored snapshot, for example). */
  onlyInEvidence: string[];
};

export async function checkAgainstOperational(pool: Pool, operationalUrl: string): Promise<CheckReport> {
  const client = new Client({ connectionString: operationalUrl });
  await client.connect();
  let operational: string[];
  try {
    await client.query('set default_transaction_read_only = on');
    const { rows } = await client.query<{ id: string }>('select id::text as id from ai_runs order by id');
    operational = rows.map((r) => r.id.toLowerCase());
  } finally {
    await client.end();
  }
  const { rows } = await pool.query<{ run_id: string }>('select run_id::text as run_id from runs order by run_id');
  const evidence = rows.map((r) => r.run_id.toLowerCase());
  const inEvidence = new Set(evidence);
  const inOperational = new Set(operational);
  return {
    operational: operational.length,
    evidence: evidence.length,
    missingInEvidence: operational.filter((id) => !inEvidence.has(id)),
    onlyInEvidence: evidence.filter((id) => !inOperational.has(id)),
  };
}
