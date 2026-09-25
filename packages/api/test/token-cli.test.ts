// `pnpm cli issue-agent-token`: an agent key issued from the terminal is a person's act, so the
// person's password is read from stdin and checked; the secret is printed once and only works for
// that project.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
});
