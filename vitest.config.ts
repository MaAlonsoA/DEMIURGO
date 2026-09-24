import { defineConfig } from 'vitest/config';

// Three projects: unit (no I/O), integration (ephemeral Postgres and Docker) and invariants.
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
        test: {
          name: 'integration',
          include: ['packages/{core,api,mcp}/test/**/*.test.ts'],
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
