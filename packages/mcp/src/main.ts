// Arranque del servidor MCP del canal de agentes por stdio.
//   DEMIURGO_API_URL=http://127.0.0.1:8100 DEMIURGO_AGENT_TOKEN=dmg_agente_… DEMIURGO_PROYECTO=<uuid> \
//     node packages/mcp/src/main.ts
// Es el único módulo de packages/mcp/src que lee variables de entorno; el resto recibe la
// configuración como argumentos. stdout es el canal del protocolo: los avisos van a stderr.

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { type McpServerOptions, checkMcpOptions, createMcpServer } from './server.ts';

function exitWithError(message: string): never {
  process.stderr.write(`demiurgo-mcp: ${message}\n`);
  process.exit(2);
}

function variable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) exitWithError(`falta la variable de entorno ${name}.`);
  return value;
}

const options: McpServerOptions = {
  urlApi: variable('DEMIURGO_API_URL'),
  token: variable('DEMIURGO_AGENT_TOKEN'),
  projectId: variable('DEMIURGO_PROJECT'),
};

try {
  checkMcpOptions(options);
} catch (e) {
  exitWithError(e instanceof Error ? e.message : String(e));
}

const connection = serveStdio(() => createMcpServer(options), {
  onerror: (e) => process.stderr.write(`demiurgo-mcp: ${e.message}\n`),
});

async function shutdown(): Promise<void> {
  await connection.close();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
