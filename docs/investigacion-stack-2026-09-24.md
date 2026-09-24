# Recomendación de stack para DEMIURGO v2

*Fecha: 24-09-2026. Este documento resume la investigación de 7 áreas, 3 arquitecturas candidatas y 3 jueces independientes. Las versiones y fechas salen del dossier, que las verificó contra fuentes primarias: registros npm, PyPI y proxy.golang.org, documentación oficial y changelogs.*

*Revisión del 24-09-2026 (tarde): la v1 se descarta por completo y no recibe arreglos. Se añaden el grafo de conocimiento y el clasificador Jev del motor de contexto (§2 y §5), según `docs/plan-reimplementacion-2026-09-24.md` §7.*

---

## 1. Recomendación en una frase

**Recomiendo construir el núcleo de DEMIURGO v2 en TypeScript estricto sobre Node.js 26 LTS, en un monorepo pnpm 11, con PostgreSQL 18 como única base de datos y DBOS Transact como motor durable en el mismo Postgres. La máquina de estados propia decide cada avance, los agentes (Claude Code y Codex) son ejecutores no confiables en contenedores aislados y los hard gates los ejecuta el sistema.**

**¿TypeScript? Sí, en el núcleo.** Hay tres razones que se pueden verificar. No incluyo la de «los LLM programan mejor en TS», porque los benchmarks se contradicen.

1. **SDKs de agentes.** Solo TS y Python tienen SDK oficial de Claude Agent y de Codex, y el SDK TS de Claude es el más completo: hooks con `AbortSignal`, `canUseTool`, unos 20 eventos exclusivos y `spawnClaudeCodeProcess` para ejecutar el CLI dentro de contenedores ([agent-sdk/overview](https://code.claude.com/docs/en/agent-sdk/overview), [hooks](https://code.claude.com/docs/en/agent-sdk/hooks), [typescript](https://code.claude.com/docs/en/agent-sdk/typescript)).
2. **Un solo contrato.** Zod genera a la vez la validación HTTP, el OpenAPI, los tipos de la UI, el JSON Schema de salida de los modelos y el `inputSchema` de MCP. Así desaparece la deriva que tenía la v1 (`schema.json` desacoplado).
3. **Dogfooding completo.** Las apps que genere DEMIURGO serán web en TS. Si la v2 usa el mismo stack, cada mejora de gates, plantillas y contexto sirve a la vez a DEMIURGO y a sus apps.

**¿Go? No para el núcleo, aunque es una alternativa seria.** Un juez (el de seguridad y gobernanza) lo prefirió: tiene la mejor supervisión de procesos, binario único, menos superficie de cadena de suministro y el ecosistema de sandboxing es nativo en Go. En contra pesan tres cosas: no hay SDK oficial de Claude ni de Codex para Go, habría dos lenguajes en el repositorio y el dogfooding sería parcial. **Go queda como opción para una sola pieza, el broker de contenedores**, si el supervisor en Node da problemas. La frontera `JobSpec` permite reescribirlo sin tocar nada más.

**¿Python? No en el núcleo, sí en un laboratorio offline de evals** (Inspect, DSPy/GEPA, MLflow) a partir de la fase de aprendizaje.

**Condición antes de congelar la decisión** (el lenguaje es lo menos reversible): un spike medido de 2-3 días. En él, Claude Code y Codex construyen el mismo slice vertical (máquina de estados, workflow DBOS, broker, gate-runner y evidencia). Se miden las iteraciones hasta pasar los gates, los tokens y los reintentos.

---

## 2. Stack recomendado por capa

| Capa | Elección | Alternativa | Por qué | Madurez verificada | Reversibilidad |
|---|---|---|---|---|---|
| Lenguaje del núcleo | TypeScript estricto con `erasableSyntaxOnly` (sin enum, namespaces con código ni parameter properties) | Go 1.27 | SDKs de agentes, contrato Zod único, dogfooding | TS 7.0 GA el 08-07-2026 (7.0.2 en npm); sin API programática hasta la 7.1 | **Baja**: cambiarlo es reescribir |
| Runtime | Node.js 26 LTS (Active LTS desde el 28-10-2026; hasta entonces, 26 current) | Node 24 solo si se elige Temporal | Node 24 entra en Maintenance el 20-10-2026 (EOL 30-04-2028) | [schedule.json](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json) | Media |
| Paquetes y repositorio | pnpm 11.x fijado (`packageManager` con hash) con `minimumReleaseAge`, `strictDepBuilds`/`allowBuilds`, `blockExoticSubdeps` y `trustPolicy no-downgrade`. Monorepo de workspaces sin Turborepo | pnpm 12 (reescrito en Rust, 26-08-2026), cuando cumpla 3 meses | Defensas por defecto contra ataques como Shai-Hulud o el de @tanstack/* (11-05-2026) | pnpm 11.27.0 (12-09-2026) | Alta |
| Contratos | Zod 4.6 → OpenAPI 3.1 (fastify-type-provider-zod 7 y @fastify/swagger) → openapi-typescript 7 + openapi-fetch. Gate de deriva: regenerar y exigir `git diff` vacío | oRPC 1.15 (no la 2.0 beta); Hey API solo con versión exacta (está en «initial development») | Una sola fuente de verdad. OpenAPI mantiene el contrato neutral respecto al cliente | Zod 4.6.5 | Media |
| API HTTP y SSE | Fastify 5.12.x con SSE propio sobre un log de eventos durable (`Last-Event-ID`) | Hono 4 | Node real, corpus amplio. Fastify 6 sigue en alpha | Fastify 5.12.5 | Alta |
| Sesión humana y actor | Cookie HttpOnly SameSite=Strict + CSRF + lista blanca de Host/Origin. Better Auth 1.7.x solo con email/contraseña y passkey (magic-link desactivado). `actor_id` obligatorio en toda mutación | Sesión propia mínima con WebAuthn | Corrige la falta de actor de la v1, donde cualquiera podía declarar approved o passed | Better Auth 1.7.5. En 2026 tuvo 1 advisory crítico (plugin SCIM) y 7 altos, uno en el núcleo (magic-link/OTP) | Media |
| Base de datos | PostgreSQL 18.x (imagen `pgvector/pg18`, pgvector sin activar hasta que una eval lo justifique). FTS `spanish`, `uuidv7()`, `RETURNING OLD/NEW` | — (SQLite, libSQL y PGlite descartados) | Elimina la contención de la v1, es el sustrato de DBOS TS y permite pasar a equipos | PG 18.6 (13-08-2026), soporte hasta 11-2030; pgvector 0.8.6 | Alta hacia otros Postgres |
| Acceso a datos | Kysely 0.29.6 + migraciones SQL planas revisadas por una persona + squawk | Drizzle 0.45.3 fijado (la 1.0 va por la rc.4 y cambia migraciones y RQB) | SQL explícito que los agentes leen y verifican. Es datasource transaccional de DBOS. Prisma 8 en RC queda descartado | Kysely 0.29.6 (0.30 en beta) | Media |
| Máquina de estados (capa 1) | Tabla de transiciones propia con guardas puras, versionada con `GATES_VERSION`, probada con fast-check | XState v5 | Qué evidencia vale y quién puede aprobar es lógica de dominio, no del motor | Patrón propio | **Baja**: es la identidad del producto |
| Motor durable (capa 2) | **DBOS Transact TS** (MIT) sobre el mismo Postgres, con esquema y rol propios | **Temporal** TS (servidor MIT v1.32.0) | Transición de dominio y checkpoint en una sola transacción; sin servidor extra; un único backup | @dbos-inc/dbos-sdk 5.0.2 (la 5.0 salió el 16-09-2026, hace 8 días): fijar tras el spike o usar la última 4.x | Moderada-alta: el pegamento del workflow son cientos de líneas |
| Ejecutores de código | Puerto `Executor` + Claude Agent SDK TS 0.3.281 + Codex (SDK TS 0.156.1 o `codex exec --json`) | Después del MVP: OpenCode SDK, ACP o GitHub Copilot SDK (BYOK) | Gobernar arneses maduros en lugar de escribir un bucle propio | Ambos 0.x con publicaciones casi diarias | Alta, gracias al puerto |
| LLM no agéntico (Pilar 1) | Vercel AI SDK 7 con salida estructurada Zod (Anthropic, OpenAI, Qwen compatible con OpenAI) | Llamadas directas con los SDK oficiales | Selección de proveedor sin gateway | ai 7.0.113 (GA 25-06-2026) | Alta |
| Grafo de conocimiento | Tablas de nodos y aristas en el mismo PostgreSQL, con CTE recursivas, detrás del puerto `KnowledgeGraph`. Es una proyección reconstruible de la autoridad | Memgraph (la elección de la visión original) o Apache AGE, si las consultas o el volumen lo justifican | Una sola base y una sola copia de seguridad; transacción junto a la autoridad | Patrón propio | Alta: se reconstruye en el motor nuevo |
| Clasificador (System One) | **Jev** de TypeSafe AI (`jev-latest`, SDK `@typesafe-ai/sdk` 0.6, MIT) detrás del puerto `Classifier`: decisiones tipadas y calibradas (Choice, Score, Noul), sin generar texto | Un LLM pequeño con salida estructurada (por ejemplo Haiku 4.5) como referencia y alternativa | 70–500 ms y 0,042 $ por millón de tokens de entrada según el fabricante: permite actualizar el conocimiento en cada evento | Early access desde el 15-09-2026, API propietaria en EE. UU.; precisión en español sin medir | Alta, gracias al puerto |
| MCP | DEMIURGO como servidor MCP con @modelcontextprotocol/server 2.1.x, hablando las revisiones 2025-11-25 y 2026-07-28 | SDK v1.30 (seguirá recibiendo correcciones al menos 6 meses) | Todos los arneses consumen MCP. Canal de contexto y de propuestas | Especificación 2026-07-28 (sin estado, con cambios que rompen compatibilidad) | Alta |
| Sandbox | Broker propio (dockerode 5.x, paquete con lock propio y dependencias mínimas) + contenedores endurecidos + proxy de egress y pasarela de modelo | Docker Sandboxes `sbx` (microVM; spike) y OpenSandbox (evaluar) | Es lo único maduro hoy en Windows con Docker | sbx v0.45.x, con cambios incompatibles casi semanales | Alta (contrato: imagen OCI + SHA + JobSpec) |
| Gates y verificación | tsgo 7.0.2 `--noEmit`, oxlint 1.85 + tsgolint 7.0.2002 (lint con tipos), Biome para formato, Vitest, Playwright 1.63, @axe-core/playwright 4.13 | typescript-eslint sobre `@typescript/typescript6` para las reglas que falten | Gates baratos y deterministas con salida JUnit, SARIF o JSON | oxlint con lint de tipos estable desde el 22-07-2026 (59 de 61 reglas) | Media |
| Observabilidad | Registro propio en Postgres (fuente de verdad) + OTel JS con un único adaptador. Collector y Jaeger v2 opcionales | MLflow 3.16 (ligero) o Langfuse v4 (para equipos) | OTel pierde datos y no puede sostener gates | Semconv GenAI en «Development», sin releases | Alta en el backend, baja en el esquema del registro |
| Frontend | SPA React 19.3 + Vite 8.3 + React Router 8.4 (framework, `ssr:false`, typegen como gate) + TanStack Query 5 + shadcn/ui 4.x (una sola familia de primitivas) + Tailwind 4.3 | TanStack Router v1 (mejor tipado de search params) | Sin SEO: SSR/RSC solo añade superficie (CVE-2025-55182, CVSS 10). El router coincide con el de la plantilla de apps | React 19.3.0 (09-09-2026); Vite 8.3.0; RR 8.0 salió el 17-06-2026 | Media (el router es lo más caro de cambiar) |
| Despliegue local | Docker Compose en Docker Desktop (backend Hyper-V preferido), un proyecto por instancia, datos en `%LOCALAPPDATA%\Demiurgo\v2` | Podman Desktop para equipos | Mantiene el modelo operativo actual y separa los privilegios | Docker Desktop gratuito por debajo de 250 empleados y 10 M$ | Alta |

**Política transversal de versiones («majors aburridos»):** fijar versiones exactas y preferir las anteriores al corte de entrenamiento de los modelos cuando la ganancia sea marginal (Vitest 4.x o 5.0.x según el spike, DBOS 4.x o 5.0.x, ninguna major con menos de 3 meses salvo justificación; TS 7 sí se justifica porque tsgo es el gate central). Documentación fijada a la versión dentro del repositorio (llms.txt o docs fijadas) y lint de imports prohibidos para APIs viejas (Remix v2, RR v6 `react-router-dom`, Zod 3).

---

## 3. Comparativa TS vs Go vs Python

| | **TS-E2E** | **Go-core** | **Py-Core** |
|---|---|---|---|
| Juez 1 (calidad y mantenibilidad con agentes, alineación con el stack de referencia) | **8** | 6,5 | 5 |
| Juez 2 (seguridad, gobernanza, fronteras de confianza) | 7,5 | **8** | 7 |
| Juez 3 (entregar el MVP rápido y con bajo riesgo, madurez de los SDK, dogfooding) | **8** | 5,5 | 7 |
| **Media** | **7,83** | 6,67 | 6,33 |
| Veredicto | Ganador para 2 de 3 jueces | Ganador para el juez de seguridad | Tercero |

**Dealbreakers por opción**

- **TS-E2E.** Ninguno absoluto. Hay tres condicionales, y los incorporo como invariantes:
  1. El worker que consume las colas DBOS (y por tanto tiene credenciales de Postgres) **no puede ejecutarse en el dominio no confiable T1**. El SDK vive en T0 y solo el CLI corre en T1 (con `spawnClaudeCodeProcess` o con un stream stdio del broker).
  2. El broker, que tiene el socket de Docker y equivale a root en la VM, **no puede arrastrar un árbol npm sin auditar**: paquete con lock propio y dependencias mínimas, o Go.
  3. La cancelación de DBOS TS solo actúa «at the beginning of its next step» ([workflow-management](https://docs.dbos.dev/typescript/tutorials/workflow-management)). Sin `docker kill` desde el broker se repetiría el defecto de la v1.
- **Go-core.**
  1. No hay SDK oficial de Claude ni de Codex, así que habría que mantener adaptadores sobre stream-json y JSONL de CLIs que se publican a diario.
  2. Desalineación con el stack de referencia TS: el dogfooding sería parcial.
  3. Hecho verificado por el juez: en DBOS Go, cancelar por API no cancela el contexto de los pasos en curso, así que la ventaja idiomática en cancelación era menor de lo que se afirmaba.
- **Py-Core.**
  1. Tipado opcional con stubs incompletos (`Any`): el gate de tipos filtra menos. Pyrefly 1.3.1 es estable; ty 0.0.83 sigue en beta.
  2. Dos lenguajes sin la verificabilidad de Go.
  3. SDK de Claude en Python clasificado «Alpha» (0.2.159) y SDK de Codex apoyado en el app-server, que OpenAI declara experimental.
  4. Riesgo de repetir los hábitos de la v1 (monolito, bloqueos en async).

**Lo honesto sobre la evidencia.** El dato del 94 % de errores de tipos procede de HumanEval/MBPP con modelos pequeños ([arXiv 2504.09246](https://arxiv.org/abs/2504.09246)) y no sirve para comparar TS con Go. En SWE-bench Multilingual, JS/TS saca 34,88 % y Go 30,95 %, pero Rust (58 %) y Java (53 %) quedan por delante, con unas 43 tareas por lenguaje y un modelo de 2025 ([swebench.com](https://www.swebench.com/multilingual.html)). Multi-SWE-bench pone TS/JS en último lugar ([arXiv 2504.02605](https://arxiv.org/abs/2504.02605)). **La elección de TS se apoya en el ecosistema de agentes, en el contrato único y en el dogfooding, no en benchmarks.** Por eso el spike es obligatorio.

**Ideas que se incorporan de las opciones perdedoras**

- De Go: los gates se definen como datos (perfil de stack versionado y neutral respecto al lenguaje). Una herramienta MCP `authorize` en T0 decide los permisos. Se cubren desde el MVP las líneas cambiadas y las vulnerabilidades. Hay un gate de determinismo del workflow: Opengrep y lint prohíben `Date.now`, `Math.random` y E/S en el cuerpo del workflow, y hay test de replay y recuperación.
- De Python: cancelación de tipo «preemptible» (`AbortSignal` propagado del workflow al adaptador y al broker, que hace `docker kill`, con un criterio de aceptación de «muere en menos de X s»). Las acciones de IA del Pilar 1 también corren en sandbox, porque procesan documentos importados no confiables. Passkeys o Windows Hello para aprobar y conceder excepciones de gate. Un único `pnpm gate:*` como punto de entrada común para el hook Stop, la CI y el gate-runner. Un servidor MCP de solo lectura más `propose` desde S1 para ensayar los contratos.

---

## 4. Orquestación determinista y hard gates

**Arquitectura en dos capas.** Ningún motor sustituye a la capa 1.

1. **Capa 1, máquina de estados de dominio** (`packages/domain`, TS puro sin E/S). Es una tabla de transiciones con guardas puras, versionada con `GATES_VERSION`, y la **única** vía para cambiar el estado de Change Sets, tareas, gates y aprobaciones. Las guardas solo aceptan evidencia con `producer=system_gate` y actores humanos autenticados. **Lo que declara el agente nunca entra en una guarda.** Se prueba con fast-check, sin infraestructura.
2. **Capa 2, motor durable: DBOS Transact TS** sobre el mismo Postgres.
   - Un workflow **genérico y estable** por Change Set: `loop { acción = SM.next(estado); ejecutarPaso(acción) }`. Así los agentes que construyen la v2 apenas tocan el código de orquestación.
   - Cada transición es un **paso transaccional con datasource Kysely**: la escritura de dominio y el checkpoint se confirman en la misma transacción ([transaction-tutorial](https://docs.dbos.dev/typescript/tutorials/transaction-tutorial)). Una sola fuente de verdad y un solo `pg_dump`.
   - **Cola particionada con concurrencia 1 por workspace**, deduplicación por `workflowId+paso` y reintentos declarativos.
   - **Recuperación automática al arrancar**, sin necesidad de Conductor ([architecture](https://docs.dbos.dev/architecture)). El broker reconcilia los contenedores huérfanos por etiqueta.

**Ciclo de un Change Set**

1. Preparar el workspace: clon del SHA base en un volumen con nombre.
2. **Autor de tests de aceptación**, un rol distinto del implementador, que escribe un test por AC.
3. **Revisión humana** de los escenarios en lenguaje de producto y **congelación por hash** (antes, normalizar EOL con `.gitattributes`: `* text=auto eol=lf`).
4. Gate **«rojo antes»**: los tests congelados tienen que fallar en el SHA base.
5. **Implementador** en el contenedor T1, con los tests montados en solo lectura, presupuesto duro (`maxTurns`, `maxBudgetUsd` y un tiempo de reloj impuesto desde fuera) y un canal explícito `request_clarification` para «no puedo cumplir el AC». ImpossibleBench muestra que ese canal reduce mucho las trampas ([arXiv 2510.20270](https://arxiv.org/abs/2510.20270)).
6. **Gate-runner** en un contenedor nuevo con el SHA final y sin egress. Escribe evidencia **append-only** con el rol `gate_writer` (GRANT exclusivo, más triggers que rechazan UPDATE y DELETE).
7. Si falla: hasta **N=3 reintentos**, cada uno con sesión nueva y un resumen del fallo derivado de la evidencia, no del relato del modelo. Si se agotan, la tarea se bloquea y se escala como propuesta o tarjeta para volver a exploración.
8. **Espera humana durable** (`recv` con topic y timeout de DBOS) para «Aceptar resultado», detrás de la API autenticada.

**Cancelación persistente:** POST → marca en BD → el watcher aborta el `AbortSignal` del paso → el broker hace `docker kill` → el paso falla → el workflow queda `CANCELLED`. El efecto llega a la UI por SSE y sobrevive a reinicios.

**Perfiles de hard gates** (escalonados para que la inestabilidad de los tests no bloquee antes de que el orquestador sea fiable):

- **MVP (bloqueantes):** diff dentro del alcance; tests de AC intactos por hash; rojo antes y verde después; `test_command` con código 0; cada AC-ID en verde en el JUnit; suite completa sobre el SHA final; `tsgo --noEmit`.
- **v2.1:** oxlint con lint de tipos (incluidas `no-floating-promises`, `no-misused-promises` y `await-thenable`; prohibido `*Sync` en la API y el orquestador), Knip, OSV-Scanner offline (bloquean las vulnerabilidades altas y críticas), `pnpm licenses` y `pnpm sbom` para licencias sin red (el escaneo de licencias de OSV necesita red), Betterleaks, Opengrep con reglas propias, squawk con migraciones desde cero, axe.
- **v2.2:** StrykerJS incremental (primero informativo y luego bloqueante con umbral calibrado), cobertura de líneas cambiadas, presupuestos de bundle.
- **Nunca como gate:** jueces LLM, `converge`, revisores LLM. Solo producen avisos o propuestas.

**Opción ligera frente a robusta**

- **Ligera (recomendada para el MVP local de un usuario): DBOS TS.** Es una librería MIT, no añade servidor y comparte backup con el dominio. Carencias: no tiene sandbox de determinismo (se compensa con el workflow genérico y el gate de determinismo), la cancelación de pasos hay que construirla y su UI Conductor es propietaria (no hace falta: la observabilidad es propia).
- **Robusta: Temporal** (servidor MIT v1.32.0 del 11-09-2026, Worker Versioning GA). Tiene sandbox determinista en TS, cancelación por heartbeat y UI incluida. Coste: un servidor más **sin topología ligera soportada para producción** (`start-dev` «not intended for production», compose solo para desarrollo, producción en Kubernetes con Helm: [cli/server](https://docs.temporal.io/cli/server)), y el SDK TS solo soporta Node 20, 22 y 24 ([sdk-typescript](https://github.com/temporalio/sdk-typescript)), lo que obligaría a quedarse en Node 24. Es la opción al pasar a equipos o Kubernetes.
- **Criterios del spike DBOS frente a Temporal** (1-2 días, misma máquina de estados):
  - matar el worker a mitad de un paso de agente, sin evidencia duplicada;
  - una cancelación mata el contenedor en menos de X s;
  - un gate rojo con un agente que dice «done»;
  - una aprobación que sobrevive a reiniciar el host;
  - atomicidad entre transición y checkpoint;
  - backup y restore completos;
  - cambio del workflow con ejecuciones en curso;
  - consumo de RAM en Docker Desktop.

---

## 5. Agentes y proveedores

**Puerto `Executor` estrecho**

- Entrada `TaskRun`: runId, rol, workspace, context pack y su hash, `outputSchema`, presupuestos, política (rutas escribibles y congeladas, red) y `mcpServers`.
- Salida: eventos normalizados (started, message, tool_call, file_change, command, usage, permission_request, error, finished) y `RunOutcome` (estado técnico, claim validada, usage, `sessionRef`).
- Capacidades declaradas por adaptador (structuredOutput, hooks, usage, resume), para que el orquestador compense lo que falte.

**Topología de confianza, el invariante más importante:** el adaptador (el SDK) vive en un **worker T0** que tiene acceso a la cola DBOS. **Solo el binario del agente corre en T1**, lanzado por el broker. Claude usa `spawnClaudeCodeProcess` («run Claude Code in VMs, containers, or remote environments»). Codex usa `codex exec --json --output-schema` dentro del contenedor, con stdio conectado por el broker. **Ningún proceso con credenciales de BD o de modelo se ejecuta en T1.**

**Adaptadores del MVP** (versión fijada y tests de contrato con fixtures JSONL grabados):

- **Claude Agent SDK TS 0.3.281** con API key, `settingSources: ['project']` sobre un `.claude/` que genera DEMIURGO, `CLAUDE_CONFIG_DIR` efímero, memoria automática desactivada y MCP estricto. Con `[]` no se cargarían CLAUDE.md, AGENTS.md ni las skills del proyecto. Además, sin `--bare`, `-p` ejecuta los hooks y el `.mcp.json` del repositorio sin pedir confianza.
- **Codex** (SDK TS 0.156.1 o `codex exec`) con `CODEX_API_KEY` y config aislada. **El app-server de Codex es experimental y no está soportado en producción** ([app-server](https://learn.chatgpt.com/docs/app-server)), así que no se usa.
- **Después del MVP:** un tercer ejecutor abierto y multimodelo, cualificado con evals: OpenCode SDK (MIT, salida estructurada y eventos), ACP cuando se estabilice su v2, o GitHub Copilot SDK (GA, MIT, BYOK).

**Permisos:** una herramienta MCP `authorize` en T0, usada por `--permission-prompt-tool` o reenviando `canUseTool` a ese servicio, aplica la política de rutas y comandos. **Los hooks solo sirven para fallar pronto y dejar rastro, no son la frontera de seguridad.** El propio Anthropic dice que el parser de permisos «is a permission gate, not a sandbox»: un agente puede reescribir tests usando Bash.

**Credenciales:** API key por defecto. Anthropic no permite que productos de terceros ofrezcan el login de claude.ai ([agent-sdk/overview](https://code.claude.com/docs/en/agent-sdk/overview)), y OpenAI recomienda API key para uso programático y en CI. La v1 usa hoy la autenticación de ChatGPT de Codex, así que **pasar a API keys tiene coste real y hay que registrarlo como ADR**. La suscripción queda solo como modo personal explícito, con el binario oficial sin modificar y, a ser posible, enmascarada por sbx.

**DEMIURGO como servidor MCP** (@modelcontextprotocol/server 2.1.x, proceso propio con un rol de BD restringido):

- Transporte Streamable HTTP en la red interna, **revisiones 2025-11-25 y 2026-07-28**. Claude Code solo negocia la nueva con servidores HTTP y esa revisión elimina la reanudación de SSE: la reanudación es responsabilidad del orquestador.
- Token de capacidad por ejecución, ligado a los handles, y validación de Origin/Host.
- Herramientas de lectura: `get_task_brief`, `get_record`, `search_knowledge`, `list_acceptance_criteria`, `get_failure_evidence`.
- Herramientas de entrega: `submit_result`, `propose`, `request_clarification`, que solo crean claims o propuestas pendientes.
- **Ninguna herramienta aprueba, marca como passed ni cierra nada.**

**Enrutado de modelos:** una tabla versionada `(rol, intento, tipo de fallo) → (ejecutor, modelo, esfuerzo, fallback)`, registrada en cada ejecución. Los cambios entran como **propuesta** y se cualifican con la suite privada de evals. Sin auto-routers (el de OpenRouter elige por cuota de gasto de la comunidad) y sin gateways en el camino de los gates (LiteLLM sufrió un compromiso de cadena de suministro el 24-03-2026).

**Ingeniería de contexto**

- Un **constructor puro por rol**, con presupuesto por sección y huella calculada sobre los hechos declarados (corrige TC-CTX-02/04).
- En el worktree: un AGENTS.md **corto y escrito a mano** (los ficheros de contexto largos o autogenerados no mejoran el éxito y suben el coste más de un 20 %, según [arXiv 2602.11988](https://arxiv.org/abs/2602.11988)), un CLAUDE.md mínimo que lo importe y skills por rol en formato Agent Skills.
- Búsqueda: la agéntica del propio arnés para el código. Para el conocimiento, el motor de contexto: candidatos deterministas (grafo, FTS `spanish` y ficheros tocados) ordenados por Jev con un Score de relevancia dentro del presupuesto. pgvector solo si una eval lo justifica.
- **Jev no sustituye a los agentes.** No redacta ni razona en varios saltos: decide entre opciones cerradas sobre un `state` pequeño. Lo que haya que escribir lo escribe un LLM. Las fechas, las versiones y la precedencia se resuelven en código.
- Cada reintento abre una **sesión nueva**. Subagentes solo para trabajo independiente en worktrees separados.

---

## 6. Sandbox y workspaces

**Dominios de confianza**

- **T0:** orquestador, BD, credenciales, broker y pasarela de modelo.
- **T1:** todo lo que escribió el agente, incluidos el propio agente y los gates.

T0 nunca debe compartir kernel con T1. En el MVP esto **no se cumple del todo**: con Docker Desktop, todos los contenedores comparten la VM. Queda documentado y se mitiga como se explica abajo.

**MVP en Windows 11**

- **Docker Desktop con backend Hyper-V**, porque en WSL2 todas las distros comparten kernel ([windows-install](https://docs.docker.com/desktop/setup/install/windows-install/)).
- **Broker:** el único componente con el socket de Docker. Acepta solo un `JobSpec` cerrado: imágenes por digest, flags fijos y ningún montaje arbitrario.
- **Perfil A, agente.** Contenedor efímero no root, `cap-drop ALL`, `no-new-privileges`, seccomp, rootfs de solo lectura, tmpfs, límites de CPU, memoria y PIDs, y timeout impuesto por el orquestador. El workspace es un clon en un volumen con nombre y los tests congelados van en solo lectura. Red `--network none` más un socket, o red `internal`, hacia un **proxy de egress con allowlist** y una **pasarela de modelo que inyecta la API key y cuenta tokens** (patrón de [secure-deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment)). Dentro no hay `/data` ni credenciales.
- **Perfil B, gates.** Contenedor nuevo con checkout del SHA final, red interna por job con servicios (Postgres efímero, navegador) y **sin egress**. Las dependencias salen solo de una caché local (imagen de gates con el store de pnpm precargado y `--offline`, o Verdaccio), con `--ignore-scripts` siempre que se pueda.
- **El sandbox interno del agente no cuenta como capa.** Dentro de Docker, bwrap «may not work» según OpenAI, y Claude necesita `enableWeakerNestedSandbox`, que «considerably weakens security».
- Workspaces en **volúmenes con nombre, nunca en bind mounts de NTFS** (lentos y con problemas de CRLF).
- Mientras agentes externos construyan la v2 en esta máquina, deben correr en un devcontainer con firewall o en `sbx`, **sin acceso a `%LOCALAPPDATA%\Demiurgo\stable`**.

**Evolución**

1. **Spike con Docker Sandboxes (`sbx`)**: microVM sobre WHP en Windows 11, gratis incluso para uso comercial, enmascara con valores centinela tanto las API keys como el OAuth de Codex ([credentials](https://docs.docker.com/ai/sandboxes/security/credentials/)). Usar la política «Locked Down», no la «Balanced» por defecto. Es propietario y 0.x con cambios incompatibles casi semanales, así que va detrás del puerto `SandboxProvider`.
2. Evaluar **OpenSandbox** (Apache-2.0: sidecar de egress y Credential Vault) antes de escribir el broker desde cero.
3. Opción de microVM abierta: microsandbox, cuando salga de beta.
4. Para equipos: Kubernetes agent-sandbox v1.x con gVisor o Kata. Para nube: E2B, Vercel Sandbox o Modal.

---

## 7. Stack de referencia de las apps generadas y quality gates

**Plantilla «TS-RR v1»** (se congela solo después de compararla con Next.js 16.3 en las evals propias y antes de la primera app real):

- Node 26 LTS; pnpm 11 con sus defensas; **app de un solo paquete** por defecto (sin Turborepo).
- React 19 + **React Router 8.x en modo framework** (SSR, **sin RSC** y sin usar el middleware para autorizar), con autorización comprobada en cada loader y action. Lint que prohíbe `react-router-dom` y `@remix-run/*`. Documentación de RR fijada en el repositorio, porque RR no publica llms.txt.
- PostgreSQL con Kysely (por coherencia con la v2) o Drizzle 0.45.x fijado; migraciones SQL versionadas.
- Better Auth 1.7.x como módulo opcional con el mínimo de plugins; Zod 4 en todas las fronteras.
- tsgo en modo strict + `noUncheckedIndexedAccess` (`exactOptionalPropertyTypes` solo si la eval no muestra fricción), oxlint con tsgolint, Biome u Oxfmt (uno de los dos), Knip, Vitest, Playwright 1.63 con Chrome for Testing, @axe-core/playwright.

**Ejecución de los gates**

- **Fase fetch:** red solo hacia el registro; lockfile congelado; imagen y base de datos de OSV fijadas por digest.
- **Fase verify:** contenedor Linux fijado por digest, sin red externa ni secretos, no root.
- Salidas en JUnit, SARIF o JSON ligadas al SHA como evidencia `system_gate`.
- **Perfiles escalonados**, los mismos que en la sección 4.
- **Herramientas de gate fijadas por digest o SHA**: Trivy fue comprometido en marzo de 2026 y gitleaks solo recibe parches de seguridad.
- Evitar el conjunto de reglas de Semgrep si DEMIURGO acaba siendo SaaS (su licencia lo prohíbe); usar Opengrep con reglas propias.

**Por qué React Router y no Next.js por defecto:** majors anuales «as boring as possible» ([react-router-v8](https://remix.run/blog/react-router-v8)) y menos superficie (sin RSC). Hay que ser justos con Next.js: tiene mejor tooling para agentes (documentación empaquetada por versión, servidor MCP, evals públicas). Además, RR en modo framework también tuvo advisories altos en 2026, así que OSV como gate bloqueante es obligatorio. **La decisión final se toma con datos propios:** los mismos 10-20 FDR construidos en ambas plantillas, midiendo gates superados, reintentos y tokens.

**Contrato de gates neutral respecto al lenguaje:** los comandos canónicos `pnpm gate:types|lint|test|e2e|a11y|security|migrations|all` y sus formatos se definen como un perfil versionado, para poder añadir otras plantillas más adelante sin tocar el orquestador.

---

## 8. Observabilidad, evals y aprendizaje

**El registro propio es la fuente de verdad** (en Postgres):

- Estructura: ejecución → intento → context manifest (blob direccionado por hash + `method_version` + `prompt_hash`) → resultados de gates (artefacto con sha256) → uso → decisión humana.
- El uso incluye tokens, tiempo, reintentos, `failure_kind` cerrado (`infra`, `timeout`, `schema_invalid`, `tests_failed`, `ac_failed`, `quality_failed`, `human_rejected`, `cancelled`), modelo pedido y observado, modo de autenticación, y coste declarado frente a coste estimado con una tabla de precios versionada.
- El uso se toma del **flujo estructurado del agente o de la pasarela de modelo**, no de OTel. Claude Code pierde telemetría en silencio si falla la exportación.
- Los eventos crudos se guardan como **un blob comprimido por intento**, nunca una fila por evento (la contención de la v1 venía de eso).

**OTel como apoyo de depuración, no como evidencia**

- SDK OTel JS (trazas y métricas estables), con **un único adaptador** de atributos `demiurgo.*` y un subconjunto `gen_ai.*` fijado a versión.
- **Sin métricas gen_ai**: la semconv GenAI está en «Development», sin releases, y tiene cambios que rompen compatibilidad pendientes ([semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai)).
- Propagar `TRACEPARENT` a Claude (lo soporta el SDK o `-p`) y a `codex exec` (lo soporta en el código fuente aunque no esté documentado; comprobarlo con un test en cada versión).
- **En Codex, fijar `exporter`, `trace_exporter` y `metrics_exporter`**: este último vale `statsig` por defecto y envía métricas a OpenAI ([config-reference](https://developers.openai.com/codex/config-reference)).
- Perfil opcional de compose con Collector y Jaeger v2. MLflow 3.x como backend LLM ligero más adelante; Langfuse v4 (pide 16 GiB) solo para equipos o nube. Phoenix fuera por su licencia ELv2.

**Evals**

- **Pilar 2:** conjunto privado de 20-50 tareas reales del dogfooding, con tests ocultos, **ejecutadas por el propio orquestador** (mismos gates, sandbox y autenticación) y medidas con pass^k, k=2-3. SWE-bench Verified está contaminado: OpenAI dejó de publicarlo en febrero de 2026. Harbor sirve como comparación externa con API keys. **inspect_swe desvía las llamadas del modelo** y no evalúa el arnés real.
- **Pilar 1:** promptfoo en CI para la regresión de métodos y prompts (MIT, pero ahora de OpenAI: vigilar su neutralidad). Los casos salen de propuestas reales aceptadas y rechazadas.
- **Clasificador (Jev):** conjunto etiquetado de pares (cambio, nodo) con su veredicto, que sale de las correcciones de la persona. Se mide la exactitud y F1 por veredicto, la matriz de confusión (el error caro es invalidar cuando tocaba mantener), la calibración propia y la curva de cobertura frente a precisión según el umbral. También se prueban las ablaciones español frente a inglés, el tamaño del `state` con distractores y las fuentes con instrucciones inyectadas. Se compara con el modelo de referencia antes de adoptarlo.
- **Jueces LLM consultivos**, calibrados (TPR y TNR) con un conjunto etiquetado a propósito que **incluya negativos**. Las aceptaciones humanas solo cubren lo que ya pasó los gates.

**Aprendizaje por fases**

1. MVP: estadística descriptiva.
2. Propuestas de cambio sobre la tabla de enrutado, con intervalos de Wilson sobre pass^k.
3. GEPA offline (eval-lab Python aparte, vía MLflow o DSPy) con validación separada.

Todo cambio entra como **propuesta que acepta una persona**. La v2 registra desde S1 el motivo de rechazo con un clic: es una etiqueta humana gratuita.

---

## 9. Lecciones del estado del arte del proceso

**Lo que hace el mercado (septiembre de 2026)**

- El **spec-driven development** es ya la corriente principal: GitHub Spec Kit 1.0 (21-08-2026, v1.0.11), OpenSpec (unas 70k estrellas), Kiro GA (Kiro Web GA el 01-09-2026), BMAD v6.12, AWS AI-DLC Workflows.
- El formato ha convergido en **requisito con ID + modal normativo + escenarios concretos** (Given/When/Then; EARS solo en Kiro).
- La verificación es el punto débil:
  - Spec Kit `converge` es un prompt.
  - En Kiro la PBT es opcional y los hooks `PostTaskExecution` y `AgentStop` no bloquean.
  - Copilot «attempts to resolve» sus hallazgos de seguridad.
  - En Lovable, bloquear la publicación por hallazgos críticos es opcional (CVE-2025-48757: 10,3 % de proyectos con RLS inseguro).
  - Replit borró una base de producción durante un code freeze.
- **Hay que corregir la tesis del hueco de mercado.** No es que «nadie tenga gates»:
  - Spec Kit tiene desde la 0.7 un motor YAML determinista con pasos `shell` y `gate` humano, y reanudación ([workflows](https://github.github.com/spec-kit/reference/workflows.html)).
  - AWS AI-DLC anuncia un motor determinista con gates humanos y una auditoría de 105 eventos ([aidlc-workflows](https://github.com/awslabs/aidlc-workflows)).
  - Los Dynamic Workflows de Claude Code ejecutan un guion con replay determinista.

**El hueco real de DEMIURGO es más estrecho, y se puede defender:**

1. La **decisión del gate la toma código** sobre artefactos del sistema, no un orquestador LLM.
2. **Tests de aceptación congelados** y escritos por un rol distinto.
3. **Trazabilidad completa y visible**: idea → decisión → AC → test → SHA → evidencia → aceptación.
4. **Conocimiento de producto versionado con aceptación humana de cada propuesta.**
5. **UX legible para no programadores**: escenarios, capturas y evidencia en divulgación progresiva.

Conviene hacer un benchmark explícito frente a AI-DLC, los workflows de Spec Kit, Kiro y Antigravity.

**Lecciones que se adoptan**

- Modelo de OpenSpec: especificación vigente + delta + archivo, sobre revisiones y supersesión.
- Acción `analizar_requisitos` al estilo de Kiro: pocas preguntas con impacto, que salen como propuestas.
- **Ceremonia adaptativa** (perfiles de feature, cambio pequeño y bugfix, como BMAD 6.12, Kiro Quick Spec y AI-DLC) para no caer en la sobrecarga que critica Böckeler.
- Puerta «Listo para construir».
- AC en español con Dado/Cuando/Entonces, ID y modo de verificación; ADR al estilo MADR.
- Proyección derivada al repositorio (AGENTS.md, skills, Markdown exportable a OpenSpec o Spec Kit) con exportadores versionados. No se promete compatibilidad nativa con formatos que cambian cada mes.
- Encuadre de 2026: **«harness engineering»**, con guías, sensores computacionales como gate y sensores inferenciales solo como aviso. Thoughtworks Radar Vol. 34 pone en Trial los feedback sensors, el sandboxing y el mutation testing ([harness-engineering](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html)).
- **Spec anchored, no spec-as-source:** Tessl confirma que regenerar código desde la especificación no es determinista.
- No se adopta como runtime ni Spec Kit, ni Kiro, ni BMAD, ni AI-DLC. Se usan como referencia y como destino de exportación.

**Dogfooding en tres fases**

- **Fase 0, diseño en el repositorio (D0).** La v1 no se usa. Las decisiones de este documento se registran como ADR con AC verificables en `design/`, en Markdown con formato fijo que la v2 importará en H1.
- **Fase 1, construir la v2 con Claude Code y Codex bajo un arnés provisional:** especificación exportada desde `design/` (y desde la v2 a partir de H1), hook `PreToolUse` que deniega editar tests congelados, hook `Stop` que ejecuta `pnpm gate:all`, CI como gate y commits por tarea. **Primer hito: el walking skeleton del Pilar 2** (máquina de estados, workflow DBOS, broker, gate-runner y evidencia). A partir de ahí, todo el trabajo sobre la v2 pasa por los propios gates de la v2.
- **Fase 2:** las apps generadas usan TS-RR v1, que comparte runtime, gates, validación, datos, autenticación y router con la v2.

---

## 10. Riesgos y puntos a vigilar

**Riesgos principales y su mitigación**

1. **SDKs de agentes 0.x con publicaciones casi diarias** (claude-agent-sdk 0.3.x, codex 0.156, MCP 2026-07-28 rompiendo compatibilidad). Mitigación: el puerto `Executor`, versiones fijadas, tests de contrato con fixtures grabados y actualizaciones con retardo mediante Renovate.
2. **Demasiadas versiones posteriores al corte de entrenamiento** (TS 7, Node 26, DBOS 5.0, Vite 8, Vitest 5, React Router 8, React 19.3): fuente de alucinaciones de API para los agentes. Mitigación: política de majors aburridos, documentación fijada a la versión y lint de imports prohibidos.
3. **TS 7 sin API programática:** typescript-eslint no lo soporta y hay que convivir con `@typescript/typescript6`. Afecta también al checker de Stryker.
4. **DBOS TS:** la 5.0 tiene 8 días y trae cambios de esquema; no tiene sandbox de determinismo; hay que construir la cancelación. Mitigación: spike, workflow genérico, gate de determinismo y tests de recuperación en CI.
5. **Aislamiento imperfecto en Windows:** Docker Desktop funciona, con backend WSL2 o Hyper-V. Pero runners, API y Postgres comparten el kernel de la VM de Docker Desktop, así que un escape de contenedor alcanza la BD aunque no esté montada. Con WSL2, esa VM es además la misma en la que corren las distros WSL de la persona. Mitigación en el MVP: contenedores endurecidos (usuario no root, sin privilegios, `cap-drop ALL`, seccomp, raíz de solo lectura, sin socket de Docker ni montajes del host y salida a red por proxy) y ningún secreto en las distros WSL. La separación real (microVM con sbx o una VM Hyper-V dedicada para el runner) es 0.x o manual y llega después del esqueleto.
6. **Cadena de suministro npm** (Shai-Hulud en 2025, @tanstack/* el 11-05-2026) y PyPI (LiteLLM en 03-2026). Mitigación: pnpm 11, lockfile, gates offline, broker con dependencias mínimas y herramientas fijadas por digest.
7. **Términos y costes:** el Claude Agent SDK se rige por los Commercial Terms (no es open source) y prohíbe ofrecer el login de claude.ai; pasar a API keys tiene coste real. La política de suscripciones de Anthropic cambió varias veces en 2026.
8. **Concentración de proveedores:** Vercel (AI SDK, Better Auth, Next.js), OpenAI (promptfoo, Astral), ClickHouse (Langfuse). Mitigación: licencias MIT o Apache, adaptadores y OTLP.
9. **Operar Postgres** para un solo usuario: `pg_dump` diario, `restore` probado en CI, runbook del salto PG18→19 y consumo de RAM en WSL2.
10. **Sobreingeniería:** broker, gate-runner, proxy, MCP, registro y máquina de estados son muchas piezas propias. Mitigación: walking skeleton, perfiles escalonados, y dejar collector, Jaeger, sbx y el tercer ejecutor para después del esqueleto.
11. **Oráculo débil:** un autor de tests distinto sigue siendo una IA. Mitigación: rojo antes y verde después, revisión humana de los escenarios y mutación en v2.2.
12. **El mercado se mueve:** Kiro, Cursor Projects, Lovable, AI-DLC y Spec Kit ya cubren partes del hueco. La diferenciación tiene que estar en gobierno y trazabilidad, no en generar código.

**Afirmaciones que no se pudieron verificar o que quedaron abiertas**

- No se confirmó que Node 26 esté certificado por Temporal TS (solo figuran 20, 22 y 24), ni el soporte de DBOS o Vercel Workflow en Bun.
- No se ha verificado si el Codex SDK TS permite un spawn personalizado equivalente a `spawnClaudeCodeProcess`. Por eso el plan usa `codex exec` en el contenedor vía broker.
- No se conocen las condiciones de uso programático del login de ChatGPT con Codex; si Codex CLI ya negocia MCP 2026-07-28; ni la madurez y automatización no interactiva de `sbx` en Windows, ni si convive con Docker Desktop.
- El soporte de OpenSandbox en Windows y Docker Desktop, y los precios de Docker Cloud Sandboxes.
- La madurez de mutmut, testcontainers-python y docker SDK de Python (irrelevante si se elige TS).
- Otras sin confirmar: el alcance exacto del giro de Tessl, la fecha de Factory Missions, la actividad de Jules después de 03-2026, las funciones de calidad de Bolt, Base44 y Bubble, la «colaboración» Vercel–TanStack y la «prohibición del 4 de abril» de la política de Anthropic.
- La fecha de GA de PG19 (hoy en beta 3) y si Phoenix OSS normaliza gen_ai→OpenInference.
- Parte de la investigación se hizo solo con WebFetch porque se agotó el cupo de búsqueda web, y openai.com devolvió 403 (se usó Wayback Machine).
- **Incidencia de la investigación:** en una consulta a la API de crates.io se incluyó por error el email del usuario en la cabecera User-Agent. Las consultas siguientes usaron un User-Agent genérico.

**Decisiones que hay que cerrar como ADR en `design/` (D0), cada una con AC verificables**

1. Lenguaje del núcleo, con el spike del slice vertical.
2. Motor durable: DBOS frente a Temporal.
3. Kysely frente a Drizzle.
4. Frontera de aislamiento y la separación T0/T1.
5. Credenciales: API key o suscripción.
6. Contratos `Executor`, `SandboxProvider` y el perfil de gates.
7. Primitivas de shadcn: `--base aria` o Base UI.
8. Plantilla de apps: TS-RR frente a Next.js 16.3.
9. Formato canónico de la prosa: Markdown restringido.

---

## 11. Fuentes principales

- Lenguaje y runtime: https://code.claude.com/docs/en/agent-sdk/overview · https://code.claude.com/docs/en/agent-sdk/hooks · https://code.claude.com/docs/en/agent-sdk/typescript · https://code.claude.com/docs/en/cli-reference · https://github.com/openai/codex/blob/main/sdk/typescript/README.md · https://learn.chatgpt.com/docs/codex-sdk · https://learn.chatgpt.com/docs/app-server · https://modelcontextprotocol.io/docs/sdk · https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ · https://raw.githubusercontent.com/nodejs/Release/main/schedule.json · https://nodejs.org/api/typescript.html · https://oxc.rs/blog/2026-07-22-type-aware-linting-stable · https://pnpm.io/blog/releases/11.0 · https://pnpm.io/blog/releases/12.0
- Evidencia sobre lenguajes: https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/ · https://arxiv.org/abs/2504.09246 · https://www.swebench.com/multilingual.html · https://arxiv.org/abs/2509.16941 · https://arxiv.org/abs/2504.02605 · https://arxiv.org/html/2603.04601v2
- Datos: https://www.postgresql.org/about/news/postgresql-18-released-3142/ · https://github.com/pgvector/pgvector/blob/master/CHANGELOG.md · https://registry.npmjs.org/-/package/kysely/dist-tags · https://orm.drizzle.team/roadmap · https://www.prisma.io/docs/orm/release-status
- Orquestación: https://docs.dbos.dev/typescript/tutorials/transaction-tutorial · https://docs.dbos.dev/typescript/tutorials/workflow-management · https://docs.dbos.dev/architecture · https://docs.dbos.dev/golang/tutorials/transaction-tutorial · https://docs.dbos.dev/python/tutorials/workflow-management · https://registry.npmjs.org/@dbos-inc/dbos-sdk/latest · https://github.com/temporalio/sdk-typescript · https://docs.temporal.io/cli/server · https://github.com/temporalio/temporal/releases/tag/v1.32.0 · https://raw.githubusercontent.com/restatedev/restate/main/LICENSE
- Agentes y MCP: https://modelcontextprotocol.io/specification/2026-07-28/changelog · https://github.com/modelcontextprotocol/typescript-sdk · https://agentclientprotocol.com/get-started/agents · https://vercel.com/changelog/ai-sdk-7 · https://opencode.ai/docs/sdk/ · https://github.com/github/copilot-sdk · https://docs.litellm.ai/blog/security-update-march-2026 · https://arxiv.org/abs/2602.11988
- Sandbox: https://code.claude.com/docs/en/agent-sdk/secure-deployment · https://code.claude.com/docs/en/sandboxing · https://learn.chatgpt.com/docs/agent-approvals-security · https://docs.docker.com/ai/sandboxes/ · https://docs.docker.com/ai/sandboxes/security/credentials/ · https://docs.docker.com/desktop/setup/install/windows-install/ · https://docs.docker.com/subscription/desktop-license/ · https://github.com/alibaba/OpenSandbox
- Frontend y apps generadas: https://react.dev/blog/2026/09/09/react-19-3 · https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components · https://vite.dev/blog/announcing-vite8 · https://remix.run/blog/react-router-v8 · https://ui.shadcn.com/docs/changelog/2026-07-react-aria · https://playwright.dev/docs/release-notes · https://github.com/better-auth/better-auth/security/advisories · https://github.com/TanStack/router/security/advisories/GHSA-g7cv-rxg3-hmpx · https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23 · https://google.github.io/osv-scanner/usage/license-scanning/ · https://pnpm.io/cli/sbom · https://nextjs.org/docs/app/guides/ai-agents
- Observabilidad y evals: https://github.com/open-telemetry/semantic-conventions-genai · https://code.claude.com/docs/en/agent-sdk/observability · https://developers.openai.com/codex/config-reference · https://langfuse.com/self-hosting/deployment/docker-compose · https://mlflow.org/docs/latest/genai/tracing/opentelemetry/genai-semconv/ · https://www.promptfoo.dev/blog/promptfoo-joining-openai/ · https://meridianlabs-ai.github.io/inspect_swe/ · https://github.com/laude-institute/harbor · https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents · https://github.com/gepa-ai/gepa
- Proceso y competidores: https://github.github.com/spec-kit/reference/workflows.html · https://kiro.dev/docs/specs/correctness/ · https://kiro.dev/docs/hooks/ · https://github.com/awslabs/aidlc-workflows · https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html · https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html · https://www.thoughtworks.com/radar/techniques/feedback-sensors-for-coding-agents · https://arxiv.org/abs/2510.20270 · https://metr.org/blog/2025-06-05-recent-reward-hacking/ · https://arxiv.org/abs/2511.04427 · https://docs.lovable.dev/features/security · https://arxiv.org/abs/2509.06216