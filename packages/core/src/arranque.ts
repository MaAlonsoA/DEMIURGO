// Arranque del núcleo a partir de la configuración: base migrada, agente y clasificador
// según la configuración y motor durable en marcha.

import type { Clasificador, PuertoAgente } from '@demiurgo/domain';
import { crearAgenteClaudeCli } from './agentes/claude-cli.ts';
import { crearAgenteSimulado } from './agentes/simulado.ts';
import { crearClasificadorJev } from './clasificador/jev.ts';
import { crearClasificadorReferenciaClaude } from './clasificador/referencia-claude.ts';
import { crearClasificadorSimulado } from './clasificador/simulado.ts';
import type { Configuracion } from './config.ts';
import { type Conexion, conectar } from './db/conexion.ts';
import { migrar } from './db/migrador.ts';
import { type MotorIniciado, iniciarMotor } from './motor/motor.ts';
import { type Registro, registroConsola } from './servicios.ts';

export function crearAgente(config: Configuracion): PuertoAgente {
  return config.agente === 'claude' ? crearAgenteClaudeCli({ modelo: config.modeloAgente }) : crearAgenteSimulado();
}

export function crearClasificador(config: Configuracion): Clasificador {
  if (config.clasificador === 'referencia') return crearClasificadorReferenciaClaude({ modelo: config.modeloClasificador });
  if (config.clasificador === 'jev') return crearClasificadorJev();
  return crearClasificadorSimulado();
}

export type Nucleo = MotorIniciado & { conexion: Conexion };

export async function arrancarNucleo(config: Configuracion, registro: Registro = registroConsola): Promise<Nucleo> {
  const conexion = conectar(config.urlBase);
  const aplicadas = await migrar(conexion.pool);
  if (aplicadas.length) registro.info('Migraciones aplicadas', { aplicadas });
  const motor = await iniciarMotor(
    { db: conexion.db, reloj: () => new Date(), agente: crearAgente(config), clasificador: crearClasificador(config), registro },
    config.urlBase,
  );
  return {
    ...motor,
    conexion,
    async detener() {
      await motor.detener();
      await conexion.cerrar();
    },
  };
}
