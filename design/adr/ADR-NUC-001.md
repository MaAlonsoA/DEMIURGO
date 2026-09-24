---
code: ADR-NUC-001
type: adr
title: Matriz de capacidades y máquinas de estado como datos
version: 1
state: proposed
domain: nucleo
increment: S0
links:
  - type: based_on
    target: DEC-PLN-001@1
annexes:
  - data/capabilities.yaml
  - data/transitions.yaml
---

# ADR-NUC-001 · Matriz de capacidades y máquinas de estado como datos

## Context

En la v1 no había actor y el cliente declaraba `approved` y `origin`. Un PATCH libre pasaba una tarea a «done» y `accept_scope` devolvía un Change Set verificado a `scope_accepted`. Los principios 2 y 3 del plan responden a eso: el actor lo fija el servidor, y todo cambio de estado es un comando con nombre sobre una máquina de estados declarada como datos. Una sola tabla sirve al servidor, a las pruebas y a la UI.

Las invariantes que dependen de esta decisión son I1 (los estados de autoridad solo los alcanza una persona) e I3 (toda transición sale de su tabla y deja un evento en la misma transacción).

## Options

- **Tablas como datos en `design/data/`, con un módulo generado.** La persona las revisa como diseño y el código no puede divergir.
- **Tablas escritas en TypeScript.** No se revisan como diseño y se mezclan con la lógica.
- **XState v5.** La máquina vive en código y añade una dependencia al núcleo. Quién puede aprobar y qué estados tienen autoridad es lógica de dominio, no del motor.
- **Autorización en cada ruta.** Es lo que hacía la v1.

## Decision

- Todo cambio de estado es un comando con nombre y sigue este orden:
  1. comando → capacidad: si la matriz no lo permite al tipo de actor, 403;
  2. transición: si la tabla no la tiene desde el estado actual, 409;
  3. guardas puras: si alguna falla, 409 con el motivo;
  4. escritura y evento en la misma transacción.
- Las tablas viven en `design/data/capabilities.yaml` (DAT-CAP-001) y `design/data/transitions.yaml` (DAT-TRA-001), anexas a este ADR. De ellas se genera `packages/domain/src/generated/tables.ts`, y un gate de deriva falla si no coinciden.
- Tipos de actor: `human`, `agent_external`, `agent_run` y `system`. Existe también `unknown`, solo para historia importada, y no puede ejecutar ningún comando. El servidor fija el actor según la credencial o el canal.
- Un comando decisivo alcanza un estado de autoridad y solo lo puede ejecutar `human`.
- Un comando compuesto, que cambia otras entidades (aceptar y aprobar, aceptar un paquete, ratificar una importación), se descompone en comandos de la tabla. Cada uno pasa por la matriz y la tabla de transiciones con su actor y deja su evento, y todos comparten la misma correlación.
- Las pruebas 403 y 409 se generan desde las tablas: cada comando con cada actor no permitido, y cada estado con cada comando que no tiene transición desde él.
- Las guardas se declaran por nombre en la tabla de transiciones y se implementan en el núcleo.
- Las entidades del Pilar 2 (Change Set, tarea, prueba de aceptación y evidencia) están en las tablas desde S0, aunque se implementan desde S3. El campo `implemented_in` dice desde cuándo.

## Consequences

- Una sola fuente para el servidor, las pruebas y, más adelante, la UI.
- Cambiar quién puede hacer qué es cambiar un dato que se revisa en un PR y, desde H1, una propuesta en la v2.
- Las reglas de coherencia (`tableInconsistencies`) se aplican en el validador de `design/`, en la generación del módulo y en las pruebas.
- El modelo del Pilar 2 queda fijado antes de construirlo. Retocarlo en S3 exige una versión nueva de las tablas.

## Acceptance criteria

### AC-NUC-001-01 · Tablas coherentes

- Verification: automatic
- Check: Las reglas de coherencia se ejecutan sobre las tablas reales y sobre casos incoherentes construidos a mano.

Dadas las tablas de `design/data/`, cuando se comprueban, entonces un comando decisivo solo está permitido a `human`, todo estado de autoridad se alcanza solo con comandos decisivos, todos los estados son alcanzables y cada comando aparece en alguna transición.

### AC-NUC-001-02 · Sin deriva

- Verification: automatic
- Check: Se regenera el módulo de tablas y se compara con el del repositorio.

Dado `design/data/`, cuando se regenera el módulo de tablas del dominio, entonces coincide byte a byte con `packages/domain/src/generated/tables.ts`.

### AC-NUC-001-03 · Guardas implementadas

- Verification: automatic
- Check: Se comparan las guardas declaradas en las tablas con las registradas en el núcleo.

Dada cada guarda declarada en la tabla de transiciones, cuando se busca en el núcleo, entonces tiene una implementación registrada.

### AC-NUC-001-04 · Aceptación humana

- Verification: manual
- Check: La persona revisa el ADR y sus tablas y los fusiona en `main`.

Dado este ADR y sus tablas en estado propuesto, cuando la persona los revisa, entonces los acepta con el merge.

### AC-NUC-001-05 · Comandos compuestos

- Verification: automatic
- Check: Se ejecutan los comandos compuestos implementados y se revisan los eventos que dejan.

Dado un comando compuesto que cambia otras entidades (aceptar y aprobar, aceptar un paquete o ratificar una importación), cuando se ejecuta, entonces se descompone en comandos de la tabla, cada uno con su actor y su evento, y todos los eventos llevan la misma correlación.
