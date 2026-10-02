import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PreviewView } from '../../src/screens/repository/Preview.tsx';

const noop = () => undefined;
const render = (state: Parameters<typeof PreviewView>[0]['state']) => renderToStaticMarkup(<PreviewView state={state} onStart={noop} onStop={noop} />);

describe('Open the app section', () => {
  it('offers Start when stopped', () => {
    const html = render({ state: 'stopped' });
    expect(html).toContain('data-preview="stopped"');
    expect(html).toContain('Start the app');
    expect(html).not.toContain('>Stop<');
  });

  it('shows progress while starting, with Stop and no Start', () => {
    const html = render({ state: 'starting', step: 'Seeding the database' });
    expect(html).toContain('Seeding the database…');
    expect(html).not.toContain('Start the app');
    expect(html).toContain('Stop');
  });

  it('shows the address as a link in a new tab, the commit and the seed note', () => {
    const html = render({ state: 'running', url: 'http://127.0.0.1:4100', port: 4100, started_at: '2026-10-02T10:00:00Z', commit: 'abcdef1234567' });
    expect(html).toContain('href="http://127.0.0.1:4100"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('abcdef1');
    expect(html).toContain('Seeded accounts: see the seed script');
    expect(html).toContain('Restart on the newest main');
    expect(render({ state: 'running', url: 'http://127.0.0.1:4100', port: 4100, started_at: '', commit: 'abcdef1', seed: 'admin / pw' })).toContain('Seed: admin / pw');
  });

  it('shows the reason and the log tail on failure', () => {
    const html = render({ state: 'failed', reason: 'Installing dependencies failed', log: 'ERR_PNPM boom' });
    expect(html).toContain('Installing dependencies failed');
    expect(html).toContain('ERR_PNPM boom');
    expect(html).toContain('Start the app');
  });
});
