---
code: ADR-STK-001
type: adr
title: Stack del núcleo
version: 1
state: proposed
domain: plataforma
increment: D0
links:
  - type: based_on
    target: DEC-PLN-001@1
annexes: []
---

# ADR-STK-001 · Stack del núcleo

## Context

La v2 necesita un stack antes de S0 (§8 del plan y `docs/investigacion-stack-2026-09-24.md`). Los criterios de entrada son:

- un motor de pasos durable;
- un contrato único de esquemas para la API, las salidas de los modelos y MCP;
- tipos de estado con pruebas de propiedades;
- un diario append-only;
- una sola base para el dominio, el diario, el motor durable y el grafo.

El lenguaje es la decisión menos reversible. Las versiones se comprobaron en el registro npm el 24-09-2026. La política de «majors aburridos» pide versiones exactas y ninguna major con menos de 3 meses salvo justificación.

## Options

- **TypeScript de extremo a extremo** (media 7,83 de los tres jueces). SDKs oficiales de Claude y Codex, un solo contrato con Zod y dogfooding completo: las apps que genere DEMIURGO serán web en TS.
- **Go en el núcleo** (6,67). La mejor supervisión de procesos, binario único y menos cadena de suministro. En contra: no hay SDK oficial de Claude ni de Codex, habría dos lenguajes y el dogfooding sería parcial. Queda como opción para el broker de contenedores.
- **Python en el núcleo** (6,33). Tipado opcional con stubs incompletos, SDK de Claude en alfa y riesgo de repetir los hábitos de la v1. Queda para un laboratorio de evaluaciones fuera de línea.

## Decision

TypeScript estricto en un monorepo pnpm, con PostgreSQL como única base. Versiones fijadas:

| Pieza | Versión | Nota |
|---|---|---|
| TypeScript | 7.0.2 | `strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly` y `verbatimModuleSyntax`. El tsc nativo es el gate de tipos |
| Node.js | 24.21 | El stack pedía 26, pero la máquina tiene 24. Type stripping nativo, sin paso de build |
| pnpm | 11.27.1 | Fijado con hash vía corepack. pnpm 12 descartado: tiene menos de 3 meses |
| PostgreSQL | 18.6 | Imagen fijada por digest, proyecto compose `demiurgo-v2-dev`, puerto 55432 |
| Kysely | 0.29.6 | Migraciones SQL planas con un migrador propio |
| DBOS Transact | 4.27.6 | No la 5.0.2, que tiene 8 días |
| Fastify | 5.12.5 | API HTTP y SSE |
| Zod | 4.6.5 | Contrato único: validación, JSON Schema de las salidas y OpenAPI |
| Vitest | 4.1.11 | No la 5.0. Reporter JUnit |
| fast-check | 4.10.2 | Pruebas de propiedades |
| oxlint | 1.83.0 | Lint con tipos junto a oxlint-tsgolint 7.0.2002. La 1.84 y la 1.85 no cumplían la antigüedad mínima |
| Biome | 2.5.14 | Solo formato |
| SDK MCP | 2.0.0 | La 2.1.0 tiene 1 día |

Defensas de pnpm en `pnpm-workspace.yaml`: `minimumReleaseAge` de 3 días, `strictDepBuilds`, `blockExoticSubdeps`, `trustPolicy: no-downgrade` y `saveExact`.

`packages/domain` es TypeScript puro sin E/S: tablas, guardas, puertos y esquemas. La E/S vive en `packages/core`, `packages/api` y `packages/mcp`.

## Consequences

- Un solo lenguaje y un solo contrato: el esquema Zod de una acción genera la validación y el JSON Schema que recibe el modelo.
- Dominio, diario, motor durable y grafo comparten un PostgreSQL. Una transacción cubre la transición y el checkpoint, y hay una sola copia de seguridad.
- Node 24 entra en mantenimiento el 20-10-2026. Pasar a Node 26 LTS queda como decisión pendiente; no hay paso de build que cambiar.
- DBOS 4.x obliga a revisar la subida a 5.x cuando esta cumpla 3 meses.
- TS 7 no tiene API programática: no se usa typescript-eslint y el lint con tipos lo hace oxlint.
- Ninguna versión nueva de una dependencia entra antes de 3 días.

## Spike

Motor durable: DBOS Transact 4.27.6 sobre PostgreSQL 18.6 (informe completo en `docs/ejecuciones-reales/spike-dbos-2026-09-24.md`).

1. Se lanzó un workflow de 3 pasos y se mató el proceso durante el paso 2.
2. Al relanzar el proceso, DBOS reanudó el workflow sin intervención.
3. El paso 1 y el paso 3 se ejecutaron una vez; el paso 2, dos veces.

Conclusión: los pasos no transaccionales se ejecutan al menos una vez. El efecto «exactamente una vez» se consigue con pasos transaccionales idempotentes: el efecto y su marca en `step_completions` se escriben en la misma transacción, y un paso ya marcado no repite el efecto.

Alcance reducido (desviación): este spike solo comprueba que DBOS recupera un flujo tras matar el proceso. Respecto al plan (§6, etapa 1) y al stack (§1 y §4 de `docs/investigacion-stack-2026-09-24.md`), falta:

- el slice vertical (máquina de estados, workflow DBOS, broker, gate-runner y evidencia) construido por Claude Code y por Codex, midiendo las iteraciones hasta pasar los gates, los tokens y los reintentos;
- la comparación DBOS frente a Temporal con sus 8 criterios (§4 del stack). De ellos solo se ha probado, en parte, el primero: matar el proceso a mitad de un paso, con un paso simple y no de agente.

Hacer lo que falta o aceptar la desviación queda como decisión pendiente antes de S4.

## Acceptance criteria

### AC-STK-001-01 · Tipos estrictos

- Verification: automatic
- Check: Se revisa la configuración de TypeScript y se ejecuta `pnpm gate:types`.

Dado el repositorio, cuando se lee `tsconfig.json`, entonces tiene activos `strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly` y `verbatimModuleSyntax`, y `pnpm gate:types` termina sin errores.

### AC-STK-001-02 · Versiones exactas

- Verification: automatic
- Check: Se revisan las dependencias directas de todos los `package.json` del monorepo.

Dado cualquier `package.json` del monorepo, cuando se leen sus dependencias directas, entonces cada una está fijada a una versión exacta (sin `^`, `~` ni rangos) o es `workspace:*`, y `packageManager` fija pnpm con su hash.

### AC-STK-001-03 · Defensas de pnpm

- Verification: automatic
- Check: Se revisa `pnpm-workspace.yaml`.

Dado `pnpm-workspace.yaml`, cuando se lee, entonces `minimumReleaseAge` es de al menos 4320 minutos (3 días) y están activos `strictDepBuilds`, `blockExoticSubdeps`, `trustPolicy: no-downgrade` y `saveExact: true`.

### AC-STK-001-04 · Una sola base

- Verification: automatic
- Check: Una prueba de integración inspecciona la base con el sistema arrancado.

Dado el sistema arrancado, cuando se inspecciona la base, entonces el dominio, el diario de eventos, el motor durable y el grafo viven en el mismo PostgreSQL, de versión 18 o superior.

### AC-STK-001-05 · Dominio puro

- Verification: automatic
- Check: Se revisan los imports de `packages/domain/src`.

Dado el código de `packages/domain/src`, cuando se revisan sus imports, entonces ninguno es de E/S: ni `pg`, `kysely`, `fastify` o `@dbos-inc/*`, ni `node:fs`, `node:net`, `node:child_process` o `node:http`.

### AC-STK-001-06 · Aceptación humana

- Verification: manual
- Check: La persona revisa el ADR y lo fusiona en `main`.

Dado este ADR en estado propuesto, cuando la persona lo revisa, entonces lo acepta con el merge.
