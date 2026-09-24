// Arranque del servidor MCP del canal de agentes por stdio.
//   DEMIURGO_API_URL=http://127.0.0.1:8100 DEMIURGO_AGENT_TOKEN=dmg_agente_… DEMIURGO_PROYECTO=<uuid> \
//     node packages/mcp/src/main.ts
// Es el único módulo de packages/mcp/src que lee variables de entorno; el resto recibe la
// configuración como argumentos. stdout es el canal del protocolo: los avisos van a stderr.

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { type OpcionesServidorMcp, comprobarOpcionesMcp, crearServidorMcp } from './servidor.ts';

function salirConError(mensaje: string): never {
  process.stderr.write(`demiurgo-mcp: ${mensaje}\n`);
  process.exit(2);
}

function variable(nombre: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) salirConError(`falta la variable de entorno ${nombre}.`);
  return valor;
}

const opciones: OpcionesServidorMcp = {
  urlApi: variable('DEMIURGO_API_URL'),
  token: variable('DEMIURGO_AGENT_TOKEN'),
  proyectoId: variable('DEMIURGO_PROYECTO'),
};

try {
  comprobarOpcionesMcp(opciones);
} catch (e) {
  salirConError(e instanceof Error ? e.message : String(e));
}

const conexion = serveStdio(() => crearServidorMcp(opciones), {
  onerror: (e) => process.stderr.write(`demiurgo-mcp: ${e.message}\n`),
});

async function parar(): Promise<void> {
  await conexion.close();
  process.exit(0);
}
process.once('SIGINT', () => void parar());
process.once('SIGTERM', () => void parar());
