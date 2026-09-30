# AGENTS.md

DEMIURGO guía el desarrollo con IA de principio a fin con dos pilares: diseñar (de la intención a «Listo para construir») y construir de forma gobernada. El plan está en `docs/plan-reimplementacion-2026-09-24.md` y el stack en `docs/investigacion-stack-2026-09-24.md`.

## Modo V2.1 (parches): manda en la rama `v2.3` sobre todo lo demás

La V2.1 es desechable. La persona usa DEMIURGO en la instancia 8100 para diseñar la versión
productiva, y aquí se parchea en caliente lo que echa en falta. La regla es que funcione, no que
sea perfecto: rápido antes que bonito. Ningún parche llega tal cual a la versión productiva. Estas
reglas anulan el resto de este fichero y las de cualquier skill.

- **Como lo haría un equipo profesional de primer nivel.** Todo lo que DEMIURGO propone y guía
  (toma de requisitos, historias y criterios, diseño, arquitectura, tareas, construcción, pruebas,
  revisión y entrega) replica cómo trabaja en la vida real un equipo de desarrollo top tier. Al
  proponer un cambio o una opción, di qué práctica real sigue (p. ej. criterios de aceptación
  Dado/Cuando/Entonces, flujo principal de un caso de uso, walking skeleton, definición de hecho) y
  no inventes procesos que ningún equipo serio usaría. Las prácticas ya adoptadas están en
  `VISION.md`, apartado «Como lo haría un equipo profesional de primer nivel»: añade ahí cada
  práctica nueva que se acuerde, porque guía qué diseñar en la v3.
- **Sin proceso.**
  - No se usan brainstorming, specs, planes, TDD, revisión final ni ninguna skill de superpowers.
  - No se escriben documentos en `docs/` ni en `design/`, ni artifacts.
  - No se mantiene la trazabilidad AC → prueba.
- **Sin preguntas.** Confirma en una línea lo que has entendido y hazlo. Pregunta solo si hay dos
  lecturas que cambien el resultado.
- **Comprobación mínima.**
  - Pasa `pnpm gate:types`.
  - Míralo funcionar en http://127.0.0.1:8100: con Playwright si compensa; si no, pide a la
    persona que recargue.
  - No ejecutes `gate:all`. Si una prueba se rompe, déjala rota y di cuál es.
- **Un commit por parche.**
  - Título con el prefijo `patch:`, por ejemplo `patch: Enter envía el mensaje del hilo`.
  - El cuerpo lleva estas líneas, que lee el companion con la skill `puesta-al-dia`:
    - `Pedido: «<las palabras de la persona, tal cual>»`;
    - `Dónde: <pantalla o acción>`;
    - `Diseño: <códigos en DEMIURGO-dogfood>` (`FDR-…`, `TSK-…`), cuando el parche construye algo
      diseñado allí. El diseño va antes que el código, y la evidencia de cada criterio se registra
      en dogfood con el commit.

    Van con `-m` separados.
  - Usa pathspec.
  - Después, `git -c credential.helper= -c credential.helper='!gh auth git-credential' push -q origin v2.3` sin preguntar.
  - Nunca hagas push a `v2`, `v2.2` ni a `main`, ni merge.
  - `git log --oneline v2.2..v2.3` es el registro de parches.
- **Instancia 8100.**
  - Corre en `compose.yaml`:
    - el API en el contenedor `api` con `node --watch packages/api/src/main.ts`. En este Mac el
      `--watch` no ve los cambios del bind-mount: tras un parche de servidor, `docker compose restart
      api`, siempre sin nada en curso;
    - la web en el contenedor `web-build` con `pnpm --filter @demiurgo/web exec vite build --watch`,
      que sí se recarga sola.
  - Si no corre, relánzala con `pnpm stack:up` (`docker compose up -d --build --wait`); las variables
    salen de `.env`. Un cambio en `.env` se aplica con `docker compose up -d api`.
- **Los datos de la instancia no son desechables**: contienen el diseño real.
  - Antes de un parche con migración, un cambio en `design/data/` o `pnpm gen`, guarda una
    instantánea con `pnpm snap save antes-<parche>`, o desde el panel de dev tools de la web.
  - Una migración se añade siempre nueva. Nunca edites una ya aplicada: tiene checksum.
- **Cuota.** No guardes código del servidor mientras corre una ejecución con Claude o Codex: el
  reinicio la repite.
- **Siguen en pie estas reglas:**
  - no tocar `demiurgo-stable`, el puerto 8000 ni `%LOCALAPPDATA%\Demiurgo\stable`;
  - nunca aceptar ni ratificar nada en nombre de la persona;
  - ninguna llamada real a Claude o Codex salvo que se pida;
  - no repetir secretos;
  - código en inglés; conversación y commits en español.
- **La jerarquía del diseño** (la siguen los agentes: `packages/core/skills/demiurgo-glossary/SKILL.md`):
  1. definición del producto (DEF);
  2. épica (EPC), solo cuando una capacidad de la primera versión no cabe en una funcionalidad: su
     objetivo y sus funcionalidades en orden; crece por versiones;
  3. funcionalidad (FDR), basada en su épica o en la definición;
  4. decisión (ADR), basada en una funcionalidad o en una restricción u objetivo de la definición;
  5. construcción y evidencia.

  Una propuesta no es un nivel: es cómo llega cualquier cosa. Las funcionalidades van antes que las
  decisiones; un parche no debe hacer que se decida sin algo en lo que basarse.
- **Subagentes para implementar.**
  - La implementación con alcance acotado (un parche de web, un comando, una consulta, una pantalla, una migración con su dominio) se delega en subagentes Sonnet 5.5 (`model: sonnet`), que son rápidos y buenos implementando con un alcance limitado. Varios en paralelo cuando las piezas son independientes, cada uno con su lista de ficheros para no pisarse.
  - La sesión principal diseña, reparte, revisa el diff, pasa `pnpm gate:types`, lo comprueba en 8100 y hace el commit y el push. El subagente no hace commit ni push, no reinicia el API ni toca la base.
  - El encargo al subagente lleva: el objetivo en una frase, los ficheros y funciones de partida, los criterios (los de dogfood si los hay), lo que no debe tocar y la orden de pasar `pnpm gate:types` y resumir el diff.
  - Solo se hace en la sesión principal lo que es más rápido que explicarlo (un cambio de pocas líneas) o lo que exige decidir diseño.
- **El companion** (`claude --agent demiurgo-companion`) corre en otra terminal, en solo lectura.
  Sus bloques «Parche para Claude Code» se pegan aquí.

## Reglas de fondo

- **El modelo propone, el sistema dispone y la persona decide.** Ninguna salida de IA cambia un estado de autoridad. Nunca aceptes automáticamente una propuesta de IA ni conviertas una hipótesis en algo aprobado.
- **El actor lo fija el servidor** según la credencial o el canal: `human:<persona>` (cookie de sesión), `agent:<nombre>:<sesión>` (token de agente), `agent:run:<id>` (ejecuciones) y `system:<componente>@<versión>`. El cliente nunca declara su actor.
- **Todo cambio de estado sale de las tablas de datos** (`design/data/`): lo que no está en la matriz de capacidades da 403 y lo que no está en la tabla de transiciones da 409, en ambos casos sin efectos.
- **El diario (`events`) solo admite INSERT.** Cada mutación deja su evento en la misma transacción.
- **Idioma del producto.** Lo que DEMIURGO guarda como registro (decisiones, FDR, criterios, preguntas, observaciones, propósitos y conocimiento) va **siempre en inglés**. Solo la respuesta conversacional (`reply`) sigue el idioma de la persona. La persona lee los registros en su idioma con una traducción de lectura marcada, que nunca es autoridad, y la interfaz se muestra en su idioma (catálogos `words.i18n.ts`). Plan: `docs/superpowers/plans/2026-09-28-contenido-en-ingles.md`.
- **Idioma.** El código va **en inglés**: identificadores, comentarios, pruebas, API, textos de producto, mensajes de error y prompts de los agentes. La documentación (`docs/`, `AGENTS.md`), la prosa de los documentos de `design/`, los commits y la conversación van **en español**.

## Entorno

- La v1 está descartada. Solo se consulta como catálogo de lecciones con `git show v1-referencia:<ruta>`. No la arregles ni la reutilices.
- **Prohibido tocar** el proyecto compose `demiurgo-stable`, `%LOCALAPPDATA%\Demiurgo\stable` y el puerto 8000 (son de la v1).
- Postgres: el del compose único `compose.yaml` (proyecto `demiurgo`, `127.0.0.1:55433`, base `demiurgo_v2`). Las pruebas crean bases efímeras `dmg_t_*` en ese mismo servidor vía `DEMIURGO_TEST_DB_URL`; nunca apuntes una prueba a una base en uso.
- **Desde el 25-09-2026, D0 queda fuera y H1 no muda ficheros:** los documentos de `design/` son referencia histórica de lo construido en S0–S2 (no se aceptan, no se importan y no se exportan encima). DEMIURGO se diseña a mano, paso a paso, dentro de la propia aplicación. H1 no se cierra hasta que todos sus documentos se han creado uno a uno dentro de la aplicación y la FDR de S3 nace y se aprueba allí. `design/data/` (tablas como datos) sigue siendo fuente del código.

## Cómo trabajar (fuera de la rama `v2.3`)

- TDD: cada AC automático de `design/` tiene al menos una prueba que pasa y cuyo título empieza por su código (`AC-ESQ-001-01 …`). `pnpm gate:traceability` lo comprueba con los informes JUnit.
- Cierra cada cambio con `pnpm gate:all` en verde.
- Commits pequeños con la skill `commit`. No hagas push ni merge en `main`.

## Comandos (Mac mini, homelab; `pnpm` vía corepack)

La instancia vive en el Mac mini (`~/Development/DEMIURGO`, con `~/Demiurgo` como enlace), en el compose
único `compose.yaml` (docs/homelab-macmini-plan.md y docs/homelab-macmini-bitacora.md). Los secretos están en
`.env` (no se commitea; `.env.example` documenta los nombres).

```bash
pnpm install                      # monorepo pnpm 11 (versiones exactas, minimumReleaseAge de 3 días)
pnpm stack:up                     # docker compose up -d --build --wait: postgres 55433, api 8100, web-build, evidencia
pnpm stack:ps                     # estado y salud de los servicios; pnpm stack:logs sigue api, web-build e ingestor
pnpm gate:all                     # tipos, lint, formato, design/, deriva, pruebas, invariantes y trazabilidad
pnpm gate:test                    # unit + integration (bases efímeras dmg_t_* en el Postgres de 55433; DEMIURGO_TEST_DB_URL de .env)
pnpm gate:invariants              # 403/409 generadas desde las tablas, propiedades, arquitectura, CI
npx vitest run --project integration packages/core/test/bus.test.ts -t "AC-ESQ-001-01"   # una prueba
docker compose exec api pnpm gen  # regenera packages/domain/src/generated/tables.ts desde design/data/ (antes, instantánea)
node packages/design/src/cli.ts canonicalize   # reescribe design/ en formato canónico
pnpm cli <subcommand>             # CLI de operación (ver packages/api/src/cli.ts)
pnpm snap list|save|restore|drop|reset   # instantáneas de la base (DEMIURGO_DEV_TOOLS=1; docs/instantaneas-dev.md)
```

- Node 24 ejecuta TypeScript directamente (type stripping): no hay paso de build. Imports relativos con extensión `.ts`; nada de enum, namespaces, parameter properties ni decoradores (`erasableSyntaxOnly`).
- La trazabilidad AC → prueba se construye desde `reports/junit-*.xml`: ejecuta `gate:test` y `gate:invariants` antes de `gate:traceability`. Cada AC automático necesita una prueba que pase y cuyo título empiece por su código.
- Las pruebas que usan el motor durable arrancan DBOS sobre su base efímera; las demás usan el motor en línea (`packages/core/src/engine/inline.ts`), que procesa el conocimiento en el acto.
- **Motores de los agentes** (FDR-AGE-002):
  - se eligen en la web, en *Models & providers* (menú de la persona): Claude, Codex u OpenCode (modelos locales como Qwen), globalmente o por proyecto;
  - sin motor asignado, la ejecución no se crea (409 «Choose a model for …»);
  - el proveedor `simulated` solo existe con `DEMIURGO_DEV_TOOLS=1`;
  - Claude y Codex consumen cuota de la suscripción: solo cuando se pida, y nunca en las pruebas, que usan el simulado y fixtures;
  - las variables `DEMIURGO_AGENT*`, `DEMIURGO_CLASSIFIER*` y `DEMIURGO_REVIEWER*` ya no existen y son un error.

## Arquitectura

Monorepo con siete paquetes:

- `packages/domain`: TypeScript puro sin E/S. Actores, tablas generadas (`generated/tables.ts` desde `design/data/*.yaml`) con sus invariantes en código, errores, huellas, plantillas y readiness, puertos de agentes (`agents.ts`) y del clasificador (`classifier.ts`), el núcleo puro del conocimiento (`knowledge.ts`: candidatos, verificación, plan, huella) y las métricas de evaluación.
- `packages/design`: formato fijo de `design/` (parse/render canónico), validador, derivación de tablas y trazabilidad AC → prueba por JUnit.
- `packages/core`: el núcleo con E/S.
  - `bus/`: `executeCommand` aplica capacidad (403), validación Zod (422), carga (404), transición (409), guardas y efecto + evento en la misma transacción. Los comandos anidados (`ctx.execute`) llevan su actor y la misma correlación. Guardas por nombre en `bus/guards.ts`; manejadores en `commands/*`.
  - `db/`: Kysely sobre `pg`, migraciones SQL planas en `packages/core/migrations/` (migrador propio con checksum). Diario `events` solo INSERT; contenido de versiones y criterios inmutable; nada se borra.
  - `engine/`: DBOS Transact 4.27 en el mismo Postgres (esquema `dbos`), versión de aplicación fija. Flujo de una ejecución: preparar → invocar (agente) → aplicar (idempotente con `step_completions`). Respuesta durable a mensajes, conciliación al arrancar, arranques diferidos fuera de los pasos.
  - `agents/`:
    - el catálogo de agentes (`packages/core/agents/<id>/AGENT.md`) y skills (`packages/core/skills/<id>/SKILL.md`), cuya versión es la huella de su contenido;
    - el simulador determinista;
    - las piezas comunes de `claude -p`.
  - `providers/`: los adaptadores Claude (`stream-json`), Codex (`exec --json`) y OpenCode (endpoint OpenAI-compatible con la herramienta `StructuredOutput`), sin herramientas y con el entorno filtrado.
  - `assignments/`: catálogo descubierto, asignaciones, resolución del motor, sesiones con delta, registro de cada llamada con sus eventos, consumo y el clasificador por agentes.
  - `actions/`: constructores de context pack y aplicadores de `exploration_chat` y `design_proposal`.
  - `knowledge/`: «Actualizar conocimiento» (cola DBOS en serie), grafo en Postgres, evaluación de ideas, reconstrucción con huella, evaluación del clasificador. `classifier/`: simulado, por agentes (knowledge_classifier, con cascada a knowledge_reviewer) y Jev vacío.
  - `design/`: importación de `design/` como lote pendiente (H1) y exportación canónica.
  - `runner/`: broker de contenedores endurecidos con JobSpec cerrado y sonda.
- `packages/api`: Fastify. Sesión humana con cookie httpOnly + CSRF, tokens de agente (`Bearer dmg_agent_…`), ruta genérica `POST /api/projects/:projectId/commands/:command`, consultas por la matriz (`query.*`) y SSE del diario. `main.ts` arranca el servidor (puerto 8100 por defecto) y `cli.ts` las órdenes de operación.
- `packages/mcp`: servidor MCP por stdio, cliente fino de la API con el token del agente (leer, conversar, registrar fuentes y proponer).
- `packages/design-system`: el sistema de diseño de DEMIURGO (`@demiurgo/design-system`, publicado en Claude Design): tokens y clases `dm-*` en `demiurgo.css`, fuentes, 22 componentes React en `src/index.tsx` y las guías (`guides/`). Es la única fuente del aspecto; `.design-sync/` lo sincroniza con Claude Design.
- `packages/web`: la interfaz (Vite, React 19, TanStack, Radix). Usa el sistema de diseño entero: sus componentes, sus clases `dm-*` y sus tokens (Tailwind solo lee esos tokens), sin colores, radios, sombras ni tamaños de letra propios; `test/unit/design-system.test.ts` lo vigila. Las páginas ocupan todo el ancho de la pantalla: nada de `max-w-{3xl…7xl}` ni anchos fijos en páginas o secciones; una columna de lectura usa `READING_COLUMN` de `components/Page.tsx` y el texto largo `max-w-prose` (`test/unit/page-width.test.ts` lo vigila).

Flujo de autoridad: la IA solo produce propuestas (`proposal_batches`/`proposals`); una persona las acepta (`proposal.accept`, `batch.accept_package`) y eso crea la autoridad con su actor `human`. El conocimiento derivado se actualiza tras cada evento de autoridad y lo que afecta a la autoridad vuelve como propuesta de revisión.
