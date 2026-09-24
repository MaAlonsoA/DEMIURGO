import { defineConfig } from 'vitest/config';

// Tres proyectos: unitarias (sin E/S), integración (Postgres efímero y Docker) e invariantes.
export default defineConfig({
  test: {
    reporters: ['default', ['junit', { outputFile: 'reports/junit.xml', suiteName: 'demiurgo' }]],
    projects: [
      {
        test: {
          name: 'unitarias',
          include: ['packages/{domain,design}/test/**/*.test.ts'],
          exclude: ['**/invariantes/**', '**/node_modules/**'],
        },
      },
      {
        test: {
          name: 'integracion',
          include: ['packages/{core,api,mcp}/test/**/*.test.ts'],
          exclude: ['**/invariantes/**', '**/node_modules/**'],
          globalSetup: ['packages/core/test/soporte/preparacion-global.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          pool: 'forks',
        },
      },
      {
        test: {
          name: 'invariantes',
          include: ['packages/*/test/invariantes/**/*.test.ts'],
          exclude: ['**/node_modules/**'],
          globalSetup: ['packages/core/test/soporte/preparacion-global.ts'],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          pool: 'forks',
        },
      },
    ],
  },
});
