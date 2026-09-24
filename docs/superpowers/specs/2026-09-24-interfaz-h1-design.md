# Interfaz de H1: spec de diseño

Fecha: 24-09-2026. Estado: **propuesto**, pendiente de revisión por la persona.

Documentos relacionados:
- **Qué hace la interfaz y sus AC:** FDR-INT-001 (`design/fdr/FDR-INT-001.md`).
- **Stack:** ADR-WEB-001 (`design/adr/ADR-WEB-001.md`).
- **Lenguaje visual y recorridos acordados:** `docs/diseno-ux-2026-09-24.md` y el canvas «DEMIURGO · UX», https://claude.ai/artifact/PVamudzj83KsLddTrHWtFP (páginas 3 a 8).
- **Contrato del back:** §9 de `docs/informe-autonomo-v2-h1.md`. Las rutas de ese informe están en español; aquí se usan sus nombres en inglés, tras la traducción del código.

## 1. Decisiones de partida (24-09)

| Decisión | Elección |
|---|---|
| Stack | SPA en React con Vite, TanStack Router y Query, Tailwind 4 y shadcn/ui, en `packages/web` |
| Alcance | H1 más lo ya acordado: la lente «What changed», ponerse al día de uno en uno y las páginas de conocimiento y de fuentes |
| Diseño | Este spec, y la revisión se hace en la app real a medida que se construye. Las páginas 9–14 del canvas no se dibujan |
| Proceso | ADR-WEB-001 y FDR-INT-001 nacen en `design/` antes de ratificar: se reimporta y se ratifica todo junto |
| Idioma | UI en inglés. Todo lo que escribe el back para la UI (etiquetas, motivos, errores) llega en inglés. La prosa de los registros se muestra tal como se escribió (hoy, en español) |
| Plataforma | Escritorio, a partir de 1280 px. El diseño se hace a 1440 × 900 |
| Visual | El aspecto neutro del canvas es el primer juego de tokens. La dirección visual se decide más adelante |
| Fuera | *Models & providers*, pantallas del canal de agentes y de sus claves, el mapa por áreas, *Journeys* y los carriles por persona |

**Dependencia:** la traducción del código a inglés (otra sesión) cambia las rutas y los campos de la API. El frontend empieza sobre esa traducción ya fusionada en `v2`.

## 2. Arquitectura del paquete

```
packages/web/
  index.html
  vite.config.ts          proxy de /api hacia la API (8100) en desarrollo
  src/
    main.tsx              QueryClient, router y proveedor de sesión
    router.tsx            rutas (sección 3)
    api/
      client.ts           fetch con credenciales, cabecera x-demiurgo-csrf y ApiError {status, reasons}
      queries.ts          una función por consulta de la API, con su clave de caché
      commands.ts         run(command, entityId, data) → POST …/commands/:command
      stream.ts           EventSource del diario → invalidación de consultas (sección 8)
      tables.ts           /api/tables y /api/commands → acciones permitidas por entidad y estado
    words.ts              diccionario de la UI: códigos de estado y de comando → palabras y marca (sección 6)
    ui/                   lenguaje visual (sección 5): marcas, tarjeta, peek, leyenda y motivos
    screens/              una carpeta por pantalla (sección 4)
  test/                   Vitest (componentes) y Playwright (e2e, con axe)
```

- **Mismo origen.** En producción, la API sirve `packages/web/dist` con `@fastify/static` y reenvía a `index.html` cualquier ruta que no empiece por `/api`. Es un cambio pequeño en `packages/api/src/server.ts`.
- **Sesión.** `GET /api/session` al arrancar. Un 401 en cualquier llamada lleva a `/sign-in?next=…`. El `csrf` de la sesión vive en memoria, nunca en `localStorage`.
- **Acciones.** `tables.ts` cruza la entidad, su estado actual y el actor `human` con las transiciones y la matriz. Devuelve los comandos disponibles, si son decisivos y el JSON Schema de sus datos. Ningún botón se fija a mano: si la tabla no lo permite, no aparece (AC-WEB-001-02).
- **Escritura.** Todo pasa por `commands.ts`. Tras un 2xx se invalidan las consultas afectadas; el SSE confirma después.

## 3. Navegación y rutas

Estructura de cada pantalla:
- **Cabecera** (siempre visible):
  - `DEMIURGO` y el nombre del proyecto;
  - las pestañas **Product** (subpestañas *Overview* y *Origins*), **Threads**, **Needs you** con su contador azul, **Knowledge**, **Sources** y **Activity**;
  - a la derecha, la frescura del conocimiento (versión del grafo y un punto: tinta si está al día, ámbar si se está actualizando, óxido si va por detrás) y el menú de la persona con *Sign out*.
- **Contenido de la página.**
- **Leyenda de marcas:** el ⓘ, abajo a la izquierda.

| Ruta | Pantalla | Consulta principal |
|---|---|---|
| `/sign-in` | Entrar | `POST /api/session` |
| `/projects` | Elegir proyecto (solo si hay más de uno) | `GET /api/projects` |
| `/p/:projectId` | Overview | `GET …/state`, `GET …/events` |
| `/p/:projectId/origins` | Origins | `GET …/state`, registros y exploraciones |
| `/p/:projectId/records/:code` (`?v=n`) | Registro | `GET …/records/:code`, `GET …/versions/:id/readiness` |
| `/p/:projectId/records/:code/new-version` | Versión nueva | `GET …/records/:code` |
| `/p/:projectId/threads` | Hilos | `GET …/explorations` |
| `/p/:projectId/threads/:explorationId` | Hilo | `GET …/explorations/:id` |
| `/p/:projectId/needs-you` (`?catch-up=1`) | Needs you y ponerse al día | `GET …/inbox` |
| `/p/:projectId/batches/:batchId` | Paquete o lote (incluida la importación) | `GET …/batches/:id` |
| `/p/:projectId/activity` | Ejecuciones | `GET …/events` (filtrado) |
| `/p/:projectId/runs/:runId` | Ejecución | `GET …/runs/:id` |
| `/p/:projectId/knowledge` | Conocimiento | `GET …/knowledge`, `…/knowledge/search`, `…/knowledge/rebuild` |
| `/p/:projectId/sources` | Fuentes | `GET …/sources` |

`…` equivale a `/api/projects/:projectId`.

## 4. Pantallas

Cada pantalla indica de dónde sale en el canvas, su esquema a 1440 px, sus estados y sus comandos.

### 4.1 Entrar

Tarjeta centrada con *DEMIURGO*, *User*, *Password* y *Sign in*.
- Un 401 muestra «Wrong user or password.» bajo el formulario y conserva el usuario.
- Tras entrar, va a `next` o al proyecto.

### 4.2 Paquete importado y ratificación (parada 1; mismo componente que cualquier lote)

```
┌ Imported from design/ · Package · ◯ Automatic (system:importer@1) · 14 proposals · Pending ─────────────┐
│ ┌ What's inside ───────────────────────────────┐  ┌ What ratifying does ───────────────────────────┐ │
│ │ Kind        In design/   In this package     │  │ Everything becomes DEMIURGO's, as it was in     │ │
│ │ Records     13           13  ✓               │  │ design/. What is proposed stays proposed:       │ │
│ │ Versions    13           13  ✓               │  │ ratifying approves nothing.                      │ │
│ │ Checks      114          114 ✓               │  │ From then on, design/ is an export.             │ │
│ │ Links …                                      │  │                                                 │ │
│ └──────────────────────────────────────────────┘  │ [ Ratify ]   Reject package                     │ │
│ Documents                                          └─────────────────────────────────────────────────┘ │
│  Decisions (1)       ○ DEC-PLN-001 · Reimplementar DEMIURGO como v2 · v1 · Open ▸                      │
│  Tech decisions (7)  ○ ADR-AGE-001 · Agentes por CLI con suscripción · v1 · 4 checks · Open ▸            │
│  Features (5)        ○ FDR-DIS-001 · … · v1 · 20 checks · Open ▸                                       │
│  Taxonomy (1)        ○ TAX-001 · Taxonomía inicial del producto                                         │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- *Open ▸* despliega el documento en el sitio: sus secciones y sus criterios.
- **Recuentos:** los que llegan del lote y los del origen; si no coinciden, la fila va en óxido.
- **«Ratify»** es decisivo: pide confirmación («Ratify 14 proposals? This makes DEMIURGO the home of your design.») y ejecuta `batch.accept_package`.
- **«Reject package»** pide un motivo y ejecuta `batch.reject_package`.
- **Un paquete obsoleto** (hay una importación más nueva) muestra el reloj gris, «Out of date: a newer import replaced it» y ninguna acción.

La misma página sirve para los otros dos tipos de lote:
- **Paquete de DEMIURGO** (`design_proposal`: una FDR con sus AC).
  - Arriba, la ejecución que lo produjo con su modelo.
  - Las acciones son «Accept package» y «Reject package».
  - Si el esquema del comando admite aprobar en el mismo gesto, se ofrece «Accept and approve».
- **Lote de un agente.** Se resuelve propuesta a propuesta, con el patrón de la pantalla 2 del paso 7 del canvas:
  - una propuesta cada vez, con el porqué en palabras del agente y sus fuentes;
  - «Accept», «Change» (`proposal.accept_edited`) o «Reject» con motivo;
  - nunca hay «aceptar todo»;
  - una propuesta obsoleta muestra el reloj y su motivo.

### 4.3 Overview (parada 2; canvas: B1 y el paso 6, pantalla 1)

```
┌ DEMIURGO                                                        ┌ Needs you ② ───────────────────┐
│ [While you were away · 3 changes]  Show everything              │ 1 Confirm an assumed answer     │
│  · You approved FDR-DIS-001 v1.                                 │   unblocks FDR-S3 · Open ▸      │
│  · DEMIURGO drafted "Change Set y pruebas…" (S3).               │ 2 Review a link …               │
│  · Knowledge found DEC-PLN-001 conflicts with …                 │ [ Catch up ]                    │
│                                                                 ├ Ready to build ─────────────────┤
│ Features                                                        │ ● FDR-DIS-001 ▮▯▯               │
│ ┌card┐ ┌card┐ ┌card┐ ┌card┐                                     └─────────────────────────────────┘
│ Decisions and tech decisions                                    │
│ ┌node┐ ┌node┐ …                                                 │
│ Threads with open questions                                     │
│ ┌node┐ …                                                         │
└─────────────────────────────────────────────────────────────────┘
```
- **Tarjetas:** la plantilla de 6 zonas del paso 3.
  - Las FDR llevan la pista de barras. En H1 solo vive la primera; *built* y *verified* van discontinuas.
  - Punto y peek al señalar, fijar al hacer clic y *Open* para la página completa.
- **Lente «What changed»:**
  - la última visita se guarda por proyecto en `localStorage` (el último `event_id` visto);
  - lo que no cambió se atenúa al 40 %;
  - el resumen da una línea por cosa, a partir de los eventos (sección 7.2);
  - «Show everything» apaga la lente;
  - sin cambios, no hay resumen.
- **Recién ratificado:** todo es *Proposed*. La columna *Needs you* ofrece empezar por las versiones por aprobar.

### 4.4 Origins (canvas: paso 2, Origins)

Árbol de izquierda a derecha: hilo → decisión → FDR o ADR, con sus enlaces `based_on` y `origin`. Al señalar un nodo se ilumina su traza, y cada rama lleva la frase «Why does this exist?», que sale de la conclusión del hilo o de la nota de cambio.

### 4.5 Registro (paradas 3 y 7; canvas: paso 5, pantallas 1, 2 y 4)

```
┌ ▭ Feature · FDR-DIS-001 · De la intención a «Listo para construir»…   ○ Proposed ▮▯▯   v1 draft ▾  [Approve] ┐
│ Goal … (markdown)                                         │ Before it can be built                        │
│ Scope …                                                   │  · The version is not approved.               │
│ Out of scope …                                            │  · 1 question is pending in its thread.       │
│ Behavior … (text; no lanes)                               │  ⚠ AC-DIS-001-07 may be hard to verify.       │
│                                                           ├ Context                                       │
│ Checks (20)                                               │  Where it comes from: thread «…» → DEC-PLN-001 v1 │
│  AC-DIS-001-01 · Recorrido completo   ◯ Automatic         │  What it changes: (change note of this version) │
│    Dada una intención nueva, …                            │  What it touches: links with their state        │
│    Check: Un E2E por la API …                             ├ Versions                                      │
│  …                                                        │  ● v2 Approved · current · you, 24 Sep          │
│                                                           │  ◎ v1 Replaced                                  │
│                                                           │  ○ v3 Draft · DEMIURGO                          │
└───────────────────────────────────────────────────────────┴───────────────────────────────────────────────┘
```
- **Plantilla por tipo:**

  | Tipo | Icono | Secciones | Criterios |
  |---|---|---|---|
  | Decisión | *Decision* | *Context*, *Decision*, *Consequences* | — |
  | ADR | *Tech decision* | *Context*, *Options*, *Decision*, *Consequences* | Sí |
  | FDR | *Feature* | *Goal*, *Scope*, *Out of scope*, *Behavior* | Sí |
  | Bug | — | *Reproduction*, *Expected*, *Observed* | Sí |

  Los títulos de sección se muestran tal como vienen del registro.
- **Checks:** cada criterio lleva *Automatic* (verificación `automatic`) o *You* (`manual`), su comprobación y, si procede, el aviso de verificabilidad.
- **Acciones:** salen de las tablas.
  - *Approve* (`record_version.approve`).
  - *New version* (lleva a 4.6).
  - *Discard* (`record_version.discard`). En un borrador anterior a la vigente es la única acción.
- **Readiness** («Before it can be built»):
  - los motivos del servidor, tal cual;
  - los avisos, aparte y con el icono de aviso;
  - las preguntas inferidas sin confirmar de su hilo, como aviso ◐ con enlace para confirmarlas;
  - sin motivos: «Ready to build» y la primera barra llena;
  - si la versión aprobada deja de estar lista, la primera barra pasa a óxido.
- **Selector de versión:** cada versión lleva su marca (Draft ○, Approved ●, Replaced, Discarded ⊘), su autor y quién la aprobó.

### 4.6 Versión nueva (parada 6; canvas: paso 5, pantalla 3)

- **Formulario:**
  - *What changed* (nota de cambio, obligatoria);
  - las secciones de la plantilla, editables en markdown;
  - la lista de criterios, cada uno con *Keep*, *Change* o *Drop*. *Change* abre el editor del enunciado, la verificación y la comprobación;
  - *Add a check*.
- **Aviso de verificabilidad:** se muestra al salir del campo del enunciado y no bloquea.
- **«Save draft»** ejecuta `record_version.create` con el arrastre explícito.
  - No se habilita sin nota ni sin una elección por cada criterio.
  - La UI dice qué falta.
- Al guardar, vuelve al registro con el borrador seleccionado y el botón *Approve* a la vista.

### 4.7 Hilos y un hilo (paradas 4 y 5; canvas: paso 4, pantalla 4, y paso 6, pantalla 2)

**Lista de hilos:** propósito, estado (*Active*, *Concluded* o *Set aside*), preguntas abiertas y última actividad. *New thread* ejecuta `exploration.open` con el propósito.

**Un hilo:**
```
┌ Thread · «Diseñar S3: Change Set y pruebas congeladas» · Active ─────────┬ Questions ───────────────────┐
│ ● You  ¿Qué acepta la persona antes de congelar las pruebas?             │ ◌ Who accepts the AC map?    │
│ ■ D    Propongo que … ○ claim  ? unknown                                 │   [Answer] Park  Drop         │
│ ┌ DEMIURGO is working… · Sonnet · 0:42 · Cancel ┐  (amber)               │ ◐ Tests run in the runner     │
│ └───────────────────────────────────────────────┘                        │   Assumed · [Confirm] Change  │
│ ┌ It couldn't finish: the output didn't match the format. · Retry ┐ (rust)│ ● Evidence only from system  │
│ └──────────────────────────────────────────────────────────────────┘     ├ Threads inside                │
│ [ Write…                                  ] Send · Ask DEMIURGO · Draft it │ Conclude · Set aside          │
└──────────────────────────────────────────────────────────────────────────┴───────────────────────────────┘
```
- **Mensajes:** autor con su marca (*You*, *D* o *Agent*). Las observaciones de DEMIURGO llevan chip con su marca (*claim* o *hypothesis* = Proposed, *unknown* = Unknown).
- **Preguntas:**
  - *Answer* confirma con la conclusión (`question.confirm`);
  - *Park* pide motivo (`question.postpone`) y *Drop* pide motivo (`question.discard`);
  - *Reopen* (`question.reopen`);
  - las inferidas muestran *Confirm* y *Change*.
- **Pedir a DEMIURGO:**
  - *Ask DEMIURGO* ejecuta `run.request` con `exploration_chat`;
  - *Draft it* ejecuta `run.request` con `design_proposal`. Cuando el paquete llega, el hilo muestra «A draft is ready: FDR-… with 6 checks · Review ▸», que lleva a 4.2.
- **Ejecución en curso:** tarjeta ámbar con el tiempo, el modelo (si el back lo registra) y *Cancel* (`run.cancel`).
- **Ejecución fallida:** tarjeta en óxido con el motivo en palabras de producto (según su `failure_kind`), *Retry* (`run.retry`) y *Details ▸*, que lleva a la ejecución.
- **Hilo:**
  - *Conclude* pide la conclusión (`exploration.conclude`);
  - *Set aside* pide motivo, y *Resume* lo reabre;
  - *New thread inside* abre un hilo hijo con su origen.

### 4.8 Needs you y ponerse al día (canvas: paso 6, pantallas 1 y 2, y paso 7, pantalla 2)

- **Lista:** agrupada en el orden en que se recorre al ponerse al día:
  1. *Conflicts*: propuestas de revisión que vienen del conocimiento;
  2. *Questions*: las inferidas, pendientes y pospuestas, primero las que bloquean una readiness;
  3. *Proposals*: por lote. Los paquetes del sistema, enteros; los lotes de agente, uno a uno;
  4. *Versions to approve*;
  5. *Links to review*: `link.keep`, `link.change` y `link.obsolete`;
  6. *Classifications to review*: `classification.resolve`;
  7. *Knowledge updates that failed*: `knowledge_update.retry`.
- **Cada fila:** marca, qué es, de dónde viene, qué desbloquea («unblocks FDR-…», calculado a partir de los motivos de readiness que cita) y sus acciones en el sitio.
- ***Catch up*** (`?catch-up=1`):
  - una cosa cada vez, a ancho completo, con «2 of 7 · about 1 min», *Skip* y *Leave*;
  - lo saltado sigue en la lista;
  - la columna derecha muestra qué desbloquea la cosa en curso.
- **Conflictos:**
  - las dos cosas lado a lado, con las palabras que chocan marcadas;
  - DEMIURGO recomienda, pero no elige.
- **Lista vacía:** «Nothing needs you. You can close DEMIURGO.»

### 4.9 Ejecuciones (Activity y una ejecución)

- **Activity:** lista de ejecuciones con su estado (marca y palabra), acción, hilo, cuándo y duración. Filtro por estado.
- **Una ejecución:**
  - estado y `failure_kind` en palabras;
  - «retry of» y reintentos;
  - *Cancel* y *Retry* según la tabla;
  - **Context:** rol, constructor, presupuesto, versión del grafo, dependencias y hash, más el contenido plegado;
  - sus eventos.
- **Casos especiales:**
  - *Interrupted* explica «DEMIURGO restarted while it was running»;
  - *invalid output* dice «Nothing was changed.».

### 4.10 Conocimiento (canvas: paso 6, conflicto; el mapa queda fuera)

Pestañas:
- ***Graph*:**
  - nodos agrupados por área de la taxonomía;
  - cada nodo con su tipo y su marca, y con sus aristas en el peek;
  - los invalidados, en gris.
- ***Search*:** `…/knowledge/search`.
- ***Idea checks*:** cada evaluación con su veredicto (*duplicates*, *contradicts* o *relates*) y la cita del nodo, que enlaza a su registro.
- ***Taxonomy*:** la vigente y las propuestas, con *Approve* (`taxonomy.approve`) y *Propose* (`taxonomy.propose`).
- ***Rebuild*:** la huella de la última reconstrucción y si coincide.

La frescura de la cabecera enlaza aquí. Un 409 por conocimiento desfasado dice «DEMIURGO is catching up with your latest changes. Try again in a moment.», con los motivos del servidor debajo.

### 4.11 Fuentes

- **Tabla:** título o URL, tipo, quién la registró (marca), cuándo y dónde se usa.
- ***Add a source*:** formulario con los datos de `source.register`, según su JSON Schema.

## 5. Lenguaje visual → componentes

**Tokens** (variables CSS en el `@theme` de Tailwind 4):

| Token | Valor | Uso |
|---|---|---|
| `paper` | `#F5F4F0` | Fondo |
| `surface` | `#FFFFFF` | Tarjetas |
| `ink` | `#1D1C1A` | Texto y Confirmed |
| `ink-2` | `#3E3B36` | Texto secundario |
| `muted` | `#6E6A62` | Etiquetas |
| `line` | `#E3E0D8` | Bordes |
| `line-strong` | `#D6D2C8` | Bordes de los controles |
| `needs` | `#2B4ACB` (hover `#1E3599`) | Solo «Needs you», Proposed y la selección |
| `working` | `#B7791F` (fondo `#F6EDDA`) | Trabajo en curso |
| `problem` | `#9A3412` en texto, `#B4461B` en relleno | Problemas |
| `inactive` | `#8C877B` (claro `#C4BFB3`) | Lo inactivo |

Tipografía: Instrument Sans; JetBrains Mono para los códigos.

**Componentes de `ui/`:**

| Componente | Qué es |
|---|---|
| `Mark` | Punto: *confirmed*, *assumed*, *proposed*, *open* o *unknown* |
| `ParkedMark`, `DroppedMark`, `ReplacedMark`, `StaleMark`, `ConflictMark` | Las marcas de estado del paso 3 |
| `StageBars` | La pista de tres barras (*ready*, *doubt* y *later*) |
| `NeedsBubble` | El contador azul |
| `WhoMark` | *You*, *DEMIURGO*, *Agent* o *Automatic* |
| `Card` | Tres tamaños: nodo, tarjeta y detalle |
| `Peek` | Aparece al señalar ~0,4 s, se encadena al instante con la siguiente y se fija con clic; accesible con el foco |
| `Legend` | En la esquina, solo con las marcas de la pantalla; «Got it» la pliega en el ⓘ; avisa de las marcas nuevas; lo visto se guarda en `localStorage` |
| `Reasons` | Motivos de 409 y 422, y de readiness |
| `ActionBar` | Botones según las tablas |
| `ConfirmDialog` | Para los comandos decisivos |
| `Markdown` | Secciones de los registros |
| `Composer` | Escribir en un hilo |

Cada marca tiene su tooltip, con la misma frase que la leyenda.

## 6. Palabras: estados del back → UI

Las etiquetas de `/api/tables` son la palabra por defecto. Este diccionario solo añade la marca y cambia la palabra donde el lenguaje acordado difiere.

| Entidad · estado | Palabra | Marca |
|---|---|---|
| `record_version` · `draft` | Draft | Proposed ○ |
| `record_version` · `approved` (vigente) | Approved | Confirmed ● |
| `record_version` · `superseded` | Replaced | Replaced |
| `record_version` · `discarded` | Discarded | Dropped ⊘ |
| `question` · `pending` | Open | Open ◌ |
| `question` · `inferred` | Assumed | Assumed ◐ |
| `question` · `confirmed` | Confirmed | Confirmed ● |
| `question` · `postponed` | Parked | Parked |
| `question` · `discarded` | Dropped | Dropped ⊘ |
| `proposal` · `pending` | Proposed | Proposed ○ |
| `proposal` · `accepted`, `accepted_edited` | Accepted, Accepted with edits | Confirmed ● |
| `proposal` · `rejected` | Rejected | Dropped ⊘ |
| `proposal` y `batch` · `superseded` | Out of date | StaleMark |
| `link` · `needs_review` | Needs review | Problema (óxido) |
| `link` · `obsolete` | Out of date | StaleMark |
| `ai_run` · `queued`, `running` | Queued, Working | Ámbar |
| `ai_run` · `failed`, `interrupted` | Failed, Interrupted | Problema |
| `ai_run` · `cancelled` | Cancelled | Inactivo |
| `knowledge_update` · `queued`, `classifying`, `verifying` | Updating | Ámbar |
| `knowledge_update` · `rejected` | Failed | Problema |
| `classification` · `pending_review` | Needs review | Needs you |
| `exploration` · `set_aside` | Set aside | Parked |
| Observación `claim`, `hypothesis` | Claim, Hypothesis | Proposed ○ |
| Observación `unknown` | Unknown | ? |

**Quién**, según el actor del evento o el productor del lote:

| Actor | Marca |
|---|---|
| `human:*` | *You* |
| `agent:run:*` | *DEMIURGO*, con el modelo |
| `agent:<name>:*` | *Agent* con su nombre |
| `system:*` | *Automatic* |

**Nombres:**

| UI | Back |
|---|---|
| *Feature* | FDR |
| *Tech decision* | ADR |
| *Decision* | DEC |
| *Check* | AC |
| *Thread* | Exploración |
| *Package* | Lote del sistema |
| *Batch* | Lote de un agente |
| *Needs you* | Bandeja |

## 7. Errores, carga y resúmenes

### 7.1 Errores

| Caso | Qué muestra la UI |
|---|---|
| 401 | Lleva a *Sign in*, conservando la ruta |
| 403 | Junto a la acción: «Only a person can do this.» o «This isn't allowed here.», con los motivos si llegan |
| 404 | Página «We couldn't find <thing>.», con vuelta al producto |
| 409 y 422 | `Reasons`, en óxido, bajo la acción que falló. El formulario conserva lo escrito y el foco va al primer motivo |
| Red | Banda ámbar «Can't reach DEMIURGO. Retrying…» mientras el SSE reconecta |

**Carga:** esqueletos con la forma de la tarjeta. Nunca un spinner a pantalla completa.

### 7.2 Resumen «While you were away»

Una línea por cosa: se agrupan los eventos por entidad desde el último `event_id` visto. La plantilla por tipo de evento vive en `words.ts`:
- «You approved FDR-DIS-001 v2.»
- «DEMIURGO drafted FDR-… (6 checks).»
- «An agent proposed 3 changes to FDR-….»
- «Knowledge found a conflict in DEC-PLN-001.»

Termina con «Nothing you confirmed was changed.» cuando es cierto.

## 8. Tiempo real

- Un `EventSource` por proyecto abierto sobre `…/events/stream`. El navegador reenvía `Last-Event-ID` al reconectar.
- Cada evento invalida las consultas de su entidad y las agregadas:

  | Entidad del evento | Consultas que invalida |
  |---|---|
  | `proposal` o `batch` | `inbox`, `batch`, `state` |
  | `record_version` | `record`, `readiness`, `state`, `inbox` |
  | `question` o `message` | `exploration`, `inbox`, `state` |
  | `ai_run` | `run`, `exploration`, `activity` |
  | `knowledge_*`, `classification` o `taxonomy` | `knowledge`, `inbox`, frescura |
  | `source` | `sources` |

- La pantalla nunca se recarga entera. Lo que cambia bajo el foco de la persona no le mueve el cursor.

## 9. Pruebas

- **Componentes (Vitest):** `tables.ts` (AC-WEB-001-02), `words.ts` (que cada estado de las tablas tiene su palabra y su marca), `Reasons` y la lógica de la lente y del orden de *Catch up*.
- **E2E (Playwright, con axe en cada pantalla):**
  - arrancan la API contra una base efímera, con el agente y el clasificador simulados, y sirven el build del frontend desde la API;
  - los datos se preparan con comandos por la API (el mismo camino que `packages/api/src/tools/walkthrough-s1.ts`), y el agente externo se simula con un token por la API;
  - el título de cada prueba empieza por su AC: `AC-INT-001-NN …` y `AC-WEB-001-NN …`.
- **Gates:** `gate:e2e` entra en `gate:all`, y la trazabilidad lee su informe JUnit.

## 10. Orden de implementación

Cada corte termina con sus pruebas en verde y una revisión de la persona en el navegador.

| # | Corte | Qué incluye | AC |
|---|---|---|---|
| 0 | Base | `packages/web`, Vite con proxy, router, cliente de la API, sesión, tokens, marcas, leyenda, cabecera, la API sirviendo el build y `gate:e2e` | WEB-01, WEB-03 (de base), INT-02 |
| 1 | Ratificar | Página de paquete e importación | INT-03 |
| 2 | Producto y registros | Overview (sin lente), registro, aprobar y readiness | INT-04, INT-05, INT-08, WEB-02 |
| 3 | Diseñar dentro | Hilos, preguntas, *Ask DEMIURGO*, *Draft it*, ejecuciones en el hilo y paquete de DEMIURGO | INT-09, INT-10, INT-01 |
| 4 | Versionar | Versión nueva con arrastre y aviso de verificabilidad | INT-06, INT-07 |
| 5 | *Needs you* | Todos los tipos, lotes de agente uno a uno, obsolescencia y errores | INT-11, INT-12, INT-13, INT-14 |
| 6 | Volver | SSE en todas las pantallas, lente «What changed» y *Catch up* | INT-15, INT-16 |
| 7 | Conocimiento, fuentes, ejecuciones y orígenes | Las páginas 4.4, 4.9, 4.10 y 4.11 | INT-17 |
| 8 | H1 | Reimportar `design/` en la instancia, ratificar desde la UI y diseñar la FDR de S3 dentro | INT-18 (manual) |

Los cortes 0 a 3 bastan para cerrar H1. Los cortes 4 a 7 completan el alcance elegido.

## 11. Riesgos y pendientes

- **La traducción del código a inglés tiene que estar fusionada** antes del corte 0.
- **ADR-WEB-001 y FDR-INT-001 no llevan `increment` todavía.** H1 ya figura como implementado en `package.json`, así que la trazabilidad exigiría desde hoy una prueba para cada AC automático, y `gate:all` quedaría en rojo. El corte 8 les añade `increment: H1`, cuando todos sus AC tengan su prueba.
- **La última visita vive en el navegador.** En otro navegador, la lente empieza de cero. Guardarla en el servidor sería un comando nuevo; no hace falta para H1.
- **«Qué desbloquea»** se calcula en la UI a partir de los motivos de readiness. Si resulta frágil, se pide al back una consulta que lo dé hecho.
- **El modelo de cada ejecución:** si el back aún no lo guarda en la ejecución, la marca *D* dice solo «DEMIURGO». Guardarlo es de S5.
- **Pendientes fuera de este spec:**
  - la FDR de *Models & providers*;
  - la dirección visual;
  - la decisión 4 del informe (si las preguntas inferidas deben bloquear la readiness). Mientras tanto, la UI las muestra como aviso.
