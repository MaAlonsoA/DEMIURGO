// Words of the «Flaky and slow tests» section (TestHistory.tsx).

import { messages } from '../../i18n/define.ts';

export const TEST_HISTORY = messages(
  {
    title: 'Flaky and slow tests',
    note: (tests: number, runs: number) =>
      `Every CI test result is kept per test and commit (${runs} results, ${tests} tests). A test is flaky when it both passed and failed on the same commit. Sources: Google Testing Blog, «Flaky Tests at Google and How We Mitigate Them» (2016); Martin Fowler, «Eradicating Non-Determinism in Tests».`,
    flakyTitle: 'Flaky tests',
    slowTitle: 'Slowest tests',
    noFlaky: 'No test has passed and failed on the same commit.',
    noResults: 'No test results kept yet. They are recorded the next time CI reports.',
    colTest: 'Test',
    colRuns: 'Runs',
    colFails: 'Failures',
    colFlakyShas: 'Flaky commits',
    colLastSeen: 'Last seen',
    colMedian: 'Median duration',
    loading: 'Loading the test results',
  },
  {
    title: 'Pruebas inestables y lentas',
    note: (tests: number, runs: number) =>
      `Cada resultado de las pruebas de CI se guarda por prueba y commit (${runs} resultados, ${tests} pruebas). Una prueba es inestable cuando pasa y falla en el mismo commit. Fuentes: Google Testing Blog, «Flaky Tests at Google and How We Mitigate Them» (2016); Martin Fowler, «Eradicating Non-Determinism in Tests».`,
    flakyTitle: 'Pruebas inestables',
    slowTitle: 'Pruebas más lentas',
    noFlaky: 'Ninguna prueba ha pasado y fallado en el mismo commit.',
    noResults: 'Aún no se guarda ningún resultado. Se registran la próxima vez que CI informe.',
    colTest: 'Prueba',
    colRuns: 'Ejecuciones',
    colFails: 'Fallos',
    colFlakyShas: 'Commits inestables',
    colLastSeen: 'Vista por última vez',
    colMedian: 'Duración mediana',
    loading: 'Cargando los resultados de las pruebas',
  },
);
