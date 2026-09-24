// Guardas de comandos cuyo manejador llega más adelante (S2 o H1). Bloquean hasta entonces;
// el comando ya da 501 antes de evaluarlas porque no tiene manejador.

import { guardaPendiente, registrarGuardas } from '../bus/guardas.ts';

registrarGuardas({
  taxonomia_valida: guardaPendiente('S2'),
  categorias_de_la_taxonomia: guardaPendiente('S2'),
  diseno_valido: guardaPendiente('H1'),
});
