// Entorno de pruebas del núcleo: base efímera + servicios con agente simulado.

import type { Clasificador, PuertoAgente } from '@demiurgo/domain';
import { afterAll, beforeAll } from 'vitest';
import { crearAgenteSimulado } from '../../src/agentes/simulado.ts';
import { type Conexion, conectar } from '../../src/db/conexion.ts';
import { type MotorIniciado, iniciarMotor } from '../../src/motor/motor.ts';
import { crearClasificadorSimulado } from '../../src/clasificador/simulado.ts';
import { crearMotorEnLinea } from '../../src/motor/en-linea.ts';
import { type MotorFlujos, type Servicios, registroSilencioso } from '../../src/servicios.ts';
import { usarBaseEfimera } from './base-efimera.ts';
import { clasificadorNoConfigurado } from './clasificador-nulo.ts';

export { clasificadorNoConfigurado };

export type Entorno = {
  servicios: Servicios;
  conexion: Conexion;
  url: string;
  motor: MotorFlujos;
};

type Opciones = {
  /** Lanza DBOS sobre la base efímera; si no, el motor es inerte. */
  durable?: boolean;
  agente?: () => PuertoAgente;
  clasificador?: () => Clasificador;
};

/** Registra, para el archivo de prueba, una base efímera y los servicios del núcleo. */
export function usarEntorno(opciones: Opciones = {}): () => Entorno {
  const base = usarBaseEfimera();
  let entorno: Entorno | undefined;
  let iniciado: MotorIniciado | undefined;
  beforeAll(async () => {
    const url = base().url;
    const conexion = conectar(url);
    const comun = {
      db: conexion.db,
      reloj: () => new Date(),
      agente: (opciones.agente ?? (() => crearAgenteSimulado()))(),
      clasificador: (opciones.clasificador ?? (() => crearClasificadorSimulado()))(),
      registro: registroSilencioso,
    };
    if (opciones.durable) {
      iniciado = await iniciarMotor(comun, url);
      entorno = { servicios: iniciado.servicios, conexion, url, motor: iniciado.servicios.motor };
    } else {
      // Sin DBOS: el conocimiento y las evaluaciones se procesan en el acto; las ejecuciones solo se anotan.
      const servicios: Servicios = { ...comun, motor: crearMotorEnLinea(() => servicios) };
      entorno = { servicios, conexion, url, motor: servicios.motor };
    }
  });
  afterAll(async () => {
    await iniciado?.detener();
    await entorno?.conexion.cerrar();
  });
  return () => {
    if (!entorno) throw new Error('El entorno aún no está listo.');
    return entorno;
  };
}
