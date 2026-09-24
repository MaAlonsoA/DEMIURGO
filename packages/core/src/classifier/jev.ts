// Adaptador de Jev (TypeSafe AI, System One) detrás del puerto `Clasificador`. Está vacío a
// propósito: no hay acceso al early access y enviar contenido del proyecto a TypeSafe (API
// alojada en EE. UU.) necesita antes un ADR (§7.5 del plan). Mientras tanto se usa el
// clasificador de referencia.
//
// Cómo encajará `@typesafe-ai/sdk` 0.6 (MIT) cuando se instale, sin cambiar el puerto:
// - Una petición por llamada a `choice`, `score` o `noul`, con todos los ítems como preguntas
//   independientes de la misma petición (Jev las resuelve en paralelo). Nada multi-salto.
// - `state`: el `estado` de cada ítem (texto o JSON), pequeño y delimitado como dato no
//   confiable. Contexto de 64k tokens, 32k para `state` más la pregunta.
// - Choice: `pregunta` y `opciones` (hasta 255). La respuesta trae la opción elegida y su
//   distribución de probabilidad, que pasa tal cual a `RespuestaChoice.distribucion`.
// - Score: `pregunta` y `niveles` ordenados (de 2 a 10). `nivel` es el índice elegido y
//   `distribucion`, la probabilidad por nivel.
// - Noul: `enunciado`; `probabilidad` es P(verdadero). No se combinan dos Noul para una misma
//   decisión: P(sí) + P(no) puede no sumar 1 (mejor un Choice).
// - `confidence` de Jev → `confianza`, que enruta la cascada (`enrutarPorConfianza`). Está
//   calibrada por grupo, no por respuesta, y los umbrales se ajustan con datos propios.
// - El id pasará a ser `jev@<versión del modelo>` (p. ej. `jev@jev-1.13.0`), y forma parte del
//   `input_hash` de cada clasificación.

import type { Clasificador } from '@demiurgo/domain';

export const ID_CLASIFICADOR_JEV = 'jev@no-disponible';

export const MENSAJE_JEV_NO_DISPONIBLE =
  'Jev no está disponible: el adaptador está vacío hasta tener acceso y un ADR sobre el envío de datos a TypeSafe.';

export function crearClasificadorJev(): Clasificador {
  const noDisponible = async (): Promise<never> => {
    throw new Error(MENSAJE_JEV_NO_DISPONIBLE);
  };
  return { id: ID_CLASIFICADOR_JEV, choice: noDisponible, score: noDisponible, noul: noDisponible };
}
