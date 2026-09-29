# Entrega por épicas (v2.2) · diseño

Fecha: 2026-09-29 · Rama: `v2.2` (modo parches) · Estado: pendiente de revisión por la persona.

Qué resuelve: con las épicas aceptadas, DEMIURGO tiene que llevar cada funcionalidad desde su épica hasta que está construida y comprobada, y decir en todo momento qué toca hacer. Este documento recoge el diseño acordado en el chat; se ejecuta como parches (`patch:`), uno por commit, en el orden del apartado 5.

## 0. Punto de partida y decisiones

Lo que existe hoy (leído en el código):

- Un hilo tiene *padre* (el árbol de «Hilos») y *origen* (una versión de registro, una propuesta, una pregunta). «Preguntar a DEMIURGO» sobre una épica abre un hilo con origen en esa versión. Los hilos que el explorador propone desde un hilo cuelgan de él.
- Una funcionalidad se une a su épica por el enlace `based_on` y por el dominio compartido (`EPC-GUI` → `FDR-GUI`).
- «Lista para construir» (`readiness` en `packages/domain/src/records.ts`) exige que una funcionalidad se base en una *decisión*; basarse en una épica o en la definición no cuenta. Con la jerarquía nueva ninguna funcionalidad llegaría a lista.
- La construcción y la evidencia no existen en la v2: `implementation` está fijo en `not implemented`; `evidence.record_manual` y las tareas (`task.*`) están en `design/data/transitions.yaml` (S3/S4) sin tabla ni comando. El repo del proyecto recibe `design/` con un commit por cada aceptación o aprobación.
- La etapa **Arquitectura** (momento `before_build`) se abre con una funcionalidad aprobada, pero no bloquea nada.

Decisiones tomadas por la persona:

| Decisión | Elección |
| --- | --- |
| Hasta dónde llega «entregar» en v2.2 | Registrar la construcción: la persona apunta la evidencia; DEMIURGO no construye. |
| Cómo se registra | Evidencia por criterio de aceptación. |
| Ritmo dentro de una épica | De una en una, desde la ficha de la épica; el explorador no propone hilos en masa. |
| Hilos | Dentro de la épica (el hilo de la épica es el padre); nunca asociados por contenido. |
| Etapa Arquitectura | Bloquea «lista para construir» mientras no esté pasada. |
| Criterios automáticos | La persona puede registrar su evidencia a mano, marcada como tal. |
| Ideas incluidas | A brief «Construir fuera», B épica por propuesta, C «Siguiente paso», D contexto de la épica, E dependencias. |
| Fuera de esta ronda | Evidencia detectada desde el repo (F), meta «primera versión del producto» (G), el runner (nivel 5). |

## 1. Modelo y datos

### 1a. Preparación («lista para construir»)

`readiness` cambia la regla de la base:

- Funcionalidad (`fdr`): al menos una base aprobada y vigente entre **épica**, **definición del producto** o decisión. Sin base: «It is not based on any epic or on the product definition.» Si la base tiene versión nueva, sigue la razón de hoy («It is based on EPC-GUI-001 v1, but the current one is v2») y el enlace queda pendiente de revisión (ya pasa al aprobar la versión nueva).
- ADR: base entre **funcionalidad**, definición o decisión.
- Funcionalidad: la etapa **Arquitectura** tiene que estar pasada: «The Architecture stage has not passed.» La etapa solo se abre con una funcionalidad aprobada, así que la primera queda «aprobada, no lista» hasta pasarla; «Siguiente paso» lo dice.
- Funcionalidad: todo lo que **necesita** (1c, enlaces `based_on` a otras funcionalidades) tiene que estar construido: «It needs FDR-GUI-002, which is not built yet.» Lista = se puede construir ahora.
- El resto no cambia: versión aprobada y vigente, criterios con cómo se comprueban, sin preguntas abiertas ni asumidas en su hilo, sin propuestas pendientes, sin enlaces pendientes de revisión.

`ReadinessInput` gana: el tipo del registro de cada base (`decision | epic | product_definition | fdr`), `needs: { code, implementation }[]` y `architecturePassed`. `versionReadiness` (`packages/core/src/queries/read.ts`) los calcula.

### 1b. Evidencia

Tabla `evidence` (migración nueva `packages/core/migrations/0024_evidence.sql`; antes, instantánea `antes-evidencia`):

| Columna | Tipo |
| --- | --- |
| `id` | uuid, uuidv7 |
| `project_id` | uuid → projects |
| `criterion_id` | uuid → criteria |
| `record_version_id` | uuid → record_versions |
| `kind` | `manual` \| `system` |
| `note` | texto no vacío |
| `reference` | texto opcional: commit, PR o URL |
| `state` | `recorded` |
| `recorded_by` | actor |
| `created_at` | timestamptz |

Solo se inserta; la última evidencia de un criterio manda. `TABLES` del bus gana `evidence: 'evidence'`.

Comando `evidence.record_manual` (capacidad ya generada: solo `human`; transición `new → recorded`): datos `{ criterion_id, note, reference? }`. Guardia `ac_manual` en v2.2: el criterio existe, es del proyecto y su versión está aprobada y vigente. Un criterio automático se admite igual: la evidencia es `manual` y la interfaz dice «comprobado a mano»; cuando exista el runner, la suya la sustituye.

Estado derivado `implementation` de un registro, sobre los criterios de su versión vigente:

- `not implemented`: ningún criterio con evidencia;
- `in progress`: alguno;
- `implemented`: todos.

Un criterio `kept` **hereda** la evidencia del criterio que arrastra (`derived_from`, siguiendo la cadena mientras sea `kept`); uno `modified` o `new` empieza sin evidencia. Así una versión nueva solo vuelve a «por construir» en lo que cambió. Un registro sin versión vigente es `not implemented`.

La épica tiene el mismo estado sobre sus criterios «Done when». **Entregada** (calculado en la web) = su `implementation` es `implemented` y todas las funcionalidades de su lista están `implemented`.

Las consultas: `RecordDetail.versions[].criteria[]` gana `evidence: { kind, note, reference, by, at } | null` (la última, heredada si toca); `RecordDetail.implementation` y `ProductRow.implementation` dejan de ser fijos.

### 1c. Épica ↔ funcionalidades ↔ hilos

- **Verdad:** el enlace `based_on` de la funcionalidad a la épica. Respaldo: el dominio compartido, que es lo que usa hoy la página «Épicas».
- **Lista prevista:** las líneas de la sección *Features* de la versión vigente de la épica. Cada línea, sin su marca de lista (`- `, `* `, `1. `, `1) `), es «Nombre: frase» (también «Nombre — frase»). El nombre se empareja con la funcionalidad por título normalizado (minúsculas, sin acentos, espacios simples): igual, o título que empieza por el nombre.
- **Estado de una línea**, de mayor a menor: **construida** (`implemented`) · **lista** (`readiness.ready`) · **aprobada** (tiene versión vigente) · **en diseño** (registro en borrador, o hilo activo cuyo propósito cita `"Nombre"`) · **sin empezar**.
- **Fuera de la lista:** una funcionalidad del dominio que ninguna línea nombra; se muestra aparte con el aviso de que la épica necesita una versión nueva.
- **Hilos.** «Diseñar la siguiente» abre un hilo con propósito `Design "Nombre" (EPC-GUI-001): frase`, origen la versión vigente de la épica y padre el hilo activo de la épica; si la épica no tiene hilo, se abre antes uno («About <título>», origen la épica) y el de la funcionalidad cuelga de él. Después publica el primer mensaje (`Let's design "Nombre": frase`) con `respond: true`, como la tarjeta de la primera funcionalidad. «Preguntar a DEMIURGO» desde una funcionalidad basada en una épica pasa `parent_id` = el hilo activo de la épica, si existe.
- **Hilos de la épica** (en su ficha): los de origen en cualquiera de sus versiones, los que cuelgan de ellos y los de origen en las versiones de sus funcionalidades.
- `ProductRow` gana `based_on: string | null` (código de su base: épica, definición o decisión) y `needs: string[]` (códigos de las funcionalidades de las que depende).

## 2. Interfaz

### 2a. La ficha de la épica

En la página del registro de una épica, encima de las secciones (donde una funcionalidad enseña su recorrido de diseño), el **tablero**:

- **Avance:** «2 de 5 construidas · 1 lista · 1 en diseño» y el recorrido («Done when»): sin comprobar / comprobado.
- **Lista de funcionalidades** en el orden de la sección, cada una con su estado y enlace a su ficha (si tiene registro) o a su hilo (si solo está en diseño). En la primera **sin empezar**, el botón «Diseñar la siguiente»; solo uno. Con «bloqueada por FDR-X» cuando lo que necesita no está construido. Si una está **lista**, el botón «Copiar encargo» (2c) al lado.
- Épica en borrador: el tablero dice «Aprueba la épica para empezar a diseñar» y no ofrece acciones; aprobar sigue en la cabecera.
- **Fuera de la lista**, si las hay.
- **Hilos de la épica**, con estado y preguntas abiertas.
- Los criterios «Done when» se comprueban en la pestaña Comprobaciones; el tablero avisa si faltan funcionalidades por construir, sin impedirlo.

La página «Épicas» del menú enseña lo mismo en pequeño: avance por épica, cada funcionalidad con su estado y el siguiente paso de cada una.

### 2b. «Siguiente paso» en Producto

La tarjeta «¿Por dónde empiezo?» pasa a «Siguiente paso» en cuanto hay una épica o una funcionalidad. Una sola acción, la primera que aplique (épicas por código):

1. Una épica en borrador → «Afina y aprueba EPC-X» (su ficha).
2. Una funcionalidad lista → «Construir "Y"» (su ficha, con el brief).
3. Una funcionalidad aprobada y la etapa Arquitectura sin pasar → «Pasar la etapa Arquitectura» (las etapas de Producto).
4. Una funcionalidad aprobada pero no lista → «Cerrar lo que le falta a "Y"» (sus razones).
5. Una funcionalidad en diseño → «Seguir con "Y"» (su hilo).
6. Una épica aprobada con una línea sin empezar → «Diseñar "X" de EPC-X» (abre el hilo, como el botón).
7. Todas construidas y el recorrido sin comprobar → «Comprobar el recorrido de EPC-X» (sus comprobaciones).
8. Todas las épicas entregadas → «Primera versión: pasa Seguridad y Operación» (las etapas).

Sin épicas ni funcionalidades, la tarjeta de hoy.

### 2c. El brief «Construir fuera»

En una funcionalidad **lista**, el botón «Copiar encargo» deja en el portapapeles, en inglés:

```
Build FDR-GUI-001 "Guided walkthrough" (v2), a feature of epic EPC-GUI-001 "Guided design".
Design in this repository: design/fdr/FDR-GUI-001.md and design/epics/EPC-GUI-001.md.
Goal: <first paragraph of the record>
Acceptance criteria:
- AC-GUI-001-01 · <title>: <statement>. Check (automatic): <how>
- …
Depends on: FDR-GUI-002 (built).
When done, list each criterion with how it was checked (test name or steps) and the commit.
I will record the evidence in DEMIURGO.
```

Las rutas salen de las carpetas de exportación (`design/fdr/`, `design/epics/`). Solo web: se construye desde el detalle del registro y las filas del producto.

## 3. Agentes y propuestas

### 3a. Reglas del explorador (`packages/core/agents/explorer/AGENT.md`)

En un hilo cuyo `about_record` es una épica:

- **Hilo de una funcionalidad** (propósito `Design "Nombre" (EPC-…)`): diseña esa funcionalidad y solo esa. Pregunta lo que le falte y, cuando esté claro, propone el `design_record` fdr con el dominio de la épica, `based_on` su versión vigente, sus criterios y `needs` (3c). Se mantiene dentro del recorrido de la épica y no pisa a sus hermanas (las ve en `design_records` con su estado). Nunca vuelve a proponer la épica.
- **Hilo sobre la épica entera:** afina la lista y el orden. Si la persona decide añadir, partir, quitar o reordenar funcionalidades, propone un `record_change` de la sección *Features* (3b). No propone hilos: dice que la siguiente se diseña desde la ficha de la épica con «Diseñar la siguiente».

Se retira la regla «una vez aprobada la épica, propone una exploración por funcionalidad». El paso «¿Por dónde empiezo?» no cambia.

### 3b. `record_change`: la épica evoluciona por propuesta

Tipo de propuesta nuevo, calcado de `definition_change`, para el registro de diseño que es el tema del hilo:

- Agente (`packages/domain/src/agents.ts`): `{ type: 'record_change', code, section, content, reason, quotes }`; `content` es la sección entera como debe quedar, en inglés.
- Servidor (`packages/domain/src/proposals.ts`): `recordChangePayload = { record: { code, version }, section, content, reason, evidence: [{ message_id, quote }] }`, en `PAYLOADS`.
- Aplicador (`packages/core/src/actions/exploration-chat.ts`): solo si `code` es el `about_record` del hilo, aprobado y vigente, y `section` es un título de su versión vigente; las citas se resuelven a mensajes como en `definition_change`. Si no cumple, la propuesta se descarta con nota.
- Efecto (`packages/core/src/commands/effects.ts`): `record_version.create` con las secciones vigentes y esa sustituida, todos los criterios arrastrados `kept`, los enlaces vigentes conservados y `change_note` = `reason`; «aceptar y aprobar» aprueba. Al aprobar, los `based_on` que apuntan a la versión anterior quedan pendientes de revisión (mecanismo existente).
- Web: en «Needs you» y en el lote, la tarjeta de la propuesta enseña la sección antes y después, como la de la definición.

### 3c. Dependencias entre funcionalidades

- El `design_record` fdr del agente gana `needs: [{ code, version }] | null`: funcionalidades hermanas aprobadas de las que depende.
- Efecto: un enlace `based_on` por cada una, de funcionalidad a funcionalidad (`views.ts` ya lo lee como «necesita»).
- Preparación: lo que necesita tiene que estar construido (1a). Tablero: «bloqueada por FDR-X». Brief: «Depends on».

## 4. Fuera de alcance

- Evidencia detectada desde los commits del repo del proyecto (F).
- Meta «primera versión del producto» más allá del paso 8 de «Siguiente paso» (G).
- El runner, las tareas (`task.*`) y la evidencia `system`.
- Reordenar la lista de la épica desde la interfaz: se hace por versión (a mano o por `record_change`).

## 5. Orden de parches y comprobación

Uno por commit (`patch:`, con `Pedido:` y `Dónde:`), push a `origin v2.2`, `pnpm gate:types` en cada uno, el API se reinicia solo sin ejecuciones en marcha. Nada llama a Claude ni a Codex.

| # | Parche | Toca |
| --- | --- | --- |
| 1 | Preparación: base épica/definición, Arquitectura bloquea, `based_on` y `needs` en las filas | `domain/records.ts`, `core/queries/read.ts`, `web/api/types.ts` |
| 2 | Evidencia: instantánea, migración, comando, `implementation`, pestaña Comprobaciones | `core/migrations/0024_evidence.sql`, `core/bus/bus.ts`, `core/bus/guards.ts`, `core/commands/evidence.ts`, `core/queries/read.ts`, `web/screens/record/Checks.tsx` |
| 3 | Tablero de la épica, «Diseñar la siguiente», hilos de la épica, hilos colgando, página «Épicas» | `web/screens/epics/*`, `web/screens/record/EpicBoard.tsx`, `web/components/ask.ts` |
| 4 | «Siguiente paso» en Producto | `web/screens/overview/*` |
| 5 | Brief «Copiar encargo» | `web/screens/record/*` |
| 6 | Explorador y `record_change` | `core/agents/explorer/AGENT.md`, `domain/agents.ts`, `domain/proposals.ts`, `core/actions/exploration-chat.ts`, `core/commands/effects.ts`, tarjetas web |
| 7 | Dependencias | `domain/agents.ts`, `core/commands/effects.ts`, `domain/records.ts`, tablero y brief |

Comprobación en cada parche: `gate:types`, y con Playwright en 8100 lo que se vea (la ficha de una épica, «Épicas», Producto, Comprobaciones). Las pruebas que se rompan se dejan rotas y se nombran en el chat.

## 6. Riesgos asumidos

- El emparejamiento línea ↔ funcionalidad es por título: si el explorador titula distinto, la línea sale «sin empezar» y el registro «fuera de la lista». Se corrige con una versión nueva de cualquiera de los dos.
- La evidencia manual de un criterio automático es una concesión de v2.2; se ve como «comprobado a mano».
- Bloquear por Arquitectura retrasa la primera construcción hasta pasar la etapa; es el sentido de `before_build`.
