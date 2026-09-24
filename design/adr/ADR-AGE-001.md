---
code: ADR-AGE-001
type: adr
title: Agentes por CLI con suscripción
version: 1
state: proposed
domain: plataforma
increment: S0
links:
  - type: based_on
    target: DEC-PLN-001@1
annexes: []
---

# ADR-AGE-001 · Agentes por CLI con suscripción

## Context

El stack recomendaba el Claude Agent SDK con API key y Codex con `CODEX_API_KEY` (§5 del stack). En esta máquina, `claude` y `codex` están autenticados por suscripción y no hay API keys. Anthropic no permite que un producto de terceros ofrezca el login de claude.ai, así que la suscripción solo vale como modo personal explícito.

En la v1, los prompts iban incrustados en el código y cada función validaba la salida a su manera. El principio 7 del plan pide un método versionado, un context pack con hash y una validación común con JSON Schema.

## Options

- **CLI autenticada por suscripción** (`claude -p` con salida JSON y esquema). Sin coste por token y sin claves que gestionar; depende de la cuota y de una CLI que se publica casi a diario.
- **Claude Agent SDK con API key** (la recomendación del stack). Coste real por token y una clave que proteger. Es el camino si DEMIURGO tiene más usuarios.
- **Vercel AI SDK con API key** para las acciones no agénticas. El mismo coste y la misma clave.
- **Codex por `codex exec --json --output-schema`.** Consume la cuota de la suscripción de ChatGPT.

## Decision

- Puerto estrecho `AgentPort` en `packages/domain/src/agents.ts`. La petición lleva acción, método versionado, JSON Schema de salida, context pack con hash, presupuesto y señal de cancelación. El resultado lleva la salida cruda, el uso, los eventos crudos y, si falla, el `failure_kind`.
- Adaptador real de Claude: `claude -p --output-format json --json-schema <schema>`. El esquema se genera desde el esquema Zod de la acción, el mismo con el que se valida la salida. El adaptador elimina `ANTHROPIC_API_KEY` del entorno para usar siempre la suscripción. Se ejecuta con la frontera de ADR-RUN-001.
- Codex (`codex exec --json --output-schema`) solo si es imprescindible. No se implementa en H1.
- Validación común con Zod para todas las salidas: una salida fuera del esquema deja la ejecución en `failed` con `invalid_output`, sin efectos (I7).
- Simulador determinista detrás del mismo puerto para la CI y las pruebas: la misma acción con el mismo context pack da la misma salida.
- **Desviación del stack:** se usa la suscripción, que es el modo personal explícito de esta instalación. Pasar a API key queda como decisión pendiente de la persona.

## Consequences

- Las ejecuciones reales no tienen coste por token, pero gastan cuota de la suscripción.
- La CLI cambia a menudo: la versión se registra en cada ejecución y el contrato se prueba con salidas grabadas.
- El uso (tokens y duración) sale del JSON de la CLI, no de la telemetría.
- Pasar a API key o a otro proveedor es escribir otro adaptador del mismo puerto.
- Si cambian las condiciones de uso de la suscripción, este ADR se revisa.

## Acceptance criteria

### AC-AGE-001-01 · Suscripción y salida estructurada

- Verification: automatic
- Check: Se revisan los argumentos y el entorno con los que el adaptador lanza la CLI.

Dada una petición al adaptador de Claude, cuando lanza la CLI, entonces usa `-p`, `--output-format json` y `--json-schema` con el esquema generado desde Zod, y el entorno del proceso no contiene `ANTHROPIC_API_KEY`.

### AC-AGE-001-02 · Contrato por fixture grabada

- Verification: automatic
- Check: Se normalizan salidas JSON grabadas de la CLI, de éxito y de error.

Dada una salida JSON grabada de la CLI, cuando el adaptador la normaliza, entonces devuelve el `AgentResult` del puerto con su uso y, si es un error, con su `failure_kind`.

### AC-AGE-001-03 · Tiempo y cancelación

- Verification: automatic
- Check: Se lanza un proceso que no termina y se deja vencer el tiempo o se aborta la señal.

Dado un proceso de la CLI en curso, cuando vence su tiempo o se aborta la señal, entonces el adaptador mata el proceso y devuelve `timeout` o `cancelled`.

### AC-AGE-001-04 · Aceptación humana

- Verification: manual
- Check: La persona revisa el ADR y lo fusiona en `main`.

Dado este ADR en estado propuesto, cuando la persona lo revisa, entonces lo acepta con el merge.
