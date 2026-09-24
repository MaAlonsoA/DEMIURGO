# CLAUDE.md

Lee primero `AGENTS.md`: reglas de fondo de la v2 (aceptación solo humana, actor fijado por el servidor, tablas como datos, diario append-only), prohibiciones de entorno (`demiurgo-stable`, puerto 8000) e idioma. El código va en inglés: identificadores, comentarios, pruebas, API, textos de producto, errores y prompts. La documentación, la prosa de `design/`, los commits y la conversación van en español.

## Comandos (Windows; `pnpm` vía corepack)

```powershell
pnpm install                      # monorepo pnpm 11 (versiones exactas, minimumReleaseAge de 3 días)
pnpm db:up                        # Postgres 18 de desarrollo: proyecto compose demiurgo-v2-dev, 127.0.0.1:55432
pnpm gate:all                     # tipos, lint, formato, design/, deriva, pruebas, invariantes y trazabilidad
pnpm gate:test                    # unit + integration (bases efímeras dmg_t_*; necesita Docker)
pnpm gate:invariants              # 403/409 generadas desde las tablas, propiedades, arquitectura, CI
npx vitest run --project integration packages/core/test/bus.test.ts -t "AC-ESQ-001-01"   # una prueba
pnpm gen                          # regenera packages/domain/src/generated/tables.ts desde design/data/
node packages/design/src/cli.ts canonicalize   # reescribe design/ en formato canónico
pnpm cli <subcommand>             # CLI de operación (ver packages/api/src/cli.ts)
pnpm snap list|save|restore|drop|reset   # instantáneas de la base de dev (DEMIURGO_DEV_TOOLS=1; docs/instantaneas-dev.md)
```

- Node 24 ejecuta TypeScript directamente (type stripping): no hay paso de build. Imports relativos con extensión `.ts`; nada de enum, namespaces, parameter properties ni decoradores (`erasableSyntaxOnly`).
- La trazabilidad AC → prueba se construye desde `reports/junit-*.xml`: ejecuta `gate:test` y `gate:invariants` antes de `gate:traceability`. Cada AC automático necesita una prueba que pase y cuyo título empiece por su código.
- Las pruebas que usan el motor durable arrancan DBOS sobre su base efímera; las demás usan el motor en línea (`packages/core/src/engine/inline.ts`), que procesa el conocimiento en el acto.
- **Motores de los agentes** (FDR-AGE-002):
  - se eligen en la web, en *Settings → Models & providers*: Claude, Codex u OpenCode (modelos locales como Qwen), globalmente o por proyecto;
  - sin motor asignado, la ejecución no se crea (409 «Choose a model for …»);
  - el proveedor `simulated` solo existe con `DEMIURGO_DEV_TOOLS=1`;
  - Claude y Codex consumen cuota de la suscripción: solo cuando se pida, y nunca en las pruebas, que usan el simulado y fixtures;
  - las variables `DEMIURGO_AGENT*`, `DEMIURGO_CLASSIFIER*` y `DEMIURGO_REVIEWER*` ya no existen y son un error.

## Arquitectura

Monorepo con cinco paquetes:

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

Flujo de autoridad: la IA solo produce propuestas (`proposal_batches`/`proposals`); una persona las acepta (`proposal.accept`, `batch.accept_package`) y eso crea la autoridad con su actor `human`. El conocimiento derivado se actualiza tras cada evento de autoridad y lo que afecta a la autoridad vuelve como propuesta de revisión.
