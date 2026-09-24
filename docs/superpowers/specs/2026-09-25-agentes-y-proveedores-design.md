# Agentes y proveedores: spec de diseño

Fecha: 25-09-2026. Estado: **propuesto**, pendiente de revisión por la persona.

## Documentos relacionados

- **Agentes por CLI (versión vigente):** ADR-AGE-001 (`design/adr/ADR-AGE-001.md`). Este spec pide una versión nueva.
- **Ejecución aislada:** ADR-RUN-001. Las acciones de diseño siguen ejecutándose en el equipo, fuera del contenedor.
- **Clasificador:** ADR-CLA-001.
- **La petición original:** `docs/diseno-ux-2026-09-24.md:140`. FDR-INT-001 lo dejó fuera de alcance como *Models & providers*.
- **Referencias:**
  - la v1: `git show v1-referencia:app/codex.py` (invocación de Codex, `ai_events`, métricas) y `app/ai_config.py` (perfiles por acción);
  - el archivo de la visión original: DR-0027 (adaptadores y asignaciones) y DR-0032 (perfiles de ejecución).

## 1. Por qué

Queremos probar DEMIURGO de verdad, recreando DEMIURGO desde el Día 1. Hoy no se puede:
- **Siempre simulado.** El API arranca con el agente simulado: `DEMIURGO_AGENT` vale `simulated` por defecto.
- **Un solo motor.** El único adaptador real es `claude -p`, con un modelo para todas las tareas elegido por variable de entorno y sin effort.

La persona ya había pedido que DEMIURGO fuera agnóstico al agente y que ella eligiera qué modelo y con qué razonamiento se hace cada tipo de tarea. Nunca llegó a diseñarse.

## 2. Un ejemplo de punta a punta

La persona pulsa **Start** en el Día 1:

1. La pantalla de lectura pide una ejecución de la acción `exploration_chat` con el agente **`onboarding`**.
2. DEMIURGO construye el contexto de esa sección de forma determinista: la idea y sus fuentes. Es un context pack con huella.
3. Busca qué motor tiene asignado `onboarding`: primero en el proyecto y, si no hay, en la configuración global. Por ejemplo, *Codex · gpt-6-sol · high*.
4. Compone el prompt, también de forma determinista y con huella: `agents/onboarding/AGENT.md`, sus skills (`asking-questions`, `demiurgo-glossary`, `structured-output`) y las reglas de DEMIURGO.
5. Ejecuta en el equipo:
   ```
   codex exec --json --output-schema … -m gpt-6-sol -c model_reasoning_effort="high" …
   ```
   Lo hace sin herramientas, en una carpeta propia de la conversación.
6. Mientras trabaja, la web muestra en vivo los eventos de Codex: «thinking… 1 240 tokens».
7. La respuesta llega con el esquema fijo de `exploration_chat`. DEMIURGO la valida con Zod y la aplica: mensaje, preguntas y propuestas.
8. La ejecución registra: agente y versión, huella del prompt, proveedor, modelo pedido y observado, effort, sesión, eventos y métricas.
9. En el siguiente mensaje del hilo, DEMIURGO **reanuda la sesión de Codex** y envía solo lo nuevo.
10. Si la respuesta no convence, **Retry with…** permite repetirla con, por ejemplo, *Claude · opus · max*, solo esa vez.

## 3. Decisiones de la persona (25-09)

| Tema | Decisión |
|---|---|
| Qué es un agente | Un md más un conjunto de skills para una tarea concreta. Es distinto del motor que lo ejecuta (Claude, Codex u OpenCode) |
| Dónde viven | En ficheros del repo, versionados con git. Cada ejecución registra su huella |
| Dónde se asigna el motor | En una pantalla global en la web, con sobrescritura por proyecto y con «Retry with…» para un solo reintento |
| Enfoque | Capa propia con prompt compuesto. No se usan los agentes nativos de cada CLI ni una pasarela aparte |
| Modelos de Claude | Los alias `haiku`, `sonnet`, `opus` y `fable`, que siempre apuntan al último modelo. Tras cada ejecución se registra el modelo exacto |
| Salida | Estructurada y nativa en los tres motores: `--json-schema`, `--output-schema` y `format json_schema`. Después, siempre, se valida con Zod |
| Determinismo | Cada sección de la web recoge su contexto, compone el prompt con su agente y skills y lo manda al proveedor asignado. El esquema es fijo, en código y versionado. Solo la respuesta del modelo no es determinista |
| Sesión | Continuidad con delta determinista (§8) |
| Consumo | Solo se muestra, sin límites ni cortes |
| Nombres de modelo | Nunca se escriben: se eligen de listas descubiertas en cada proveedor |

## 4. Piezas

### Agentes y skills

Cada agente es un fichero `packages/core/agents/<id>/AGENT.md`:

```markdown
---
id: onboarding
description: Reads a new idea on Day 1 and opens the exploration.
action: exploration_chat
skills: [asking-questions, demiurgo-glossary, structured-output]
session: thread        # thread | none
time_limit: 300        # segundos; 300 por defecto
---
<instrucciones del agente, en inglés>
```

- **Skill:** `packages/core/skills/<id>/SKILL.md`, en formato Agent Skills: front-matter con `name` y `description`, y cuerpo. Los agentes las comparten.
- **Versión del agente:** la huella del AGENT.md más la de sus skills. Sustituye a `METHOD_VERSION` y a `packages/core/methods/<action>/v1.md`; su contenido pasa a los agentes nuevos.
- **Validación al cargar:** un agente que declara una acción inexistente o una skill que no existe impide arrancar. La prueba de arquitectura lo comprueba.
- **Agentes iniciales:**

  | Agente | Sección de la web | Acción | Sesión |
  |---|---|---|---|
  | `onboarding` | Día 1, lectura de la idea (`Reading.tsx`) | `exploration_chat` | por hilo |
  | `explorer` | Hilo, «Ask DEMIURGO» (`Composer.tsx`) | `exploration_chat` | por hilo |
  | `designer` | Hilo, «Draft it» | `design_proposal` | por hilo |
  | `knowledge_classifier` | Tras aceptar algo, al actualizar el conocimiento | clasificación | ninguna |
  | `knowledge_reviewer` | Cascada del clasificador. Opcional: si no tiene motor asignado, no hay cascada | clasificación | ninguna |
  | `echo` | Pruebas | `echo` | ninguna |

- **Skills iniciales:**
  - `asking-questions`: cómo hacer preguntas que desbloquean;
  - `writing-acs`: cómo escribir AC verificables;
  - `demiurgo-glossary`: el vocabulario de DEMIURGO;
  - `structured-output`: responder solo con el esquema.
- **Agente por defecto:** cada acción tiene uno. `run.request` acepta un `agent` opcional, que debe servir a esa acción.

### Composición

La composición es una función pura, sin E/S. Recibe el agente, sus skills, las reglas y el pack, y devuelve:
- **system:** el cuerpo del AGENT.md, las skills en el orden declarado y las reglas de DEMIURGO (hoy es el pie de `agentSystemPrompt` en `packages/core/src/agents/claude-cli.ts`);
- **input:** el context pack completo, o su delta (§8), como JSON delimitado con `delimitedJson` y marcado como dato no confiable;
- **`prompt_hash`:** la huella del system.

Con los mismos ficheros y el mismo pack sale la misma huella.

### Acciones

El contrato de cada acción no cambia:
- **Constructor de contexto determinista:** `packages/core/src/context/build.ts` y `packages/core/src/actions/*`.
- **Esquema Zod fijo:** `OUTPUT_SCHEMAS` en `packages/domain/src/agents.ts`. Su versión es `schemaVersion`.
- **Aplicador:** `packages/core/src/actions/appliers.ts`.

Un agente nunca cambia el esquema ni el contexto de su acción.

### Proveedores

Cada proveedor es un adaptador, con el mismo puerto para todos:

```ts
interface Provider {
  readonly id: 'claude' | 'codex' | 'opencode' | 'simulated';
  discover(): Promise<ProviderCatalog>;          // sin cuota
  run(invocation: ProviderInvocation): Promise<AgentResult>;
}
```

- **Invocación:** lleva el system y el input compuestos, el JSON Schema, el modelo, el effort, la sesión (nueva, reanudada o ninguna), el tiempo límite, la señal de cancelación y un receptor de eventos.
- **Resultado:** es el `AgentResult` actual, ampliado con las métricas normalizadas y el id de sesión del proveedor.
- **Registro de proveedores:** `AgentPort` deja de ser un agente global (`Services.agent`) y pasa a ser un registro de proveedores. El paso `invoke` del motor (`packages/core/src/engine/engine.ts`) resuelve el proveedor que guarda la ejecución.
- **Procesos:** todos se lanzan con `packages/core/src/agents/process.ts`, y el `Launcher` inyectable sigue siendo la costura de las pruebas.
- **Entorno:** `packages/core/src/env.ts` pasa a tener una lista permitida por proveedor. Codex necesita su `CODEX_HOME`; OpenCode, su configuración propia. Nunca entran credenciales de DEMIURGO ni de la base.
- **Proveedor `simulated`:** es el simulador actual. Solo aparece en los desplegables con `DEMIURGO_DEV_TOOLS=1`. Las pruebas lo asignan en su preparación.

**Desaparecen** `DEMIURGO_AGENT`, `DEMIURGO_AGENT_MODEL`, `DEMIURGO_CLASSIFIER`, `DEMIURGO_CLASSIFIER_MODEL`, `DEMIURGO_REVIEWER` y `DEMIURGO_REVIEWER_MODEL` (`packages/core/src/config.ts` y `startup.ts`). Todo se elige en la web.

### Clasificador

- El clasificador de referencia (`packages/core/src/classifier/claude-reference.ts`) pasa por la capa de proveedores con el agente `knowledge_classifier`, que se asigna como los demás.
- El id del clasificador, que forma parte de la clave de la caché de veredictos, pasa a ser `agent:knowledge_classifier@<versión>/<proveedor>/<modelo>/<effort>`. Cambiar el motor invalida la caché a propósito, como hoy cambiar el modelo.
- La cascada usa `knowledge_reviewer` si está asignado.
- Las llamadas del clasificador dejan el mismo rastro que las ejecuciones: eventos, métricas y consumo. Hoy no dejan nada. Lo preferente es registrarlas como ejecuciones de la acción `knowledge_classification`, creadas por el paso de actualización del conocimiento.
- Jev sigue detrás del puerto `Classifier`, fuera de este alcance.

## 5. Descubrimiento de modelos y efforts

El descubrimiento se hace al arrancar el API y cuando la persona pulsa **Refresh**. No gasta cuota. El catálogo se guarda en la base con la fecha en que se descubrió.

| Proveedor | ¿Está listo? | Modelos | Efforts |
|---|---|---|---|
| Codex | `codex --version` y `codex login status` | `codex debug models`: los de `visibility == "list"`. Alternativa: `~/.codex/models_cache.json` | `supported_reasoning_levels[].effort` y `default_reasoning_level` de cada modelo |
| OpenCode | Servidor privado vivo (§6), y el endpoint de cada proveedor local responde (Qwen: `127.0.0.1:8080/health`) | API del servidor privado: proveedores y modelos. Alternativa: `opencode models`, que devuelve vacío a veces | `variants` de cada modelo (Qwen: low / medium / high / xhigh) |
| Claude | `claude --version` y `claude auth status` | Los alias `haiku`, `sonnet`, `opus` y `fable`, fijados en el adaptador y revisados al cambiar la versión de la CLI | Leídos de `claude --help`: low / medium / high / xhigh / max |

**Qué recoge cada entrada del catálogo:**
- instalado o no, versión, sesión iniciada;
- un mensaje si algo falla;
- los modelos, cada uno con su etiqueta, sus efforts y su effort por defecto.

**Si un modelo asignado desaparece**, la asignación se marca *unavailable* y ese agente no se ejecuta hasta que la persona elija otro. **DEMIURGO nunca cambia de proveedor ni de modelo por su cuenta.**

## 6. Ejecución por proveedor

Todo se ejecuta en el equipo, como fija ADR-RUN-001 para las acciones de diseño, con estas reglas comunes:
- **Carpeta de trabajo:** sin sesión, una carpeta temporal vacía que se borra al terminar; con sesión, una carpeta estable por conversación en `%LOCALAPPDATA%\Demiurgo\agent-sessions\<proveedor>\<clave>`.
- **Aislamiento:** sin herramientas, sin la configuración del usuario, con el entorno filtrado y con salida estructurada nativa.
- **Tiempo límite:** el `time_limit` del agente. Hoy es un valor fijo de 180 s (`AGENT_TIME_MS`).

**Claude** reutiliza `createClaudeCliInvoker`, `normalizeClaudeOutput` y la resolución del ejecutable:

```
claude -p --output-format stream-json --verbose --json-schema <schema> --model <alias> --effort <effort>
  --system-prompt <system> --tools "" --strict-mcp-config --safe-mode --setting-sources ""
  [--session-id <uuid> | --resume <id> | --no-session-persistence]
```

- El input entra por stdin, como hoy.
- Se sigue comprobando el límite de longitud de la línea de órdenes en Windows.
- Pasa de `--output-format json` a `stream-json` para tener los eventos (§9).

**Codex**, siguiendo la invocación de la v1:

```
codex exec --json --output-schema <dir>/schema.json --output-last-message <dir>/last.json
  -m <model> -c model_reasoning_effort="<effort>" --ignore-user-config --ignore-rules
  --skip-git-repo-check --sandbox read-only -C <dir> [--ephemeral] -
```

- La sesión se reanuda con `codex exec resume <id>`.
- `--ignore-user-config` deja fuera los plugins y MCP de la persona; la autenticación sigue en `CODEX_HOME`.
- **Aviso:** con sesión, las conversaciones quedan en el historial de Codex de la persona, en `~/.codex/sessions`.

**OpenCode:** `opencode run` no tiene opción de esquema, pero su servidor sí la tiene.
- DEMIURGO arranca un `opencode serve` privado. Lo arranca al primer uso o al descubrir, y lo para con el API.
- Usa una configuración propia de DEMIURGO:
  - un agente `demiurgo` con todas las herramientas denegadas. La configuración de la persona autoaprueba permisos, así que no se usa;
  - los proveedores de la persona, con `supportsStructuredOutputs: true` en el de Qwen para que el esquema llegue al modelo.
- Cada petición va a su API de sesión con `format: {type: "json_schema", schema}`. OpenCode reintenta internamente hasta 2 veces si la salida no encaja.
- La sesión de OpenCode es la sesión del hilo.

**Esquema por proveedor.** El JSON Schema sale siempre del Zod de la acción (`jsonSchemaOf`, draft-07).
- Si el modo estricto de Codex u OpenCode rechaza algo de nuestros esquemas (límites de longitud, `format: uuid`), el adaptador deriva su variante de forma pura y determinista.
- **Zod es siempre el juez final:** si no encaja, la ejecución falla como `invalid_output` y no se aplica nada.

**Fallos.** Siempre visibles, nunca se aplica nada, y desde cualquiera se ofrece «Retry with…».

| Tipo | Ejemplo de mensaje |
|---|---|
| `infra` | «Codex isn't signed in: run `codex login`» |
| `infra` | «gpt-6-sol is no longer offered by Codex. Choose another model» |
| `timeout` | «No answer in 5 min» |
| `invalid_output` | Se conserva la salida en bruto |
| `cancelled` | — |

## 7. Asignación

- **Tipos:** hay una asignación **global** y una sobrescritura **por proyecto** para cada agente. Cada una lleva proveedor, modelo y effort.
- **Comandos:** `agent.assign` y `agent.unassign` pasan por el bus.
  - Solo los puede ejecutar un actor `human`.
  - Validan contra el último catálogo que el modelo existe en ese proveedor y el effort en ese modelo.
  - Dejan evento en el diario.
- **Resolución** al pedir la ejecución (`run.request`), en este orden:
  1. el override de «Retry with…»;
  2. la asignación del proyecto;
  3. la global;
  4. si no hay ninguna, error visible: «Choose a model for onboarding», con enlace a la pantalla.
- **Qué queda en la ejecución:** el resultado se guarda en ella (`provider`, `requested_model`, `effort`). Cambiar una asignación después no altera ejecuciones ya pedidas.
- **Retry with…:** `run.retry` acepta `override: {provider, model, effort}`, validado igual. Reutiliza el mismo context pack y empieza siempre con sesión nueva.

## 8. Sesión y delta determinista

- **Clave de conversación:** hilo o exploración + agente@versión + proveedor + modelo.
- **La fuente de verdad** es siempre el context pack completo, que se construye y se guarda con su huella (`context_packs`, inmutable).
- **Cuándo se reanuda.** Solo si se cumplen las cuatro condiciones:
  1. el agente declara `session: thread`;
  2. la última ejecución con esa clave terminó bien y tiene sesión de proveedor;
  3. el pack nuevo *solo añade* al anterior: cada elemento del pack anterior aparece idéntico, en su sección, en el pack nuevo;
  4. el proveedor acepta reanudar esa sesión.

  En ese caso se reanuda y se envía solo el **delta**: los elementos nuevos, calculados de forma pura como diferencia entre los dos packs y con su propia huella.
- **Cuándo se empieza sesión nueva.** En cualquier otro caso, con el pack completo. Por ejemplo:
  - otro modelo u otra versión del agente;
  - un registro editado;
  - una sesión caducada o perdida;
  - un fallo anterior;
  - un reintento.
- **Qué registra cada ejecución:**
  - `session_mode`: `fresh`, `resumed` o `none`;
  - `provider_session_id`;
  - `delta_hash`, si hubo delta.

  La tabla de sesiones guarda, por clave, la sesión viva y la última ejecución que la usó.

## 9. Eventos, métricas y consumo

- **Eventos.** Cada evento del stream de la CLI se guarda al llegar, en bruto y con su secuencia y hora, por ejecución e intento, como `ai_events` en la v1.
  - Streams por motor: Claude `stream-json`, Codex `--json` y los eventos de sesión del servidor de OpenCode.
  - Cada evento se normaliza como `started`, `thinking`, `message`, `usage`, `result` o `error`.
  - Se emite en vivo por el SSE del proyecto, que ya existe.
  - Sustituye a guardar solo la salida comprimida en `ai_run_logs`; `ai_run_logs` se conserva para los datos que ya existen.
- **Métricas normalizadas** por ejecución (el `usageSchema` de `packages/core/src/commands/runs.ts` se amplía):
  - tokens de entrada, de caché, de salida y de razonamiento, y turnos;
  - tiempos por fase: contexto, llamada, validación y aplicación;
  - coste declarado (solo si el proveedor lo informa) y modelo observado;
  - *provenance*: de qué campo del proveedor sale cada cifra, o `not_reported`.
- **Estadísticas** por consulta, sin tabla propia, agrupadas por agente, proveedor, modelo y effort:
  - número de ejecuciones y fallos por tipo;
  - tiempo medio y tokens medios;
  - preguntas y propuestas por ejecución, leídas de la salida tipada.
- **Consumo:** tokens y coste declarado de hoy y de la semana, por proveedor y por agente. **Solo se muestra**: no hay límites, avisos ni cortes.

## 10. Datos, comandos y API

**Tablas nuevas** (van en `design/data/` como datos y se generan con `pnpm gen`; migración SQL nueva en `packages/core/migrations/`):
- `provider_catalogs`: proveedor, fecha, estado y modelos. Cada refresco añade una fila y la más reciente es la vigente.
- `agent_assignments`: `scope` (`global` o `project`), `project_id`, `agent`, `provider`, `model`, `effort`, quién y cuándo.
- `agent_sessions`: clave de conversación, `provider_session_id`, última ejecución y estado.
- `ai_run_events`: `run_id`, `attempt`, `seq`, `received_at`, `kind`, `raw`.

**Columnas nuevas en `ai_runs`:** `agent`, `prompt_hash`, `requested_model`, `effort`, `session_mode`, `provider_session_id` y `delta_hash`.
- `method` pasa a guardar `<agente>@<versión>`; antes era `<acción>@v1`.
- `provider` pasa a ser el de la asignación resuelta, no el del agente global.

**Comandos:**

| Comando | Quién | Qué cambia |
|---|---|---|
| `agent.assign` / `agent.unassign` | `human` | Nuevos |
| `providers.refresh` | `human` o `system` | Nuevo |
| `run.request` | — | Acepta `agent` |
| `run.retry` | — | Acepta `override` |

Las capacidades van en `design/data/capabilities.yaml` y las invariantes 403/409 se generan desde ahí.

**API:**
- `GET /api/providers`: catálogo, estado, consumo y estadísticas;
- `POST /api/providers/refresh`;
- `GET /api/agents`: agentes con sus skills, acción, secciones y asignaciones, la global y la del proyecto si se pasa `project`;
- `GET /api/runs/:id/events`;
- las asignaciones, por la ruta genérica de comandos.

## 11. Web

La pantalla se dibuja antes en el canvas «DEMIURGO · UX», página 14, y la persona reacciona sobre ella. Después se construye con los componentes de `packages/web`.

- **Settings → Models & providers:**
  - una tarjeta por proveedor, con su estado (instalado, versión, sesión), sus modelos y efforts, y **Refresh**;
  - una tabla de agente → proveedor / modelo / effort, con desplegables que solo ofrecen lo descubierto;
  - el consumo de hoy y de la semana, y las estadísticas por modelo.
- **Por proyecto:** la misma tabla, con las sobrescrituras y la opción de volver a la global.
- **Página de la ejecución** (`packages/web/src/screens/run/Run.tsx`):
  - agente y versión, motor pedido y observado, effort y modo de sesión;
  - métricas y línea temporal de eventos;
  - **Retry with…**.
- **Progreso en vivo** en `Reading.tsx` y en la conversación del hilo, por ejemplo «thinking… N tokens».
- **Aviso** «Choose a model for <agent>» donde se pide una ejecución sin motor asignado.

## 12. Comportamientos que serán AC

Nacen como AC de una FDR nueva, **FDR-AGE-001 «Agents & providers»**, que acompaña a la versión nueva de ADR-AGE-001. Cada AC automático tendrá una prueba cuyo título empieza por su código.

1. El descubrimiento lista los modelos y efforts de cada proveedor sin llamar a ningún modelo, y guarda el catálogo con su fecha.
2. Solo una persona asigna o quita un motor. Un modelo o un effort que no están en el catálogo se rechazan con 422.
3. La resolución sigue el orden override → proyecto → global. Si no hay asignación, la ejecución no se crea y el error nombra al agente.
4. Con los mismos ficheros y el mismo pack, la composición da la misma `prompt_hash`.
5. Cada ejecución registra agente y versión, `prompt_hash`, proveedor, modelo pedido y observado, effort y modo de sesión.
6. Cada adaptador (Claude, Codex, OpenCode) se invoca con salida estructurada nativa, sin herramientas, sin la configuración del usuario y con el entorno filtrado. Se comprueba con fixtures grabadas.
7. Toda salida se valida con el Zod de la acción, venga del proveedor que venga. Si no encaja, `invalid_output` y no se aplica nada.
8. Un modelo asignado que desaparece del catálogo deja la asignación *unavailable*, y nunca hay cambio automático de proveedor o modelo.
9. La sesión se reanuda solo si el pack nuevo solo añade al anterior. En cualquier otro caso, y en todo reintento, empieza de nuevo.
10. Los eventos se guardan en orden y se emiten en vivo. Las métricas son las mismas para todos los proveedores y llevan su *provenance*.
11. «Retry with…» crea una ejecución con el mismo pack y el motor elegido.
12. El consumo de hoy y de la semana, por proveedor y por agente, coincide con la suma de las ejecuciones.
13. El proveedor `simulated` solo se ofrece con `DEMIURGO_DEV_TOOLS=1`.

## 13. Puntos a verificar con llamadas reales (spike)

Antes de construir los adaptadores se hace el mínimo de llamadas reales, pidiendo permiso antes: Qwen es gratis; Claude y Codex, una o dos cada uno. Las salidas se guardan como fixtures en `packages/core/test/fixtures/<proveedor>/`. Hay que comprobar:

- **Codex:**
  - dónde recibe el system prompt compuesto: una opción `-c` de instrucciones, un `AGENTS.md` en la carpeta o el propio prompt;
  - cómo desactivar sus herramientas (shell) además de `--sandbox read-only`;
  - si `--output-schema` acepta nuestros esquemas;
  - si `exec resume` admite `--output-schema`.
- **OpenCode:**
  - arranque de un servidor privado con configuración propia;
  - `format json_schema` en su API de sesión;
  - denegación de todas las herramientas;
  - descubrimiento de proveedores, modelos y variantes;
  - salida estructurada de Qwen con `supportsStructuredOutputs`.
- **Claude:**
  - `stream-json` junto con `--json-schema`;
  - `--session-id` y `--resume` en una carpeta estable, junto con las opciones de aislamiento.

Si algo de esto no funciona como se espera, se ajusta el adaptador sin tocar el resto del diseño.

## 14. Fuera de alcance (Later)

- Límites automáticos de cuota o coste.
- Exportar a OpenTelemetry.
- Agentes con herramientas o MCP.
- Skills que aprenden de patrones de uso (motor de mejora continua): sus cambios entrarán como propuesta.
- Jev.
- Escalado de perfil por intentos (S5).
- API keys.
- Proveedores en contenedor (S4).

## 15. Orden de trabajo

El orden prioriza poder probar pronto:

1. **Spike:** verificar los puntos de §13 y grabar las fixtures.
2. **Diseño en `design/`:** FDR-AGE-001 con sus AC, una versión nueva de ADR-AGE-001, las tablas y las capacidades.
3. **Agentes y skills** en ficheros, más el compositor. Los prompts actuales pasan a `agents/`.
4. **Capa de proveedores:** los tres adaptadores, el descubrimiento, los eventos y las métricas.
5. **Asignaciones**, el override de «Retry with…» y la API.
6. **Sesión con delta.**
7. **El clasificador** por agentes.
8. **La web**, a partir del canvas aprobado. El canvas se dibuja en paralelo desde el paso 1.
9. **Prueba real** en el entorno de desarrollo:
   1. asignar los motores;
   2. guardar una instantánea;
   3. hacer el Día 1 de DEMIURGO;
   4. comprobar eventos, métricas, la reanudación de sesión, «Retry with…» y el consumo.
