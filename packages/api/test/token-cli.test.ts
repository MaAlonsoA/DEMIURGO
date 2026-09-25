// `pnpm cli issue-agent-token`: an agent key issued from the terminal is a person's act, so the
// person's password is read from stdin and checked; the secret is printed once and only works for
// that project.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { useEphemeralDatabase } from '../../core/test/support/ephemeral-db.ts';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const base = useEphemeralDatabase();

function cli(args: string[], input = '') {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    input,
    encoding: 'utf8',
    env: { ...process.env, DEMIURGO_DATABASE_URL: base().url },
  });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

describe('issue-agent-token', () => {
  it("issues a key in the person's name after checking their password, and refuses a wrong one", () => {
    expect(cli(['create-person', 'ana'], 'a-long-enough-password').code).toBe(0);
    const project = JSON.parse(cli(['create-project', 'Keys']).stdout) as { project_id: string };

    const wrong = cli(['issue-agent-token', project.project_id, 'claude-code', 'ana'], 'not-her-password');
    expect(wrong.code).not.toBe(0);
    expect(wrong.stderr).toMatch(/Incorrect username or password/);

    const issued = cli(['issue-agent-token', project.project_id, 'claude-code', 'ana'], 'a-long-enough-password');
    expect(issued.code).toBe(0);
    const out = JSON.parse(issued.stdout) as { token: string; actor: string; issued_by: string };
    expect(out.token).toMatch(/^dmg_agent_/);
    expect(out.actor).toMatch(/^agent:claude-code:/);
    expect(out.issued_by).toBe('human:ana');
  });

  it('issuing a key does not start the engine: a call the running server has in flight stays running', async () => {
    expect(cli(['create-person', 'bea'], 'a-long-enough-password').code).toBe(0);
    const project = JSON.parse(cli(['create-project', 'Busy']).stdout) as { project_id: string };
    const client = new pg.Client({ connectionString: base().url });
    await client.connect();
    try {
      const { rows } = await client.query<{ id: string }>(
        `insert into agent_calls (agent, agent_version, provider, requested_model, session_mode, prompt_hash, state)
         values ('explorer', 'v', 'simulated', 'm', 'none', 'h', 'running') returning id`,
      );
      expect(cli(['issue-agent-token', project.project_id, 'claude-code', 'bea'], 'a-long-enough-password').code).toBe(0);
      const after = await client.query<{ state: string }>('select state from agent_calls where id = $1', [rows[0]?.id]);
      expect(after.rows[0]?.state).toBe('running');
    } finally {
      await client.end();
    }
  });
});
