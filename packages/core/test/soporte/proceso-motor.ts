// Proceso hijo para las pruebas de durabilidad (AC-ESQ-001-07).
//   node proceso-motor.ts <url> iniciar <proyectoId> <runId>              → corta durante la llamada al agente
//   node proceso-motor.ts <url> cortar-tras-aplicar <proyectoId> <runId>  → corta justo tras confirmar «aplicar»
//   node proceso-motor.ts <url> recuperar <runId>                         → DBOS reanuda el flujo pendiente
//   node proceso-motor.ts <url> conciliar                                 → arranca, concilia y espera a que no quede nada vivo

import { crearAgenteSimulado } from '../../src/agentes/simulado.ts';
import { crearClasificadorSimulado } from '../../src/clasificador/simulado.ts';
import { conectar } from '../../src/db/conexion.ts';
import { esperarRun, iniciarMotor } from '../../src/motor/motor.ts';
import { registroSilencioso } from '../../src/servicios.ts';

const [url = '', modo = '', a = '', b = ''] = process.argv.slice(2);
const conexion = conectar(url);
const agente =
  modo === 'iniciar'
    ? crearAgenteSimulado({ demoraMs: 60_000, alInvocar: () => console.log('INVOCANDO') })
    : crearAgenteSimulado({ alInvocar: () => console.log('INVOCANDO_DE_NUEVO') });
const motor = await iniciarMotor(
  { db: conexion.db, reloj: () => new Date(), agente, clasificador: crearClasificadorSimulado(), registro: registroSilencioso },
  url,
  modo === 'cortar-tras-aplicar'
    ? {
        alCompletarPaso: (paso) => {
          if (paso !== 'aplicar') return;
          console.log('APLICADO');
          process.kill(process.pid, 'SIGKILL');
        },
      }
    : {},
);
if (modo === 'iniciar' || modo === 'cortar-tras-aplicar') {
  await motor.servicios.motor.iniciarRun(b, a);
  await new Promise((r) => setTimeout(r, 120_000));
} else if (modo === 'recuperar') {
  const estado = await esperarRun(a);
  console.log(`RESULTADO ${estado}`);
  await motor.detener();
  await conexion.cerrar();
} else {
  for (let i = 0; i < 200; i++) {
    const vivas = await conexion.db.selectFrom('ai_runs').select('id').where('state', 'in', ['queued', 'running']).execute();
    if (vivas.length === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log('CONCILIADO');
  await motor.detener();
  await conexion.cerrar();
}
