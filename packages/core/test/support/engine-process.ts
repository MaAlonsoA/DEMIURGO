// Proceso hijo para las pruebas de durabilidad (AC-ESQ-001-07).
//   node proceso-motor.ts <url> iniciar <proyectoId> <runId>              → corta durante la llamada al agente
//   node proceso-motor.ts <url> cortar-tras-aplicar <proyectoId> <runId>  → corta justo tras confirmar «aplicar»
//   node proceso-motor.ts <url> recuperar <runId>                         → DBOS reanuda el flujo pendiente
//   node proceso-motor.ts <url> conciliar                                 → arranca, concilia y espera a que no quede nada vivo

import { createSimulatedAgent } from '../../src/agents/simulated.ts';
import { createSimulatedClassifier } from '../../src/classifier/simulated.ts';
import { connect } from '../../src/db/connection.ts';
import { waitForRun, startEngine } from '../../src/engine/engine.ts';
import { silentLogger } from '../../src/services.ts';

const [url = '', mode = '', a = '', b = ''] = process.argv.slice(2);
const connection = connect(url);
const agent =
  mode === 'start'
    ? createSimulatedAgent({ delayMs: 60_000, onInvoke: () => console.log('INVOKING') })
    : createSimulatedAgent({ onInvoke: () => console.log('INVOKING_AGAIN') });
const engine = await startEngine(
  { db: connection.db, clock: () => new Date(), agent, classifier: createSimulatedClassifier(), record: silentLogger },
  url,
  mode === 'cortar-tras-aplicar'
    ? {
        onStepComplete: (step) => {
          if (step !== 'apply') return;
          console.log('APPLIED');
          process.kill(process.pid, 'SIGKILL');
        },
      }
    : {},
);
if (mode === 'start' || mode === 'cortar-tras-aplicar') {
  await engine.services.engine.startRun(b, a);
  await new Promise((r) => setTimeout(r, 120_000));
} else if (mode === 'recover') {
  const state = await waitForRun(a);
  console.log(`RESULTADO ${state}`);
  await engine.stop();
  await connection.close();
} else {
  for (let i = 0; i < 200; i++) {
    const liveRuns = await connection.db.selectFrom('ai_runs').select('id').where('state', 'in', ['queued', 'running']).execute();
    if (liveRuns.length === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log('RECONCILED');
  await engine.stop();
  await connection.close();
}
