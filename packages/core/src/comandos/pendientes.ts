// Guardas de comandos cuyo manejador llega en H1. Bloquean hasta entonces;
// el comando ya da 501 antes de evaluarlas porque no tiene manejador.

import { guardaPendiente, registrarGuardas } from '../bus/guardas.ts';

registrarGuardas({
  diseno_valido: guardaPendiente('H1'),
});
