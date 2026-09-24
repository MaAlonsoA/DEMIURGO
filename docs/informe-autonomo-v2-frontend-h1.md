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
# Sin proyectos: el producto se crea desde la UI con el Día 1 (/new).
# Para probar la ratificación en cambio:
#   pnpm cli create-project DEMIURGO ; pnpm cli import-design <projectId> design

# API de desarrollo en el 8200, con el agente y el clasificador simulados
$env:DEMIURGO_PORT = '8200'
$env:DEMIURGO_ORIGINS = 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8200'
node --watch packages/api/src/main.ts

# En otra terminal: Vite en el 5173, con proxy de /api hacia el 8200
$env:DEMIURGO_WEB_API = 'http://127.0.0.1:8200'
pnpm web:dev
```

Se entra en http://127.0.0.1:5173 con `dev` / `demiurgo-dev-password`. La base `demiurgo_web_dev` quedó vacía a propósito, como pidió la persona para probar de punta a punta, y solo tiene la persona `dev`. Al no haber proyectos, la portada lleva a **What do you want to build?**, el Día 1 de un producto nuevo.

Para volver a empezar de cero:
1. Parar la API.
2. Recrear la base: `DROP DATABASE demiurgo_web_dev WITH (FORCE)` y `CREATE DATABASE demiurgo_web_dev`, en el contenedor `demiurgo-v2-dev-postgres-1`.
3. Repetir `migrate` y `create-person`.

Esto no toca la instancia `demiurgo-v2`, que está en el 55433.

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

Commit `cc5da5f`. Los tres commits de back que siguen (`c0a2f89`, `bccdf7f` y `91b1b7a`) se describen en la sección 3.

### Corte 1 · Paquetes y lotes (`2b8f0b6`)

- **Paquete importado de `design/`:**
  - los recuentos del paquete frente a los del origen, con nada aprobado;
  - qué hace ratificar, dicho antes de hacerlo;
  - los documentos agrupados por tipo, que se abren en el sitio;
  - **Ratify**, con confirmación, y **Reject package**, con motivo;
  - los estados aceptado, rechazado y desfasado.
- **Paquete de DEMIURGO:** la ejecución que lo produjo, con su modelo; la FDR mostrada como página de registro; **Accept package**, **Accept and approve** y **Reject package**.
- **Lote de agente o de conocimiento:** una propuesta cada vez, con su autor y la comprobación de la idea, sin «aceptar todo». Cuando una propuesta está desfasada, dice por qué y no se puede aceptar.
- Pruebas: AC-INT-001-03, AC-WEB-001-01, AC-INT-001-12 y AC-INT-001-13.

### Corte 2 · Portada del producto y página de un registro (`7003d98`)

- **Portada:**
  - las funcionalidades como tarjetas de seis zonas: marca y palabra, las tres barras, el contador azul de lo suyo que espera a la persona, quién y cuándo, checks y «not built»;
  - las decisiones y decisiones técnicas como nodos, y los hilos con preguntas abiertas;
  - el *peek*: señalar una tarjeta muestra su código, su versión y los motivos de readiness tal como los da el servidor; un clic la fija y Enter la abre;
  - a la derecha, «Needs you» en el orden de «Catch up» y lo que está listo para construir. Recién ratificado, ofrece empezar por las versiones por aprobar.
- **Registro:**
  - las secciones en markdown y los checks, marcados «Automatic» o «You», con el aviso de verificabilidad cuando la readiness lo cita;
  - «Before it can be built»: los motivos del servidor y, aparte, los avisos y las preguntas supuestas de su hilo;
  - el contexto: de dónde viene, qué cambia y qué toca;
  - sus versiones;
  - **Approve** pide confirmación y no crea versión. Un borrador anterior a la versión vigente solo ofrece **Discard**.
- Pruebas: AC-INT-001-04, AC-INT-001-05 y AC-INT-001-08, y el *peek* con teclado (AC-WEB-001-03).

### Corte 3 · Hilos y ejecuciones dentro de un hilo (`fbaf322`)

- **Lista de hilos**, anidados bajo su padre, y **New thread**.
- **Página de un hilo:**
  - su origen, y **Conclude**, **Set aside** y **Resume** desde las tablas;
  - la conversación: DEMIURGO aparece con su modelo y cada observación lleva su chip (Proposed o Unknown, nunca Confirmed);
  - las preguntas, que se resuelven en el sitio;
  - los hilos hijos.
- **Compositor:**
  - **Send** escribe un mensaje;
  - **Ask DEMIURGO** pide respuesta;
  - **Draft it** pide el borrador de un diseño a partir de una decisión aprobada.
- **Ejecuciones dentro del hilo:**
  - en ámbar mientras trabajan, con su tiempo y **Cancel**;
  - en óxido si fallan, con el motivo y **Retry**;
  - en gris si se cancelaron o se reintentaron;
  - «A draft is ready» cuando llega el paquete.
- Pruebas: AC-INT-001-09 y AC-INT-001-10 (en curso, fallo y reintento, Draft it), y AC-INT-001-04 (chips de las observaciones).

### Corte 4 · Versión nueva con arrastre de checks (`fa97d77`)

- **Qué cambió** es obligatorio. Las secciones de la plantilla se editan en markdown.
- Cada check de la versión base exige **Keep**, **Change** o **Drop**, y **Add a check** añade uno nuevo.
- **Save draft** no se habilita mientras falte algo. La columna derecha dice qué falta, cuenta cada elección y muestra los enlaces que se arrastran tal como estaban.
- Al salir del enunciado de un check aparece el aviso de verificabilidad, sin bloquear. Lo da la misma función pura del servidor (`packages/domain/src/records.ts`), importada por ruta relativa para no meter el resto del paquete en el bundle.
- Un 409 o un 422 conserva lo escrito y muestra los motivos junto al botón.
- Pruebas: AC-INT-001-06, AC-INT-001-07 y AC-INT-001-14.

### Corte 5 · Needs you y Catch up (`f61d958`)

- **Needs you** reúne en siete grupos todo lo que espera a la persona:
  - los grupos son conflictos, preguntas (primero las que bloquean), propuestas, versiones por aprobar, enlaces, clasificaciones y actualizaciones fallidas;
  - cada cosa lleva su marca, de dónde viene, qué desbloquea (según los motivos de readiness del servidor) y sus acciones en el sitio, sacadas de las tablas;
  - vacío, dice «Nothing needs you. You can close DEMIURGO.».
- **Catch up** (`?catch-up=1`) recorre una cosa cada vez en el orden de FDR-INT-001, con **Skip** y **Leave**; lo saltado sigue en la lista. Un conflicto muestra las dos partes lado a lado con la recomendación de DEMIURGO, sin elegir por la persona.
- Pruebas: AC-INT-001-11, AC-INT-001-16 (Catch up) y el recorrido con teclado de AC-WEB-001-03.

### Corte 6 · «What changed» y «While you were away» (`fa5e7fc`)

- El navegador guarda la última visita a cada proyecto como el último evento visto.
- Al volver, la portada resalta lo que cambió desde entonces y atenúa lo demás.
- «While you were away» cuenta una línea por cosa, a partir de `GET …/changes`, y termina con «Nothing you confirmed was changed.» cuando es cierto.
- **Show everything** apaga la lente. Si no hubo cambios, no hay resumen.
- Pruebas: AC-INT-001-15 (una pantalla abierta ve lo que cambia otro actor sin recargar) y AC-INT-001-16 (la lente y la vuelta completa).

### Corte 7 · Conocimiento, fuentes, ejecuciones y orígenes (`57a314c`)

- **Conocimiento:** el grafo agrupado por área de la taxonomía, con las relaciones de cada nodo en el *peek*; la búsqueda; las evaluaciones de ideas con su cita; la taxonomía, que se aprueba o de la que se propone una versión nueva; y la huella de la reconstrucción comparada con la del grafo vivo.
- **Fuentes:** quién registró cada una, y el formulario para añadir otra.
- **Activity:** las ejecuciones, filtrables por estado.
- **Página de una ejecución:** estado y motivo en palabras, reintento, el *context pack* con su hash y sus eventos.
- **Orígenes:** un árbol hilo → decisión → funcionalidad, con la traza y «Why does this exist?».
- Pruebas: AC-INT-001-17 (ocho pruebas), AC-INT-001-10 (Activity y la página de una ejecución) y AC-INT-001-04 (orígenes).

### Cierre de H1 (`b80f8a3`)

- `h1-walk.spec.ts` recorre H1 en el navegador (AC-INT-001-01). Tras importar `design/` por la API, todo lo demás se hace desde la UI:
  - entrar y ratificar;
  - resolver lo que la ratificación deja en Needs you: aprobar versiones, conflictos, enlaces y preguntas;
  - abrir un hilo y pedir a DEMIURGO que proponga una decisión, que se acepta y se aprueba de un solo gesto;
  - **Draft it**, **Accept package** y **Approve** de la FDR.
  
  Al final, la FDR queda «Ready to build» y Needs you, vacío. Tarda unos 17 s con el simulador.
- ADR-WEB-001 y FDR-INT-001 pasan a `increment: H1`, así que la trazabilidad ya exige todos sus AC automáticos.
- Cada enlace del detalle de un registro dice a qué registro, versión, título y estado apunta. Sin eso, «What it touches» no podía nombrar el destino.
- El build separa en trozos propios React, TanStack, Radix y el markdown. El trozo principal pasa de 941 kB a 352 kB.

### Corte 8 · Empezar de cero y acercarse al canvas

Con H1 cerrado, la persona pidió tres cosas:
- borrar el contenido de su entorno y empezar un producto desde cero, «como se planeó con Design», con el onboarding;
- un front más fiel al canvas «DEMIURGO · UX»;
- el «B · Product blueprint» si no existía.

No es un corte del spec. Sigue sus reglas: solo lo que el back de H1 sostiene; lo que llega con incrementos posteriores (S6) aparece como un hueco discontinuo marcado «Later» y nunca con contenido inventado.

**Día 1 de un producto nuevo (`b7b7c70`), tableros S4A–S4E:**
- **`/new` · What do you want to build?:**
  - la idea y un nombre, con el aviso «You can't rename it yet.»;
  - tres ejemplos y las tres frases que tranquilizan;
  - **Start** crea el proyecto, abre su primer hilo con la idea como propósito y la envía con `respond: true`. Si un paso falla, reintentar no duplica nada.
- **`/p/$projectId/start/$explorationId`:** DEMIURGO lee la idea en directo:
  - antes de que exista la ejecución, «Waiting for DEMIURGO…»;
  - mientras trabaja, la tarjeta ámbar con su tiempo;
  - la respuesta, las observaciones y las preguntas aparecen a medida que llegan por el flujo;
  - si falla, la tarjeta en óxido con **Retry**.
- **Here's what I understood:**
  - lo entendido, todo *Proposed* o *Unknown*;
  - las preguntas que vienen;
  - lo que propuso, si propuso algo;
  - los huecos «Later» de *Who uses it*, *Rules* y *What it must do*;
  - **Correct something** vuelve a pedir la lectura.
- **Las preguntas, de una en una (`…/questions`):** **Answer** (`question.confirm`), **Skip** y **Not now** (`question.postpone`). Al final, **Ask DEMIURGO to propose decisions** envía un mensaje que empieza por «I decide:».
- **Your starting point (`…/done`):**
  - «1 idea → N questions answered → M decisions proposed»;
  - lo que espera a la persona, con el contador azul;
  - *What's next* (Draft it en el hilo) y «You can close DEMIURGO».
- **Entradas:** sin proyectos, `/` lleva a `/new`. La lista de proyectos y la cabecera tienen **New project**.
- **Pruebas:** AC-INT-001-01 (dos recorridos), AC-INT-001-09, AC-INT-001-10 (fallo y reintento), AC-INT-001-02 (entradas) y AC-WEB-001-03 (todo el Día 1 solo con teclado y axe en cada pantalla).

**Fidelidad al canvas y B1:**
- **«Ask DEMIURGO about this»** (B1, S5A y S6A):
  - una barra ligada a lo que hay en pantalla: el producto entero en la portada, el registro en su página;
  - reutiliza o abre el hilo de ese tema y sigue la respuesta debajo: «DEMIURGO is answering…» y luego «DEMIURGO answered · Open the thread ▸».
- **La revisión guiada** (S5A, S5B y S5D):
  - en un borrador que se puede aprobar, «Review it», con cinco partes: Context, What it's for, How it works, Checks y What DEMIURGO assumed;
  - recorre la misma página, resaltando cada parte y atenuando el resto;
  - **Looks right** avanza y **Change something** lleva la barra de DEMIURGO con «In ⟨parte⟩: » u ofrece una versión nueva;
  - **Confirm** aprueba sin crear versión.
- **«You're up to date»** (S6C): cuando Needs you queda vacío y al final de Catch up, muestra:
  - lo que la persona hizo hoy;
  - lo que sigue en marcha;
  - la tarjeta «Nothing needs you. You can close DEMIURGO.».
- **Portada como B1:**
  - la línea de progreso «Ready to build: X of N features · … need you · … in progress»;
  - el estado en cada tarjeta: Ready to build, Needs you, Working o Drafting con su tiempo;
  - *Recently decided* y «N items · about M minutes»;
  - los huecos «Later» de *Who uses it* y *Rules for the whole product*;
  - las ideas aparcadas (hilos apartados) y **Capture an idea**, que guarda la idea como hilo sin pedir nada a DEMIURGO.
- **Pruebas:** AC-INT-001-09 (tres pruebas: preguntar por una funcionalidad y por el producto, y capturar una idea), AC-INT-001-05 (la revisión y Confirm), AC-WEB-001-03 (la revisión solo con teclado y axe en cada parte) y AC-INT-001-11 («You're up to date»).

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

## 5. Estado de los criterios de aceptación

Los dos documentos llevan `increment: H1`, así que `gate:traceability` exige una prueba que pase para cada AC automático. En el `pnpm gate:all` del cierre de H1 pasaron 1028 pruebas y la trazabilidad quedó completa para D0, S0, S1, S2 y H1: 100 criterios con una prueba que pasa. Los títulos completos están en `reports/junit-e2e.xml` y `reports/junit-tests.xml`.

| AC | Verificación | Estado | Pruebas |
|---|---|---|---|
| AC-WEB-001-01 Mismo origen y CSRF | automática | ✅ | `batch.spec.ts`: Ratify va al mismo origen con la cookie y la cabecera; sin la cabecera, 403 |
| AC-WEB-001-02 Acciones desde las tablas | automática | ✅ | Vitest `tables.test.tsx`, cuatro pruebas: solo lo que permiten las tablas; quitar la transición quita el botón; lo que la matriz no da a una persona; lo que la API aún no implementa |
| AC-WEB-001-03 Accesibilidad básica | automática | ✅ | axe (ninguna violación seria ni crítica) en cada pantalla del recorrido, y cinco recorridos solo con teclado: entrar y moverse por las pestañas, el paquete hasta ratificar, el *peek* de la portada, Needs you con Catch up, y Orígenes |
| AC-WEB-001-04 Aceptación humana | manual | pendiente de la persona | — |
| AC-INT-001-01 Recorrido de H1 | automática | ✅ | `h1-walk.spec.ts` |
| AC-INT-001-02 Sesión | automática | ✅ | `session.spec.ts`: sin sesión va a Sign in y vuelve; Sign out; una página recargada sigue pudiendo escribir |
| AC-INT-001-03 Ratificación | automática | ✅ | `batch.spec.ts`: recuentos frente a `design/` y nada aprobado; tras Ratify, todos los eventos son de la persona |
| AC-INT-001-04 Estado epistémico visible | automática | ✅ | Cinco pruebas: portada, recién ratificado, aceptado pero aún Proposed, chips del hilo, orígenes |
| AC-INT-001-05 Aprobar no crea versión | automática | ✅ | `record.spec.ts` |
| AC-INT-001-06 Versión nueva con arrastre | automática | ✅ | `new-version.spec.ts` (dos pruebas) |
| AC-INT-001-07 Aviso de verificabilidad | automática | ✅ | `new-version.spec.ts` |
| AC-INT-001-08 Readiness con sus motivos | automática | ✅ | `record.spec.ts` (dos pruebas) |
| AC-INT-001-09 Hilo y preguntas | automática | ✅ | `threads.spec.ts` (dos pruebas) |
| AC-INT-001-10 Ejecuciones | automática | ✅ | `threads.spec.ts` y `runs.spec.ts` (cuatro pruebas) |
| AC-INT-001-11 Needs you completo | automática | ✅ | `needs-you.spec.ts` |
| AC-INT-001-12 Lotes de agente y paquetes | automática | ✅ | `batch.spec.ts` |
| AC-INT-001-13 Obsolescencia visible | automática | ✅ | `batch.spec.ts` |
| AC-INT-001-14 Errores accionables | automática | ✅ | `new-version.spec.ts`: un 409, un 422 y un 403 |
| AC-INT-001-15 Refresco incremental | automática | ✅ | `realtime.spec.ts` |
| AC-INT-001-16 Lo que cambió y ponerse al día | automática | ✅ | `lens.spec.ts` y `needs-you.spec.ts` (cuatro pruebas) |
| AC-INT-001-17 Conocimiento y fuentes | automática | ✅ | `knowledge.spec.ts` y `sources.spec.ts` (ocho pruebas) |
| AC-INT-001-18 Experiencia validada | manual | pendiente de la persona | — |

Los dos AC manuales (aceptar el ADR y validar la experiencia) son de la persona y no los he marcado.

## 6. Desviaciones y decisiones

- **Confirmar una respuesta supuesta pide confirmación.** El spec no lo pedía para las preguntas. Pero confirmar una respuesta inferida convierte en conclusión algo que escribió DEMIURGO: es decisivo, así que abre un `ConfirmDialog`, como aprobar o ratificar.
- **Ask DEMIURGO es `message.post` con `respond: true`.** No hay un comando aparte: la respuesta durable del motor espera al conocimiento y lanza `exploration_chat`. **Send** escribe sin pedir respuesta.
- **Draft it necesita una decisión aprobada.** Mientras el hilo no la tenga, el pie del compositor dice «Draft it needs an approved decision first.», porque `design_proposal` parte de ella. Primero ofrece las decisiones nacidas en el hilo.
- **El paquete importado no ofrece «Accept and approve».** El importador ignora `approve`: ratificar respeta el estado que cada documento tenía en `design/`. Ofrecerlo prometería algo que no pasa.
- **Marcas del arnés E2E** (`[slow]`, `[fail-once]`, `[invalid]` y `[classifier-fails]`). Provocan cada estado de una ejecución y del clasificador sin tocar el código de producción: el simulador solo se envuelve en `test/e2e/support/server.ts`.
- **axe no analiza lo que la lente atenúa.** En «What changed», lo que no cambió baja de opacidad a propósito y no cumple el contraste, así que esas pruebas excluyen `[data-dimmed="true"]`. El resto de la página se analiza entero.
- **Movimiento reducido.** Hay una regla CSS para `prefers-reduced-motion`, y Playwright corre con `reducedMotion: 'reduce'`, porque axe medía el contraste a mitad del fundido de la leyenda. Además, la leyenda ya no se abre sola en una pantalla sin marcas.
- **Un commit sobre un gate en rojo, ya corregido.** El commit del corte 6 salió con AC-INT-001-11 inestable, porque el `&&` seguía al `tail` y no al gate. La inestabilidad tenía dos causas:
  - tras **Retry**, la actualización del conocimiento en segundo plano añadía una clasificación y los recuentos finales no cuadraban;
  - la clave de la marca `[classifier-fails]` cambiaba entre intentos.

  Corregí la prueba y la clave, y enmendé el commit con el gate en verde. Desde entonces cada commit va dentro de `if [ $code -eq 0 ]`.
- **Subagentes.** Hice yo el corte 0 y el back. Desde el corte 1, cada grupo de pantallas lo hizo un subagente en su worktree, sobre carpetas separadas. Yo revisé su trabajo, apliqué sus notas (el diálogo de confirmación de las preguntas, la invalidación de la lista de hilos, los eventos filtrados por entidad y el tipo de `SearchResult`), integré en el orden de los cortes y pasé el gate antes de cada commit.
- **El bundle se divide en trozos de librerías** (React, TanStack, Radix y markdown), para que un cambio de la app no invalide su caché.
- **`increment: H1`** va justo después de `domain: interfaz` en los dos documentos, y `gate:design` los valida.

## 7. Pendiente

### Huecos del back que encontraron las pantallas

Ninguno bloquea H1. Cuando falta el dato, la UI lo muestra como ausente y nunca lo inventa.

- El modelo de una ejecución no se conoce hasta que termina. Mientras trabaja, la tarjeta dice «DEMIURGO», sin modelo.
- Las ejecuciones de Ask DEMIURGO las pide `system:conversation@1`, no la persona que escribió.
- La respuesta durable pendiente no se ve. Entre el mensaje y la ejecución, la UI solo puede decir «Waiting for DEMIURGO…».
- Las fuentes no dicen dónde se usan.
- Las revisiones no llevan el tramo de texto afectado, y su `change` es solo un id de versión.
- La comprobación de la idea en la bandeja no trae etiquetas legibles.
- `batch.supersede` no guarda el motivo en el lote.
- Desde el origen de una versión no se puede llegar a su lote.
- El detalle de un registro no trae el motivo de un descarte ni los enlaces entrantes.
- `GET …/changes` no incluye las dependencias de los lotes.
- La respuesta pendiente no queda registrada:
  - `respond` no se guarda en el mensaje;
  - la respuesta durable no emite ningún evento mientras espera al conocimiento.
  
  El Día 1 la supone a partir de la memoria de la pestaña, con un margen de 2 minutos. Pasado ese margen, ofrece «Ask DEMIURGO» (`run.request`).
- Una ejecución no dice a qué mensaje responde, así que la UI lo deduce por el tiempo.
- Las preguntas de DEMIURGO se registran con `raised_by: system:exploration@…` y sin la ejecución que las hizo.
- No hay comando para renombrar un proyecto (el Día 1 lo avisa: «You can't rename it yet.»).
- `changes` y `events` no filtran por fecha. «What you did today» lee `/changes?since=0`, que tiene un tope de 5000 eventos.
- El título de una funcionalidad no se conoce hasta que llega su paquete. Mientras DEMIURGO la redacta, su tarjeta dice «A new feature · From ⟨decisión⟩».
- No hay una consulta del historial de aprobaciones. *Recently decided* usa la última versión aprobada de cada registro.
- Si el reloj de la base va por delante del navegador (pasa con Docker), el tiempo de una ejecución puede marcar 0:00 al principio.
- Las entidades de S6 no existen: propósito del producto, quién lo usa, reglas y funcionalidades sacadas de una idea. Se muestran como «Later».

### De la interfaz

- Mientras nadie ha pulsado «Got it», la leyenda sale abierta abajo a la izquierda y puede tapar botones de esa esquina, como «Accept and approve» en la página de un lote. Es lo acordado en el diseño (§5): se abre en las primeras pantallas y, tras «Got it», vive en el ⓘ. Quien empieza por el Día 1 la pliega allí. Quien llega directamente a un paquete importado tiene que plegarla antes.

### Fuera de esta sesión

- **La instancia `demiurgo-v2` (55433/8100) no se ha tocado.** Su lote pendiente de `design/` es anterior a ADR-WEB-001 y FDR-INT-001 (ver la sección 9).
- Los AC manuales AC-WEB-001-04 y AC-INT-001-18.
- No se ha subido nada: la rama `v2-frontend-h1` es solo local.

## 8. Capturas

Las capturas están en `reports/screens/corte-N/`, de `corte-0` a `corte-8`. Las generan las pruebas E2E con `screenshot(page, N, 'nombre')` cada vez que corre `gate:e2e`. `reports/` está en `.gitignore`: las capturas son locales y el gate las regenera.

`corte-8/` reúne tres grupos:
- el recorrido de H1: Needs you vacío y la FDR «Ready to build»;
- el Día 1;
- la pasada de fidelidad.

## 9. Cómo ratificar H1 desde la UI

La instancia `demiurgo-v2` tiene un lote pendiente de `design/` importado **antes** de que existieran ADR-WEB-001 y FDR-INT-001. Si se ratifica tal cual, faltan esos dos documentos. Para ratificar H1 completo:

1. Arrancar esta rama contra la instancia. Su API sirve la web si existe `packages/web/dist`:

   ```powershell
   pnpm web:build
   # con el entorno de la instancia: base en 55433, puerto 8100
   node packages/api/src/main.ts
   ```

2. Reimportar `design/` en el proyecto de la instancia. El lote nuevo deja el pendiente como `superseded` («There is a more recent import of design/.»):

   ```powershell
   pnpm cli import-design <projectId> design
   ```

3. Abrir http://127.0.0.1:8100, entrar como la persona y abrir **Needs you**:
   - arriba está el paquete «Imported from design/»;
   - comprobar sus recuentos frente a los de `design/`;
   - pulsar **Ratify** y confirmar. Todos los eventos quedan a nombre de la persona.
4. Seguir en **Needs you** (o en **Catch up**) con lo que deja la ratificación:
   - aprobar las versiones con las que esté de acuerdo;
   - resolver conflictos y enlaces;
   - confirmar o contestar las preguntas.

Ratificar es decisión de la persona. En esta sesión no se ha ratificado nada fuera de las bases efímeras de las pruebas.
