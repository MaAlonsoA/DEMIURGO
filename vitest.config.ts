import { defineConfig } from 'vitest/config';

// Four projects: unit (no I/O), web (the UI's components and logic), integration (ephemeral
// Postgres and Docker) and invariants.
// Each script asks for its own JUnit report (`reports/junit-*.xml`), which
// `pnpm gate:traceability` reads.
export default defineConfig({
  test: {
    reporters: ['default'],
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/{domain,design}/test/**/*.test.ts'],
          exclude: ['**/invariants/**', '**/node_modules/**'],
        },
      },
      {
        // Web components and the UI's pure logic: rendered to markup, without a browser.
        test: {
          name: 'web',
          include: ['packages/web/test/unit/**/*.test.{ts,tsx}'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/{core,api,mcp,evidence}/test/**/*.test.ts'],
          exclude: ['**/invariants/**', '**/node_modules/**'],
          globalSetup: ['packages/core/test/support/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          pool: 'forks',
        },
      },
      {
        test: {
          name: 'invariants',
          include: ['packages/*/test/invariants/**/*.test.ts'],
          exclude: ['**/node_modules/**'],
          globalSetup: ['packages/core/test/support/global-setup.ts'],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          pool: 'forks',
        },
      },
    ],
  },
});
