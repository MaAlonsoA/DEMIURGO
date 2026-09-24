---
code: ADR-AGE-001
type: adr
title: Agentes por CLI con suscripción
version: 2
state: proposed
domain: plataforma
increment: S0
change_note: "Tres motores configurables por tarea: agentes de DEMIURGO, registro de proveedores, salida estructurada, sesión con delta y consumo."
links:
  - type: based_on
    target: DEC-PLN-001@1
annexes: []
---

# ADR-AGE-001 · Agentes por CLI con suscripción

## Context

El stack recomendaba el Claude Agent SDK con API key y Codex con `CODEX_API_KEY` (§5 del stack). En esta máquina, `claude` y `codex` están autenticados por suscripción y no hay API keys. Anthropic no permite que un producto de terceros ofrezca el login de claude.ai, así que la suscripción solo vale como modo personal explícito.

En la v1, los prompts iban incrustados en el código y cada función validaba la salida a su manera. El principio 7 del plan pide un método versionado, un context pack con hash y una validación común con JSON Schema.

La versión 1 de este ADR dejaba un único agente global elegido por variables de entorno, que por defecto era el simulado. La persona necesita elegir en la web qué motor, modelo y razonamiento usa cada tarea, entre Claude, Codex y sus modelos locales (Qwen, configurado en OpenCode).

## Options

- **CLI autenticada por suscripción** (`claude -p` y `codex exec`, con salida estructurada). No hay coste por token ni claves que gestionar, pero depende de la cuota y de CLIs que se publican casi a diario.
- **Claude Agent SDK con API key** (la recomendación del stack). Tiene coste real por token y una clave que proteger. Es el camino si DEMIURGO tiene más usuarios.
- **Vercel AI SDK con API key** para las acciones no agénticas. El mismo coste y la misma clave.
- **Una pasarela aparte** que unifique proveedores. Es una pieza más que operar, sin ganar nada sobre un puerto propio.

## Decision

- **Agentes de DEMIURGO.** Un agente es un `AGENT.md` más sus skills (`SKILL.md`), ficheros del repo en `packages/core/agents/` y `packages/core/skills/`.
  - Su versión es la huella de su contenido.
  - El prompt se compone de forma pura y con huella: el agente, sus skills en orden y las reglas de DEMIURGO. El contexto va delimitado como dato no confiable.
- **Puerto de proveedores.** `Provider` en `packages/domain/src/agents.ts`, con `discover()` y `run()`.
  - `discover()` lista los modelos y efforts sin gastar cuota.
  - `run()` lleva el system, el input, el JSON Schema de la acción, el modelo, el effort, la sesión, el tiempo, la cancelación y un receptor de eventos.
  - Un registro de proveedores sustituye al agente global.
- **Claude:**
  ```
  claude -p --output-format stream-json --verbose --json-schema <esquema> --model <alias> --effort <nivel>
    --system-prompt <system> --tools "" --strict-mcp-config --safe-mode --setting-sources ""
  ```
  - Sesión: `--session-id`, `--resume` o `--no-session-persistence`.
  - Modelos: los alias `haiku`, `sonnet`, `opus` y `fable`.
- **Codex:**
  ```
  codex exec --json --output-schema <fichero> -o <fichero> -m <modelo> -c model_reasoning_effort=<nivel>
    -c developer_instructions=<system> --ignore-user-config --ignore-rules --disable <herramientas>
  ```
  - Sandbox de solo lectura.
  - Sesión: `exec resume`.
  - Modelos: los de `codex debug models` con visibilidad `list`.
- **OpenCode (modelos locales).** OpenCode 2 no tiene salida estructurada, y el servidor local (NInfer) no admite salida restringida.
  - El adaptador lee los modelos y variantes que la persona configuró en OpenCode.
  - Llama al endpoint OpenAI-compatible de cada uno con una herramienta `StructuredOutput`, cuyos parámetros son el esquema, y hasta 2 reintentos si no la llama. Es el mismo mecanismo que usaban OpenCode 1 y `claude --json-schema`.
  - No tiene sesión de proveedor.
- **Validación común con Zod** para todas las salidas, venga del proveedor que venga: una salida fuera del esquema deja la ejecución en `failed` con `invalid_output`, sin efectos (I7).
- **Asignación.**
  - La persona asigna proveedor, modelo y effort a cada agente, globalmente o por proyecto, y solo de lo descubierto.
  - «Retry with…» cambia el motor en un solo reintento.
  - DEMIURGO nunca cambia de proveedor ni de modelo por su cuenta.
- **Rastro.**
  - Cada llamada a un proveedor, sea una ejecución o una llamada del clasificador, es una fila con sus eventos en orden, métricas con procedencia y consumo.
- **Simulador determinista** detrás del mismo puerto para la CI y las pruebas. Solo se ofrece con las herramientas de desarrollo.
- **Desviación del stack:** se usa la suscripción, que es el modo personal explícito de esta instalación. Pasar a API key queda como decisión pendiente de la persona.

## Consequences

- Las ejecuciones reales no tienen coste por token, pero gastan cuota de la suscripción.
- **Las CLIs cambian a menudo:**
  - la versión se registra en el catálogo;
  - el contrato de cada adaptador se prueba con salidas grabadas;
  - el descubrimiento se revisa al cambiar de versión.
- El uso sale de la salida de cada motor, no de su telemetría, y cada cifra dice de qué campo sale.
- Pasar a API key o a otro proveedor es escribir otro adaptador del mismo puerto.
- Con sesión, las conversaciones de Codex quedan también en el historial de la persona (`~/.codex/sessions`).
- Si cambian las condiciones de uso de la suscripción, este ADR se revisa.

## Acceptance criteria

### AC-AGE-001-01 · Suscripción y salida estructurada

- Verification: automatic
- Check: Se revisan los argumentos y el entorno con los que el adaptador lanza la CLI.

Dada una petición al adaptador de Claude, cuando lanza la CLI, entonces usa `-p`, `--output-format stream-json` y `--json-schema` con el esquema generado desde Zod, y el entorno del proceso no contiene `ANTHROPIC_API_KEY`.

### AC-AGE-001-02 · Contrato por fixture grabada

- Verification: automatic
- Check: Se normalizan salidas grabadas de cada proveedor, de éxito y de error.

Dada una salida grabada de Claude, Codex u OpenCode, cuando el adaptador la normaliza, entonces devuelve el `AgentResult` del puerto con su uso y, si es un error, con su `failure_kind`.

### AC-AGE-001-03 · Tiempo y cancelación

- Verification: automatic
- Check: Se lanza un proceso que no termina y se deja vencer el tiempo o se aborta la señal.

Dado un proceso o una petición en curso, cuando vence su tiempo o se aborta la señal, entonces el adaptador lo corta y devuelve `timeout` o `cancelled`.

### AC-AGE-001-04 · Aceptación humana

- Verification: manual
- Check: La persona revisa el ADR y lo fusiona en `main`.

Dado este ADR en estado propuesto, cuando la persona lo revisa, entonces lo acepta con el merge.
