// Configuración inyectada. Es, junto con `entorno.ts`, el único módulo que lee variables de
// entorno (AC-ESQ-001-06): el resto del núcleo recibe la configuración como parámetro.

import { z } from 'zod';

const esquema = z.object({
  DEMIURGO_DATABASE_URL: z.string().url(),
  DEMIURGO_HOST: z.string().default('127.0.0.1'),
  DEMIURGO_PUERTO: z.coerce.number().int().min(1).max(65535).default(8100),
  DEMIURGO_AGENTE: z.enum(['simulado', 'claude']).default('simulado'),
  DEMIURGO_MODELO_AGENTE: z.string().default('haiku'),
  DEMIURGO_CLASIFICADOR: z.enum(['simulado', 'referencia', 'jev']).default('simulado'),
  DEMIURGO_MODELO_CLASIFICADOR: z.string().default('haiku'),
  DEMIURGO_HORAS_SESION: z.coerce.number().int().min(1).max(720).default(12),
  DEMIURGO_ORIGENES: z.string().default('http://127.0.0.1:8100,http://localhost:8100'),
});

export type Configuracion = {
  urlBase: string;
  host: string;
  puerto: number;
  agente: 'simulado' | 'claude';
  modeloAgente: string;
  clasificador: 'simulado' | 'referencia' | 'jev';
  modeloClasificador: string;
  horasSesion: number;
  origenesPermitidos: string[];
};

/** Puertos reservados a la v1: la v2 nunca los usa. */
export const PUERTOS_PROHIBIDOS = [8000];

export function leerConfiguracion(entorno: Readonly<Record<string, string | undefined>> = process.env): Configuracion {
  const e = esquema.parse(entorno);
  if (PUERTOS_PROHIBIDOS.includes(e.DEMIURGO_PUERTO)) {
    throw new Error(`El puerto ${e.DEMIURGO_PUERTO} es de la v1 y la v2 no puede usarlo.`);
  }
  return {
    urlBase: e.DEMIURGO_DATABASE_URL,
    host: e.DEMIURGO_HOST,
    puerto: e.DEMIURGO_PUERTO,
    agente: e.DEMIURGO_AGENTE,
    modeloAgente: e.DEMIURGO_MODELO_AGENTE,
    clasificador: e.DEMIURGO_CLASIFICADOR,
    modeloClasificador: e.DEMIURGO_MODELO_CLASIFICADOR,
    horasSesion: e.DEMIURGO_HORAS_SESION,
    origenesPermitidos: e.DEMIURGO_ORIGENES.split(',').map((o) => o.trim()),
  };
}
