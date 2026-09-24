// Proceso hijo para la prueba de durabilidad (AC-ESQ-001-07).
//   node proceso-motor.ts <url> iniciar <proyectoId> <runId>   → arranca el flujo y se queda en el agente
//   node proceso-motor.ts <url> recuperar <runId>              → DBOS reanuda el flujo pendiente

import { crearAgenteSimulado } from '../../src/agentes/simulado.ts';
import { conectar } from '../../src/db/conexion.ts';
import { esperarRun, iniciarMotor } from '../../src/motor/motor.ts';
import { registroSilencioso } from '../../src/servicios.ts';
import { clasificadorNoConfigurado } from './clasificador-nulo.ts';

const [url = '', modo = '', a = '', b = ''] = process.argv.slice(2);
const conexion = conectar(url);
const agente =
  modo === 'iniciar'
    ? crearAgenteSimulado({ demoraMs: 60_000, alInvocar: () => console.log('INVOCANDO') })
    : crearAgenteSimulado({ alInvocar: () => console.log('INVOCANDO_DE_NUEVO') });
const motor = await iniciarMotor(
  { db: conexion.db, reloj: () => new Date(), agente, clasificador: clasificadorNoConfigurado, registro: registroSilencioso },
  url,
);
if (modo === 'iniciar') {
  await motor.servicios.motor.iniciarRun(b, a);
  await new Promise((r) => setTimeout(r, 120_000));
} else {
  const estado = await esperarRun(a);
  console.log(`RESULTADO ${estado}`);
  await motor.detener();
  await conexion.cerrar();
}
