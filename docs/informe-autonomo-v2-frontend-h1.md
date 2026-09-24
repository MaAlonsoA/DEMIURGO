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
