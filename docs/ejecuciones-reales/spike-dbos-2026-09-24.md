# Spike del motor durable DBOS: ejecución real del 2026-09-24

Ejecución real que respalda la sección Spike de `ADR-STK-001`: un flujo de 3 pasos con DBOS Transact sobre PostgreSQL, con el proceso muerto a mitad del paso 2 y recuperado al relanzarlo. No usa ningún modelo.

## Entorno

| Elemento | Valor |
|---|---|
| Fecha | 2026-09-24 |
| Motor durable | DBOS Transact 4.27.6, con `systemDatabaseSchemaName: 'dbos'` |
| Base | PostgreSQL 18.6 |
| Node.js | 24.21 |

## Montaje

Dos scripts:

- **`worker.ts`** define un flujo de 3 pasos, cada uno con `DBOS.runStep`. Cada paso cuenta sus ejecuciones. El paso 2 escribe una fila y espera 4 s antes de terminar, para dar tiempo a matar el proceso. El worker tiene dos modos:
  - `iniciar`: arranca el flujo con el id `wf-1` y espera su resultado;
  - `recuperar`: llama a `DBOS.launch()`, que recupera el flujo pendiente, y espera su resultado.
- **`padre.ts`** lanza el worker en modo `iniciar`, lo mata con `SIGKILL` en cuanto ve «PASO2_EN_CURSO» en su salida y lanza el worker en modo `recuperar`.

Resumen del código:

```ts
// worker.ts: DBOS 4.27.6, systemDatabaseSchemaName 'dbos'; flujo de 3 pasos con DBOS.runStep; el paso 2 escribe una fila y espera 4 s; modo 'iniciar' arranca el flujo 'wf-1' y espera; modo 'recuperar' hace DBOS.launch() (que recupera el flujo pendiente) y espera su resultado.
// padre.ts: lanza 'iniciar', mata el proceso con SIGKILL al ver «PASO2_EN_CURSO» y lanza 'recuperar'.
// Salida: RESULTADO hecho:wf-1 [{"paso":"paso1","n":1},{"paso":"paso2","n":2},{"paso":"paso3","n":1}] (8,9 s en total).
```

## Resultado

```text
RESULTADO hecho:wf-1 [{"paso":"paso1","n":1},{"paso":"paso2","n":2},{"paso":"paso3","n":1}]
```

El recorrido completo, con el kill y la recuperación, tardó 8,9 s.

| Paso | Ejecuciones | Por qué |
|---|---|---|
| paso1 | 1 | Terminó antes del kill. DBOS guardó su resultado y, al recuperar, lo devolvió sin ejecutarlo otra vez. |
| paso2 | 2 | El kill lo cortó antes de guardar su resultado, así que al recuperar se ejecutó de nuevo. |
| paso3 | 1 | Solo se ejecutó tras la recuperación. |

## Conclusión

- DBOS reanuda un flujo interrumpido al relanzar el proceso, sin intervención.
- Un paso no transaccional se ejecuta **al menos una vez**: su efecto (aquí, la fila del paso 2) puede repetirse.
- El efecto «exactamente una vez» exige pasos transaccionales idempotentes: el efecto y su marca en `step_completions` se escriben en la misma transacción, y un paso ya marcado no repite el efecto. Es lo que comprueba AC-ESQ-001-07.

## Lo que no cubre

Este spike es de alcance reducido (ver «Alcance reducido (desviación)» en `ADR-STK-001`). No construye el slice vertical con Claude Code y con Codex, ni mide iteraciones, tokens y reintentos. Tampoco compara DBOS con Temporal según los 8 criterios del §4 de `docs/investigacion-stack-2026-09-24.md`: solo prueba, en parte, el primero (matar el proceso a mitad de un paso), con un paso simple y no de agente. Hacerlo o aceptar la desviación queda como decisión pendiente antes de S4.
