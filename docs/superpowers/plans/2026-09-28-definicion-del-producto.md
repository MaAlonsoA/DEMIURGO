# Definición del producto tras el onboarding: plan de implementación

> **Para agentes:** los pasos usan casillas (`- [ ]`). Cada fase termina con sus pruebas en verde antes de pasar a la siguiente.

**Objetivo:** que al terminar el Día 1 quede una base persistente y verificable del proyecto: una **definición del producto** aprobada por la persona, que dice qué es el proyecto, qué quiere construir y cómo. Cada una de sus secciones sabe de qué pregunta sale. Llega entera a todo agente que escribe registros, y sus cambios quedan como versiones, cada una con su porqué.

**Diagnóstico de partida (28-09):**

- Las respuestas del onboarding se quedan en el hilo.
- `stage.pass` no produce nada.
- Los packs de otros hilos y de `design_proposal` no ven esas respuestas.
- Ningún registro describe el producto entero.

**Arquitectura:**

| Pieza | Qué es | Dónde |
|---|---|---|
| Registro `product_definition` (`PRD-…`) | Ocho secciones: Purpose, Outcomes, Principles, Users, Problem, First version, Out of scope y Constraints. Uno por proyecto; sin criterios. | `domain/records.ts`, migración 0016 |
| Preguntas de la etapa | La etapa `requirements` pasa de 5 a 8 preguntas obligatorias (`purpose`, `outcomes` y `principles` delante). | `domain/stages.ts` |
| Composición sin IA | Cuando la etapa queda cubierta, el sistema compone la definición a partir de las conclusiones confirmadas y la propone (lote `system_package`). La persona la acepta y aprueba. | `domain/definition.ts`, `core/definition/compose.ts` |
| Fuentes por sección | La propuesta lleva `sources` (sección → pregunta). La versión apunta a la propuesta por `origin`. | payload `product_definition` |
| Evidencia de cada inferencia | El agente cita las palabras exactas de la persona. El servidor comprueba que la cita está en un mensaje humano del hilo. Sin cita válida no hay inferencia, y la pregunta se hace. | `questions.evidence`, aplicador de `exploration_chat` |
| Contexto | La última versión aprobada entra entera en los packs de `exploration_chat` y `design_proposal`, como dependencia y como fragmento del manifiesto. | `context/build.ts` |
| Cambios | Cambiar una sección reabre su pregunta con un motivo y la confirma con la respuesta nueva. El sistema compone la versión siguiente con la nota de cambio (qué y por qué), y la persona la aprueba. | mismo compositor |
| Traza (dev) | `GET /api/dev/trace` reconstruye la cadena de cualquier entidad: origen, datos y los packs que la han leído. En la web se abre con Alt+clic, solo con `DEMIURGO_DEV_TOOLS=1`. | `core/queries/trace.ts`, `api/dev-tools.ts`, web |

**Por qué así:**

- La composición es determinista y sin IA, así que lo que se guarda es exactamente lo que la persona confirmó.
- La IA solo infiere y cita, y lo que no puede citar lo pregunta.
- La autoridad sigue siendo humana: la definición nace como propuesta.

**Stack:** el actual. Sin dependencias nuevas.

## Decisiones de producto

Tomadas por la persona el 28-09:

- La definición vive en la propia pestaña Producto.
- El propósito es A + D: trabajo y resultados observables, más principios.
- Se infiere primero y se confirma en bloque.
- Hay trazas de desarrollo para todo.
- El aspecto es sobrio y de documento, sin «AI slop».

Tomadas por defecto en este plan; reversibles:

1. **Cuándo se compone:** al quedar cubierta la etapa `requirements` (la última confirmación o descarte), en la misma transacción, y no al pasarla. `stage.pass` compone solo si todavía no hay definición ni propuesta pendiente. Esto recoge proyectos cuya etapa se cubrió antes de este cambio.
2. **Pregunta descartada:** la sección dice `Left open: <motivo>`. Si el proyecto no tenía esa pregunta (etapa abierta antes del cambio), la sección dice `Not asked when this stage opened.`
3. **Una definición por proyecto.** Índice único parcial. Los cambios son versiones del mismo registro.
4. **Inferencia sin cita literal:** se descarta y la pregunta queda pendiente. El esquema no obliga a citar, así que una salida sin citas no invalida la ejecución entera.
5. **Proyectos existentes:** no hay relleno retroactivo. Los cambios que nacen en otros hilos (una decisión que altera una restricción) quedan para un plan posterior; aquí el cambio se hace desde la propia definición.
6. **Evaluación del prompt con modelos reales:** fuera de este plan porque consume cuota. Se hace cuando la persona lo pida, con el banco de ideas de las pruebas.

## Restricciones globales

- Se trabaja en el worktree `../DEMIURGO-definicion` (rama `v2.2-definicion`), porque la instancia 8100 monta el árbol principal y se recarga sola. La migración 0016 no toca los datos reales hasta que la persona fusione. Antes de fusionar: `pnpm snap save antes-definicion`.
- Las migraciones se añaden siempre nuevas; nunca se edita la 0009.
- Ninguna llamada real a Claude ni a Codex. Las pruebas usan el simulado.
- La aceptación es solo humana. El sistema propone la definición y nunca la aprueba.
- Código en inglés. Plan y commits en español.
- Cada fase se cierra con sus pruebas. Al final: `pnpm gate:all` y los e2e de onboarding, producto y definición.

## Fase 1: el registro y su composición (dominio)

- [ ] **1.1 Tipo `product_definition`** en `domain/records.ts`:
  - `RECORD_TYPES`, con prefijo `PRD`.
  - Plantilla de 8 secciones con `requiresCriteria: false`.
- [ ] **1.2 Migración `0016_product_definition.sql`:**
  - `records_type_check` con los 9 tipos;
  - índice único `records (project_id) where type = 'product_definition'`;
  - `questions.evidence jsonb not null default '[]'`.
- [ ] **1.3 Preguntas nuevas** en la etapa `requirements`:
  - `purpose`: el trabajo que el producto hace, para quién y en qué situación;
  - `outcomes`: señales observables de que funciona;
  - `principles`: reglas para decidir entre opciones.

  Van delante de las cinco actuales, así que la etapa queda con 8.
- [ ] **1.4 `domain/definition.ts`:**
  - `DEFINITION_SECTIONS` (sección ↔ clave de pregunta);
  - `composeDefinition(questions)` → `{ title, sections, sources }`;
  - `definitionChanges(prev, next)` → las secciones cambiadas.

  Son puras y tienen pruebas unitarias.
- [ ] **1.5 Payload `product_definition`** en `domain/proposals.ts`:
  - forma: `{ record?, title, sections[8], sources[8], change_note? }`;
  - solo lo propone el sistema (guarda `valid_payload`).

## Fase 2: backend

- [ ] **2.1 Aplicación `product_definition`** (`core/commands/effects.ts`):
  - sin `record`, crea el registro;
  - con `record`, crea la versión siguiente (`record_version.create`) con su nota de cambio;
  - con `approve`, aprueba.
- [ ] **2.2 Compositor** `core/definition/compose.ts`, que se llama desde `question.confirm`, `question.discard` y `stage.pass`:
  - Comprueba que la etapa es `requirements` y que está cubierta.
  - Comprueba que no hay otra propuesta pendiente.
  - Si hay versión aprobada y el contenido no cambia, no propone nada.
  - Envía `batch.submit` con `cause.sourceCommand = 'batch.submit'` (la guarda `own_open_batch`).
  - Actor: `system('definition')`.
- [ ] **2.3 Nota de cambio:** qué secciones cambian y por qué. El porqué sale del motivo de `question.reopen` de su pregunta; si no lo hay, de la respuesta nueva.
- [ ] **2.4 Evidencia:**
  - `question.infer` acepta `evidence: [{ message_id, quote }]` y comprueba que cada cita está en ese mensaje.
  - La salida de `exploration_chat` añade `quotes` a cada inferencia.
  - El aplicador resuelve cada cita contra los mensajes humanos del hilo y descarta las inferencias sin ninguna cita válida.
- [ ] **2.5 Packs:** `withDefinition` para `exploration_chat` y `design_proposal`:
  - contenido `product_definition` (código, versión y secciones);
  - dependencia `record`;
  - fragmento `product_definition` en el manifiesto.

  Sin definición aprobada no cambia nada (el hash se mantiene). La selección de conocimiento excluye los nodos `product_definition` para no duplicarlos.
- [ ] **2.6 Conocimiento:** `TYPES_WITH_AUTHORITY` incluye los tipos de etapa y `product_definition`.
- [ ] **2.7 Lecturas:**
  - `product_definition` no tiene readiness y no cuenta en `designs` ni en `ready_to_build`.
  - `GET /api/projects/:id/definition` devuelve:
    - el registro;
    - sus versiones, cada una con sus fuentes enriquecidas (pregunta, estado, quién confirmó y cuándo, citas);
    - la propuesta pendiente.
- [ ] **2.8 Traza:** `core/queries/trace.ts` + `GET /api/dev/trace?project&type&id` (solo con dev tools). Tipos: `record`, `record_version`, `question`, `message`, `proposal`, `batch` y `run`. Devuelve:
  - la entidad en crudo;
  - sus eventos;
  - los pasos de origen, encadenados;
  - los packs que la leyeron:
    - por dependencia para registros;
    - por contenido para preguntas;
    - «no se registra» para mensajes.
- [ ] **2.9 Prompts:**
  - `onboarding/AGENT.md` y `asking-questions`: inferir primero, citando literal; preguntar lo que la idea no dice (como mucho 2); propósito como trabajo, resultados y principios.
  - `explorer` y `designer`: cómo usar `product_definition`. Los principios son una lista de comprobación, y lo que la contradiga se dice.
- [ ] **2.10 Simulado:** el marcador `[infer]` en el mensaje infiere todas las preguntas pendientes menos las dos últimas, citando la primera frase. Sirve para pruebas deterministas.
- [ ] **2.11 Pruebas de integración** (`core/test/definition.test.ts`, `api/test/definition.test.ts`):
  - la definición se propone al cubrir la etapa y no antes;
  - cada sección apunta a su pregunta;
  - aprobarla crea `PRD-…` v1;
  - el pack de otro hilo y el de `design_proposal` la llevan entera y dependen de ella;
  - reabrir y confirmar propone la v2 con nota de cambio;
  - una cita inventada no crea inferencia;
  - la traza reconstruye idea → inferencia → confirmación → propuesta → aprobación → packs.

## Fase 3: interfaz

- [ ] **3.1 Día 1: «Esto es lo que entendí de tu idea»** (`onboarding/Start.tsx`):
  - Muestra las preguntas de la etapa sin cubrir.
  - Cada inferencia lleva sus citas; cada pregunta abierta, sus opciones.
  - Se puede corregir en línea o dejar abierta.
  - Acción principal: «Confirmar y redactar la definición», que confirma en bloque y lleva a Producto.
- [ ] **3.2 Producto:** la definición como documento, arriba:
  - propuesta pendiente con «Aprobar definición»;
  - secciones con notas al margen: de qué pregunta salen, si la persona la confirmó tal cual o la corrigió, y las citas;
  - historia de versiones;
  - vista «Cambios desde vN» que pliega lo que no cambió y muestra antes/después con su porqué;
  - «Cambiar» por sección (reabrir + confirmar).

  Debajo sigue lo actual.
- [ ] **3.3 Inspector (dev):** Alt+clic sobre cualquier elemento con `data-trace` abre un panel con Origen, Datos y «Quién lo ha leído». Marca: definición, secciones, preguntas del Día 1, mensajes, propuestas y ejecuciones.
- [ ] **3.4 Tipos y palabras:** el tipo nuevo en las listas de la web (iconos, prefijos, textos, secciones) y los catálogos en/es.
- [ ] **3.5 Pruebas:**
  - Unitarias de lo puro (cambios, orden, destino de la traza).
  - E2e `definition.spec.ts` con el simulado: idea con `[infer]` → confirmar en bloque → aprobar → Producto muestra la definición con sus fuentes → otro hilo responde con la definición en su pack → cambiar una sección → v2 con su porqué.

## Hecho cuando

- Tras el Día 1 existe `PRD-…` v1, aprobada por la persona, y cada sección apunta a la pregunta y al mensaje de los que sale.
- Cualquier ejecución posterior de `exploration_chat` o `design_proposal` lleva la definición entera y la declara como dependencia.
- Un cambio produce una versión con su nota (qué y por qué), y la anterior sigue entera.
- Con dev tools, la traza de una sección llega hasta la frase de la idea y hasta los packs que la leyeron.
- `pnpm gate:all` en verde. Los e2e de onboarding, producto y definición en verde.
