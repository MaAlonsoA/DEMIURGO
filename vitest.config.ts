import { defineConfig } from 'vitest/config';

// Tres proyectos: unitarias (sin E/S), integración (Postgres efímero y Docker) e invariantes.
// El informe JUnit lo pide cada script con su propio archivo (`reports/junit-*.xml`), que lee
// `pnpm gate:trazabilidad`.
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
