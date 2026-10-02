import { describe, expect, it } from 'vitest';
import { environmentFromCi } from '../src/build/environment.ts';
import { appPortOf, pickPort, previewArguments, previewDatabase, publishedPorts, seedNoteOf, seedScriptOf, startLineOf } from '../src/preview/preview.ts';

const CI = `
jobs:
  ci:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: pw
        ports: ['5432:5432']
    env:
      DATABASE_URL: postgres://postgres:pw@localhost:5432/app
    steps:
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:migrate
`;
const PKG = JSON.stringify({ scripts: { build: 'next build', start: 'next start', 'db:seed': 'node seed.js' } });

describe('Preview of the app (pure parts)', () => {
  it('picks the first free port of the range and none when all are taken', () => {
    expect(pickPort([])).toBe(4100);
    expect(pickPort([4100, 4101])).toBe(4102);
    expect(pickPort([4100, 4101], 4100, 4101)).toBeNull();
    expect(publishedPorts('127.0.0.1:4100->3000/tcp, :::8100->8100/tcp')).toEqual([4100, 8100]);
  });

  it('builds before a plain start script and keeps a Playwright webServer command as written', () => {
    const ci = environmentFromCi(CI, { packageJson: PKG });
    expect(startLineOf(ci!, PKG)).toBe('pnpm run build && pnpm start');
    const withServer = environmentFromCi(CI, { playwrightConfig: "export default { webServer: { command: 'node server.js', port: 4000 } };", packageJson: PKG });
    expect(startLineOf(withServer!, PKG)).toBe('node server.js');
    expect(appPortOf(withServer!.start)).toBe(4000);
    expect(appPortOf(ci!.start)).toBe(3000);
  });

  it('detects the seed script and shortens what it printed', () => {
    expect(seedScriptOf(PKG)).toBe('db:seed');
    expect(seedScriptOf(JSON.stringify({ scripts: { seed: 'x', 'db:seed': 'y' } }))).toBe('seed');
    expect(seedScriptOf('{}')).toBeNull();
    expect(seedScriptOf(null)).toBeNull();
    expect(seedNoteOf('> app@1 seed\n> node seed.js\nSeeded admin@example.com / secret\n')).toBe('Seeded admin@example.com / secret');
    expect(seedNoteOf('')).toBeNull();
  });

  it('assembles the container arguments: label, port on 127.0.0.1 only, CI variables and PORT', () => {
    const args = previewArguments(
      { name: 'demiurgo-preview-abc', worktreeHostPath: '/host/p', command: 'pnpm start', network: 'demiurgo-env-x', storeVolume: 'demiurgo-env-x-pnpm-store', env: { DATABASE_URL: 'postgres://postgres:pw@postgres:5432/p_1' }, appPort: 3000, hostPort: 4100, labels: { 'demiurgo.preview-project': 'abc' } },
      {},
    );
    expect(args).toContain('demiurgo.preview=1');
    expect(args).not.toContain('demiurgo.builder=1');
    expect(args[args.indexOf('-p') + 1]).toBe('127.0.0.1:4100:3000');
    expect(args).toContain('PORT=3000');
    expect(args).toContain('DATABASE_URL=postgres://postgres:pw@postgres:5432/p_1');
    expect(args).toContain('--read-only');
    expect(args.at(-1)).toContain("exec sh -c 'pnpm start'");
  });

  it('names the database p_ plus 12 hex, outside the build sweep', () => {
    expect(previewDatabase('0199a1b2-c3d4-7e5f-8a9b-0123456789ab')).toBe('p_0123456789ab');
  });
});
