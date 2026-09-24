// Arranque del servidor de DEMIURGO v2.
//   DEMIURGO_DATABASE_URL=postgres://… node packages/api/src/main.ts
// Nunca en el puerto 8000 (v1): la configuración lo rechaza.

import { arrancarNucleo, leerConfiguracion, registroConsola } from '@demiurgo/core';
import { crearServidor } from './servidor.ts';

const config = leerConfiguracion();
const nucleo = await arrancarNucleo(config, registroConsola);
const app = await crearServidor({
  servicios: nucleo.servicios,
  urlBase: config.urlBase,
  horasSesion: config.horasSesion,
  origenesPermitidos: config.origenesPermitidos,
  hostsPermitidos: [`${config.host}:${config.puerto}`, `localhost:${config.puerto}`, `127.0.0.1:${config.puerto}`],
});
await app.listen({ host: config.host, port: config.puerto });
registroConsola.info('DEMIURGO v2 escuchando', {
  url: `http://${config.host}:${config.puerto}`,
  agente: config.agente,
  clasificador: config.clasificador,
});

async function parar(): Promise<void> {
  await app.close();
  await nucleo.detener();
  process.exit(0);
}
process.once('SIGINT', () => void parar());
process.once('SIGTERM', () => void parar());
