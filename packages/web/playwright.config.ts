// End-to-end walks (ADR-WEB-001): Playwright with axe against the API with the simulator, which
// serves the web build from the same origin. The JUnit report feeds the AC → test traceability.

import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 8310);
// E2E_TAG keeps parallel runs apart: their own report and results folder.
const tag = process.env.E2E_TAG ? `-${process.env.E2E_TAG}` : '';

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 3,
  retries: 0,
  reporter: [['list'], ['junit', { outputFile: `../../reports/junit-e2e${tag}.xml` }]],
  outputDir: `../../reports/e2e-results${tag}`,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-GB',
    // Animations off: axe measures the final colors and the screenshots are stable.
    contextOptions: { reducedMotion: 'reduce' },
  },
  webServer: {
    command: 'node test/e2e/support/server.ts',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { E2E_PORT: String(port), ...(process.env.E2E_WEB_ROOT ? { E2E_WEB_ROOT: process.env.E2E_WEB_ROOT } : {}) },
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
