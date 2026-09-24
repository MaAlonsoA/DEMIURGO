# Informe de la sesión autónoma: frontend de H1

Fecha: 24-09-2026. Rama: `v2-frontend-h1`, creada desde `v2` (sin push; `main` no se ha tocado). Encargo: `docs/brief-autonomo-v2-frontend-h1.md`.

Antes de empezar, `pnpm gate:all` pasaba en `v2` (883 pruebas, trazabilidad completa para D0, S0, S1, S2 y H1). El árbol estaba limpio y no había otra sesión trabajando, así que no hizo falta un worktree.

Durante la sesión, la persona añadió dos indicaciones:
- «Si hay que terminar algo del back, hazlo también»: amplía la sección 4 del brief. Los cambios de back que van más allá de esa sección se marcan abajo como **ampliación autorizada**.
- «Si puedes usar subagentes para la implementación, hazlo»: el corte 0 (la base común) lo hice yo; a partir del corte 1, las pantallas se repartieron entre subagentes en archivos separados, y yo integré, pasé los gates e hice los commits.

## 1. Cómo arrancarlo

### Desarrollo con recarga en caliente

```powershell
pnpm install
pnpm db:up                                   # Postgres de desarrollo, 127.0.0.1:55432
# Base propia para la web (una vez): demiurgo_web_dev
$env:DEMIURGO_DATABASE_URL = 'postgres://demiurgo:demiurgo-dev@127.0.0.1:55432/demiurgo_web_dev'
pnpm cli migrate
'demiurgo-dev-password' | pnpm cli create-person dev
pnpm cli create-project DEMIURGO            # devuelve el projectId
pnpm cli import-design <projectId> design    # lote pendiente, como en la instancia

# API de desarrollo en el 8200, con el agente y el clasificador simulados
$env:DEMIURGO_PORT = '8200'
$env:DEMIURGO_ORIGINS = 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8200'
node --watch packages/api/src/main.ts

# En otra terminal: Vite en el 5173, con proxy de /api hacia el 8200
$env:DEMIURGO_WEB_API = 'http://127.0.0.1:8200'
pnpm web:dev
```

Se entra en http://127.0.0.1:5173 con `dev` / `demiurgo-dev-password`. Esta base ya está creada y sembrada en el Postgres de desarrollo.

### Producción (mismo origen)

`pnpm web:build` deja el build en `packages/web/dist`. Si existe, `packages/api/src/main.ts` lo sirve desde el mismo origen que la API: toda ruta que no empiece por `/api` devuelve `index.html`.

### Gates

`pnpm gate:all` incluye ahora `gate:e2e` (build de la web y Playwright con axe contra la API con el simulador, en una base efímera `dmg_t_*` y el puerto 8310). La trazabilidad lee también `reports/junit-e2e.xml`.

## 2. Cortes

### Corte 0 · Base

- **Paquete `packages/web`:** React 19, Vite 8, TanStack Router y Query, Tailwind 4 con los tokens del spec (§5) y componentes sobre Radix (`radix-ui`) al estilo de shadcn/ui, reestilizados con esos tokens.
- **Cliente de la API** (`src/api/`): `fetch` al mismo origen con la cookie y la cabecera `x-demiurgo-csrf`; `ApiError { status, type, reasons }`; una función de consulta por consulta de la API; `runCommand` como única vía de escritura; acciones desde `/api/tables` y `/api/commands`.
- **Sesión:** `GET /api/session` al arrancar; un 401 lleva a `/sign-in?next=…`; el CSRF vive solo en memoria y, tras recargar, vuelve con `GET /api/session`.
- **Lenguaje visual** (`src/ui/`): marcas del paso 3 del canvas (puntos, Parked, Dropped, Replaced, Out of date, Conflict), barras, contador azul, «quién», tarjeta en tres tamaños con «peek», leyenda, `Reasons`, `ActionBar`, diálogos y `Markdown`. Cada marca lleva su tooltip con la frase de la leyenda.
- **Leyenda:** abajo a la izquierda, solo con las marcas de la pantalla; «Got it» la pliega en el ⓘ, que avisa de las marcas nuevas; `?` la abre en cualquier sitio; lo visto se guarda en `localStorage`.
- **Cabecera:** DEMIURGO y el proyecto, pestañas (Product, Threads, Needs you con su contador, Knowledge, Sources, Activity), frescura del conocimiento (versión del grafo y punto) y menú con «Sign out».
- **Tiempo real** (adelantado del corte 6): un `EventSource` por proyecto que invalida las consultas de cada entidad según la tabla de §8 del spec, y la banda ámbar «Can't reach DEMIURGO. Retrying…».
- **E2E:** `packages/web/test/e2e/support/server.ts` arranca la API sobre una base efímera con el motor durable, el agente y el clasificador simulados, una persona de prueba y el build servido desde la API. El agente simulado obedece marcas en su contexto para provocar cada estado de una ejecución: `[slow]` (sigue trabajando hasta que se cancela), `[fail-once]` (falla la primera vez con ese context pack) e `[invalid]` (salida fuera del esquema).
- **Pruebas:** AC-INT-001-02 (sesión), la base de AC-WEB-001-03 (axe y teclado), AC-WEB-001-02 (acciones desde las tablas, prueba de componentes), el diccionario completo y `Reasons`.

## 3. Cambios en el back

Todos en inglés, de solo lectura salvo el CSRF, y con sus pruebas en `packages/api/test/web.test.ts`, `web-queries.test.ts` y `changes.test.ts`. No se ha tocado ningún comando, tabla, guarda, regla de autoridad ni el esquema de la base. `design/data/` no cambia: las consultas nuevas reutilizan los nombres de consulta de la matriz.

### Dentro de la sección 4 del brief

| Cambio | Dónde | Consulta de la matriz |
|---|---|---|
| La API sirve `packages/web/dist` con `@fastify/static`; toda ruta GET fuera de `/api` devuelve `index.html`; una ruta `/api` desconocida es un 404 en JSON | `server.ts` (`webRoot`), `main.ts` | — |
| `GET …/knowledge/graph`: nodos (vigentes y el último invalidado de cada referencia) y aristas vigentes, con tipo, referencia, estado epistémico, área de la taxonomía (`areas`: eje → categoría) y el registro de origen | `core/src/queries/web.ts` | `query.knowledge` |
| `GET …/knowledge/idea-assessments`: evaluaciones de ideas con su veredicto, el nodo citado y su registro, y la propuesta evaluada | ídem | `query.knowledge` |
| `GET …/taxonomies`: taxonomías con su estado y su contenido | ídem | `query.knowledge` |
| `GET …/runs`: ejecuciones con estado, acción, hilo, modelo, de cuál es reintento, fechas, hash del context pack y lote producido; filtros `?exploration=` y `?state=` | ídem | `query.runs` |
| Detalle de un lote de importación: `import_counts` con los recuentos del origen (del evento `design.import`) y los del paquete (de sus propuestas) | `core/src/queries/read.ts` | `query.batches` |

### Ampliación autorizada por la persona («si hay que terminar algo del back, hazlo también»)

| Cambio | Por qué |
|---|---|
| `GET /api/session` devuelve el `csrf` de la sesión, derivado del token de la cookie (`sha256("demiurgo-csrf:" + token)`); la base sigue guardando solo huellas | Sin él, una página recargada pierde el CSRF, que vive solo en memoria, y no puede escribir. Solo se entrega en el mismo origen y con la cookie httpOnly |
| El flujo SSE admite `?from=latest`: empieza en el último evento y lo anuncia con un evento `ready` cuyo `id` el navegador reenvía al reconectar | Sin él, cada carga de página reenviaba el diario entero del proyecto |
| `GET …/changes?since=<eventId>`: los eventos desde la última visita agrupados por cosa (registro, hilo, lote, conocimiento o proyecto) | La lente «What changed» y «While you were away»: los eventos de una versión no llevan el código de su registro |
| Filas del estado del producto con `summary`, `checks`, `latest_id`, `current_id`, `updated_at`, `updated_by` y `origin_exploration` | La plantilla de tarjeta (título y una línea, quién y cuándo, señales) y «qué desbloquea» |
| Versiones del detalle de un registro con `created_at`, `approved_at`, `origin_exploration` e `inferred_questions` | Las preguntas inferidas sin confirmar del hilo de origen se muestran como aviso ◐ en la readiness |
| Hilos (`GET …/explorations`) con `open_questions` y `last_activity` | La lista de hilos |
| Bandeja: enlaces por revisar con los códigos, versiones y títulos que unen; lotes y propuestas con sus dependencias | Decir qué hay que revisar y calcular qué desbloquea cada cosa |

### Arnés E2E (no es código de producción)

`packages/web/test/e2e/support/server.ts` envuelve el agente y el clasificador simulados con marcas para provocar cada estado desde las pruebas: `[slow]`, `[fail-once]`, `[invalid]` y `[classifier-fails]` (el clasificador falla sus tres intentos y la actualización queda rechazada; el reintento de la persona funciona).

## 4. Dependencias

Versiones exactas, resueltas por pnpm respetando el `minimumReleaseAge` de 3 días (ninguna hubo que bajarla a mano). Vite es la 8.3.0, la misma que ya usaba Vitest.

| Paquete | Versión | Dentro del stack de ADR-WEB-001 |
|---|---|---|
| `react`, `react-dom` | 19.3.0 | Sí |
| `@tanstack/react-router` / `@tanstack/react-query` | 1.170.38 / 5.103.2 | Sí |
| `vite`, `@vitejs/plugin-react` | 8.3.0 / 6.1.1 | Sí |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.3 | Sí |
| `radix-ui` (primitivas de shadcn/ui), `class-variance-authority`, `clsx`, `tailwind-merge` | 1.6.7, 0.7.1, 2.1.1, 3.7.0 | Sí: son las dependencias de shadcn/ui; los componentes se escriben en el repo, reestilizados con los tokens |
| `@playwright/test`, `@axe-core/playwright` | 1.63.0 / 4.13.0 | Sí |
| `@fastify/static` (en la API) | 10.1.4 | Sí (sección 4 del brief) |
| **`react-markdown`, `remark-gfm`** | 10.1.0 / 4.0.1 | **No.** Muestran las secciones de los registros en markdown, con tablas, sin HTML crudo |
| **`@fontsource-variable/instrument-sans`, `@fontsource-variable/jetbrains-mono`** | 5.3.0 | **No.** Las dos tipografías del spec, servidas desde el propio build en lugar de Google Fonts: sin peticiones a terceros y con capturas estables |
