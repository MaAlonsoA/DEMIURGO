// Base de datos efímera por archivo de prueba, clonada de la plantilla migrada.

import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, inject } from 'vitest';

export type BaseEfimera = { nombre: string; url: string; eliminar(): Promise<void> };

function urlCon(nombre: string, base: string): string {
  const u = new URL(base);
  u.pathname = `/${nombre}`;
  return u.toString();
}

export async function crearBaseEfimera(): Promise<BaseEfimera> {
  const urlAdmin = inject('urlAdmin');
  const plantilla = inject('plantilla');
  const nombre = `dmg_t_${Math.floor(Date.now() / 1000)}_${randomBytes(4).toString('hex')}`;
  const admin = new Client({ connectionString: urlAdmin });
  await admin.connect();
  try {
    await admin.query(`create database "${nombre}" template "${plantilla}"`);
  } finally {
    await admin.end();
  }
  return {
    nombre,
    url: urlCon(nombre, urlAdmin),
    async eliminar() {
      if (!nombre.startsWith('dmg_t_')) throw new Error('Solo se eliminan bases efímeras.');
      const c = new Client({ connectionString: urlAdmin });
      await c.connect();
      try {
        await c.query(`drop database if exists "${nombre}" with (force)`);
      } finally {
        await c.end();
      }
    },
  };
}

/** Registra una base efímera para el archivo de prueba actual. */
export function usarBaseEfimera(): () => BaseEfimera {
  let base: BaseEfimera | undefined;
  beforeAll(async () => {
    base = await crearBaseEfimera();
  });
  afterAll(async () => {
    await base?.eliminar();
  });
  return () => {
    if (!base) throw new Error('La base efímera aún no existe.');
    return base;
  };
}
