# Cómo reimplementaría DEMIURGO

> Base: la auditoría `docs/analisis-vision-mvp-2026-09-24.md`, `VISION.md`, `AGENTS.md` y el código del commit `bf8a9cd`. Comprobé que `bf8a9cd` ya está publicado en `origin/main` (`git ls-remote`). No pude ver el estado de la CI porque `gh` no tiene sesión iniciada.
>
> **Revisión del 24-09-2026 (tarde).** Esta versión cambia dos cosas respecto a la primera:
> 1. **La v1 se descarta por completo.** No se usa para diseñar la v2 ni se le hacen arreglos: solo sirve como catálogo de lecciones. El diseño inicial vive en el repositorio hasta que la v2 tiene su Pilar 1 (§6).
> 2. **Se recuperan los cuatro motores de la visión original** (`D:\Dev\Demiurgo-archive-2026-09-23\docs`, 22–23-09-2026): flujo de trabajo determinista, contexto, conocimiento y trazabilidad, y observabilidad y mejora continua. El motor de contexto y conocimiento entra en el MVP (§3 y §7).

---

## 1. La idea en una frase y el enfoque elegido

**Primero se construye una versión muy fina pero completa de los dos pilares, sobre un núcleo en el que ningún agente puede decidir ni producir evidencia, y sobre un conocimiento del proyecto que se mantiene al día con un paso verificado. El diseño empieza en el repositorio, y la v2 pasa después, en dos cortes comprobables, a diseñarse (H1) y a construirse (H2) a sí misma.**

| Plan | Juez 1 (calidad y visión) | Juez 2 (viabilidad) | Juez 3 (dogfooding y experiencia) | Media |
|---|---|---|---|---|
| **1 · Esqueleto andante** (una franja fina de ambos pilares al principio) | **8,5** | **7,5** | 7 | **7,7** |
| 3 · Autoalojamiento por etapas (H1 y H2) | 7,5 | 6 | **8** | 7,2 |
| 2 · Primero el núcleo de gobierno | 7 | 4,5 | 5 | 5,5 |

**Por qué gana el Plan 1.** La v1 creció en horizontal: ninguna parte usaba de verdad los AC, las versiones ni la readiness, y por eso sus defectos pasaron desapercibidos (aprobar creaba v+1, los gates se podían saltar). Construir primero la cadena completa obliga a que cada concepto del Pilar 1 funcione dentro del Pilar 2. La regla es simple: un AC que no se puede convertir en una prueba en rojo no es un AC. Además, las piezas de más riesgo (sandbox, orquestación durable y evidencia del sistema) entran pronto. Desde S4, un E2E comprueba que el gate bloquea a un agente que dice haber terminado con las pruebas en rojo. Si el trabajo se para a mitad, este es el plan que deja algo que se puede demostrar.

**Objeciones al Plan 1 y cómo quedan corregidas:**
- **Juez 3: el corte llegaba demasiado pronto.** El plan pasaba la autoridad de diseño a la v2 antes de que pudiera guiar el diseño. Ahora H1 va **después de S2**: la v2 ya tiene diseño guiado mínimo, canal de agentes y un conocimiento que evalúa cada idea nueva.
- **Juez 3: el agente externo hablaba en nombre de la persona.** Ahora el servidor fija el actor: un agente conversa con su propio nombre y solo propone.

**Qué se ha traído de los otros planes:**
- **Del Plan 3:**
  - Los gates y las pruebas congeladas se cargan desde la release que está en ejecución, y quien construye es siempre la release estable anterior.
  - H1 y H2 son dos hitos separados. La importación del diseño del repositorio es idempotente.
  - Antes de congelar las pruebas, la persona acepta el mapa AC → comprobación → prueba.
  - El MVP incluye capturas de Playwright y la app de la asociación construida sin terminal.
  - Cada Change Set tiene un presupuesto que actúa como parada dura.
  - `failure_kind` distingue los fallos de infraestructura de los del agente.
  - Tras H2, nada entra en `main` fuera de un Change Set.
- **Del Plan 2:**
  - La matriz de capacidades se declara como datos y de ella se generan los tests 403/409.
  - Tests de propiedades y diario protegido contra UPDATE y DELETE.
  - Política declarativa de perfiles con escalado según `failure_kind`, ya dentro del MVP.
  - Un spike del runner registrado como ADR.
  - Vista «Estado del producto».
  - Diseño justo a tiempo.
  - Paquete de construcción por FDR.
  - Regla de recorte: se recortan funcionalidades, nunca invariantes.
- **Del plan de dogfooding:**
  - El canal de agente tiene lista de permitidos.
  - Bandeja única de propuestas.
  - Se mide cuánto aporta cada actor.
  - La síntesis del proyecto solo se genera a petición.
- **De la visión original (archivo del 22–23-09-2026):**
  - Los cuatro motores como marco de arquitectura (§3).
  - Un grafo de conocimiento que se actualiza en un paso explícito del flujo, controlado por el orquestador (antes REQ-032 y DR-0030).
  - Un modelo rápido y barato (Jev) que identifica, clasifica y ordena artefactos, sin controlar nunca el flujo (antes DR-0011).
  - Cuatro estados de la información: confirmado, propuesto, pendiente y desconocido.
  - Cada idea nueva se evalúa contra el conocimiento existente (relaciones, incompatibilidades, inconsistencias y duplicados) antes de avanzar (antes REQ-020).
  - Ramas de ideas visuales y persistentes (antes PROB-008 y REQ-019).
  - Procedimientos distintos para funcionalidad y bugfix (antes REQ-016).
  - Si un gate falla, la evidencia vuelve al mismo agente en la misma sesión lógica (antes REQ-030).
  - Preguntas de observabilidad, sobre todo «¿faltaba contexto relevante?» (antes PROB-001).

---

## 2. Principios de la v2

| # | Principio | Lección de la v1 |
|---|---|---|
| 1 | **El modelo propone, el sistema dispone y la persona decide.** Ninguna salida de IA cambia un estado de autoridad. | Una heurística léxica marca propuestas como `accepted` y se ejecuta en cada arranque (`app/project_state.py:42-58`, `app/main.py:27-28`). |
| 2 | **El actor lo fija el servidor según la credencial o el canal.** Los agentes nunca tienen la credencial humana ni rutas que escriban en el dominio. | No hay actor y el cliente declara `approved` y `origin` (`app/domain.py:26-27,83-89`). Todo mensaje se guarda como `role='user'` (`app/main.py:406`). |
| 3 | **Comandos con nombre y máquinas de estado declaradas como datos.** Una sola tabla sirve al servidor, a los tests y a la UI. Lo que no está en la tabla devuelve 409. | `accept_scope` devuelve un Change Set verificado a `scope_accepted`, y una tarea pasa a «done» con un PATCH libre (`app/domain.py:176-183`, `app/main.py:563-576`). |
| 4 | **Identidad, versión, aprobación y realización son cuatro cosas distintas.** Aprobar no crea versión y la evidencia no se hereda. | `revise` siempre crea v+1 y deja los AC anclados a un borrador. `GET /records` mezcla las versiones (`app/domain.py:103-120`, `app/main.py:485`). |
| 5 | **Una afirmación no es evidencia, y el tipo lo refleja.** Claim y Evidence son entidades separadas. Solo el sistema crea evidencia de gate, y cuenta la última por AC@versión y SHA. | La evidencia es texto que cualquiera declara. Basta un `passed` aunque exista un `failed` posterior (`app/main.py:634,640-651`). |
| 6 | **Las reglas que juzgan no viven en lo que se juzga.** Los gates y las pruebas congeladas vienen de la release en ejecución. El runner no tiene datos, credenciales, root ni red. | Autocertificación por API (§8.6 de la auditoría). El backend corre como root con `/data` y `/codex` montados (`compose.yaml:13-15`, `app/codex.py:144`). |
| 7 | **El contexto y los métodos son artefactos versionados.** Cada acción tiene un constructor puro y un context pack con hash que el reintento reutiliza. La obsolescencia se calcula solo sobre las dependencias declaradas, y la validación con JSON Schema es común. | El reintento arma otro contexto (`app/main.py:410-414` frente a `:423`). La huella es global (`app/codex.py:330-348`). Hay prompts incrustados y una validación distinta por función (`app/codex.py:99-101,298-314`). |
| 8 | **Todo trabajo largo son pasos persistidos, idempotentes y reanudables.** Nunca hilos efímeros. | Hilos daemon y `PROCESSES` en memoria (`app/codex.py:18,51`). El reinicio marca `interrupted` (`app/main.py:26`). Los tests escriben en `demiurgo.db` (`app/db.py:6`, `app/codex.py:409`). |
| 9 | **La atención es un presupuesto y la trazabilidad no es burocracia.** El sistema propone paquetes completos y la persona los acepta en un paso. Hay una sola bandeja, un tope de preguntas y se mide cuántas intervenciones hacen falta. | Cada tarjeta pide confirmación y hay 3 síntesis con IDs crudos (`app/domain.py:215,244-245`). Hay propuestas invisibles (`frontend/src/App.tsx:75,79`). La síntesis se lanza sola (`ProjectOverview.tsx:38-44`). |
| 10 | **Esqueleto primero y cada incremento cerrado con pruebas.** Cada uno termina con CI, E2E simulado, invariantes, criterios de UX y una ejecución real registrada. Se recortan funcionalidades, nunca invariantes. | Los E2E recorren una interfaz que ya no existe y la CI nunca se ejecutó (`frontend/e2e.mjs:50-51,70`, §8.1-8.2 de la auditoría). La UX P0 se aplazó y se acumuló (P1-R4). |
| 11 | **El conocimiento derivado es una proyección que se mantiene con un paso verificado.** Un clasificador identifica qué cambia y el sistema comprueba que se ha actualizado. Clasificar nunca es decidir: lo que afecta a la autoridad llega a la persona como propuesta. | El contexto no se selecciona: cada acción arrastra todos los hechos del proyecto y la huella es global (`app/project_state.py:8-22`, `app/codex.py:330-348`). No hay forma de saber qué conocimiento queda afectado por un cambio. |

---

## 3. Los cuatro motores

La visión original organizaba DEMIURGO en cuatro motores (DR-0001 del archivo). El plan los mantiene como marco de arquitectura. Cada motor tiene un dueño claro en el código y un incremento que lo hace real.

| Motor | Responsabilidad | Piezas de la v2 | Incrementos | En el MVP |
|---|---|---|---|---|
| **Flujo de trabajo determinista** | Estados, transiciones, gates, permisos para avanzar y ejecución durable | Máquina de estados como datos, DBOS, gates cargados desde la release, broker y runner | S0, S3–S5 | Completo en su versión básica |
| **Conocimiento y trazabilidad** | La autoridad: decisiones, FDR, AC y enlaces con versión; recorrido en ambos sentidos idea → requisito → decisión → especificación → tarea → código → test → evidencia | Record, RecordVersion, Criterion, Link, Evidence, vista Relaciones | S1, S2, S7 | Completo en su versión básica |
| **Contexto** | Mantener el conocimiento derivado al día y dar a cada acción el contexto relevante con un presupuesto | Grafo de conocimiento como proyección, taxonomía, clasificador (Jev), paso «Actualizar conocimiento», gate de frescura, evaluación de ideas, context packs | S2 | Básico: sin aprendizaje ni búsqueda semántica si una eval no la justifica |
| **Observabilidad y mejora continua** | Registrar qué pasó, por qué falló y con qué contexto, y proponer mejoras con evidencia | Registro propio en Postgres, context manifest, `failure_kind`, métricas, conjuntos de evaluación | Registro desde S0, métricas en S5 | Solo registro y medida. La mejora automática queda fuera |

**Regla común a los cuatro:** ninguno delega en un modelo una decisión de avance. Los modelos proponen, clasifican u ordenan. El orquestador decide con reglas deterministas, y la persona acepta lo que tiene autoridad.

---

## 4. Modelo de dominio mínimo

Se diseña completo desde S0 aunque las funciones sean finas. El estado vive en tablas y cada mutación añade un evento en la misma transacción. No es event sourcing puro.

| Bloque | Entidad | Campos clave | Estados (actor autorizado) |
|---|---|---|---|
| Identidad | **Project** | id, nombre | activo → archivado (humano) |
| | **Actor** | `human:<persona>` · `agent:<run\|externo>` · `system:<componente>@<versión>` · `unknown` (solo para historia importada) | Lo fija el servidor, nunca el cliente |
| | **Event** | seq por proyecto, actor, comando, entidad@versión, antes → después, causa (comando, propuesta, run o paso) | Solo se añade (append-only) |
| Pilar 1 | **Exploration** | propósito, `origin_ref` tipado (exploración, pregunta, registro@v, Change Set, tarea o evidencia), padre | activa ↔ concluida \| apartada (humano, con motivo) |
| | **Message / Observation** | hilo, autor = actor, run · tipo `claim\|hypothesis\|unknown` | — |
| | **Question** (tarjeta) | pregunta, motivo, impacto, conclusión, razonamiento | pending → inferred (sistema, a partir de la salida del agente) · → confirmed (humano, **con conclusión**) · → postponed\|discarded (humano, con motivo) · → pending al reabrir (humano; el historial se conserva) |
| | **Record** | código estable (`DEC-USU-001`), tipo `decision\|fdr\|adr\|bug`, dominio | — |
| | **RecordVersion** | n, secciones según plantilla (el `bug` lleva reproducción, esperado y observado), nota de cambio, origen, autor | draft → approved (humano) · approved → superseded (sistema) · draft → discarded (humano). El contenido es inmutable. |
| | **Criterion (AC)** | código estable, registro@v exacta, enunciado observable, verificación `automatic\|manual`, comprobación en lenguaje de producto, `derived_from` | Al crear una versión nueva se arrastra de forma explícita: mantener, modificar o descartar |
| | **Link** | tipo de un catálogo cerrado (`based_on`, `design_of`, `covers`, `origin`, `conflicts_with`, `derived_from`), extremos con versión | current → needs_review (sistema) → kept\|changed\|obsolete (humano) |
| | **ProposalBatch / Proposal** | productor, context pack, dependencias declaradas, evaluación de la idea si la hay · tipo, payload validado por schema | pending → accepted\|accepted_edited\|rejected (humano) · pending → superseded (sistema) |
| Conocimiento | **Taxonomy** | versión, ejes (por ejemplo, área del producto o atributo de calidad), categorías cerradas por eje, siempre con «otra» | draft → approved (humano). Es autoridad |
| | **KnowledgeNode / KnowledgeEdge** | referencia a entidad@v o a artefacto de código (ruta@SHA), categorías vigentes, estado epistémico **derivado** de su origen (`confirmado` si viene de algo aprobado, `propuesto`, `pendiente` o `desconocido`), `valid_from`/`valid_to`, update que lo creó | current → invalidated (sistema, solo a través de un KnowledgeUpdate verificado). Nunca se borra |
| | **Classification** | nodo, taxonomía@v, categoría por eje, confianza, justificación, clasificador@v, `input_hash` | Inmutable. Con confianza baja queda `pending_review` (persona) |
| | **KnowledgeUpdate** | evento que lo dispara, conjunto de candidatos con hash, veredictos, resultado de la verificación, versión del grafo antes → después | queued → classifying → verifying → applied\|rejected (sistema). Los veredictos que tocan la autoridad salen como Proposal |
| | **IdeaAssessment** | idea o propuesta, hallazgos (`relates\|conflicts\|inconsistent\|duplicates`) con citas a nodos@versión, clasificador@v | Inmutable. Es evidencia que se ve en la bandeja, nunca una decisión |
| Pilar 2 | **Workspace** | repo git fuera de la base, plantilla@v, `test_command` (JUnit), directorio de aceptación, perfil de calidad | — |
| | **ChangeSet** | tipo `feature\|bugfix`, resultado esperado, incluido y excluido, orígenes, `scope_snapshot`, rama, `base_sha`, `final_sha`, presupuesto | proposed → scope_accepted (humano; exige readiness y cobertura) → in_progress (sistema; exige frescura) → in_review (sistema; gates en verde sobre `final_sha`) → accepted (humano) · in_review → in_progress (humano) · → blocked (sistema) → in_progress (humano) · → paused (sistema, si cambia una versión del alcance) → scope_accepted (humano) · → cancelled (humano) |
| | **Task** | AC cubiertos (al menos 1, con justificación), área, dominio, dependencias, intento n/N, **sesión lógica del agente** (se conserva entre intentos) | open → tests_written → tests_frozen → implementing → checking → passed (sistema) · checking → implementing (sistema, mientras n < N, en la misma sesión y con la evidencia del KO) · → blocked (sistema) → implementing (humano: Reintentar o Aclarar) |
| | **AcceptanceCheck** | AC@v, nombre de la prueba, hash | proposed → frozen (sistema, después de que la persona acepte el mapa) |
| | **WorkStep** | tipo, clave de idempotencia (tarea, paso, intento), run, `input_hash`, `failure_kind` | queued → running → succeeded\|failed\|cancelled (sistema) |
| | **AgentRun** | acción, método@v, schema@v, perfil y modelo, context pack, tokens, tiempos, `failure_kind` | queued → running → completed\|failed\|cancelled\|interrupted · reintento con el mismo context pack |
| | **ContextPack / Claim** | rol, presupuesto, nodos incluidos con el motivo de cada uno, versión del grafo, dependencias entidad@v y hash · resumen, ficheros, `open_issues` | Inmutables. La Claim nunca cuenta como evidencia. |
| | **EvaluableResult / Evidence** | SHA, digest del entorno, plantilla@v · AC@v o Change Set, gate y `GATES_VERSION`, productor `system_gate\|human` (este solo en AC manuales), resultado `passed\|failed\|error`, artefacto (JUnit, log o captura) con hash | Inmutables y append-only |

**Funciones derivadas.** Son puras y no se almacenan: `readiness(versión)` (devuelve la lista de lo que falta, en lenguaje de producto), `cobertura(CS)`, `ac_verified(AC@v, sha)`, `realización(versión)` (sin implementar, en curso o verificada), `bandeja(proyecto)`, `frescura(proyecto)` (versión del grafo frente al último evento de autoridad) e `impacto(cambio)` (recorre el grafo).

| Invariante | Enunciado | Cómo se prueba |
|---|---|---|
| I1 Autoridad | confirmed, approved, accepted y scope_accepted solo se alcanzan con un evento de actor `human` | Tests de propiedades y matriz generada que espera 403 |
| I2 Canal | Un agente solo propone (Pilar 1) o escribe en su rama más una Claim (Pilar 2) | Test de arquitectura |
| I3 Transiciones | Toda transición sale de su tabla (si no, 409 sin efectos). Cada mutación deja un evento en la misma transacción y el diario no admite UPDATE ni DELETE | Tests generados desde la tabla y trigger en la base |
| I4 Versiones | El contenido es inmutable, aprobar no crea versión, «vigente» es la última aprobada y un AC comprometido no se edita | Tests unitarios |
| I5 Evidencia | Un AC está verificado si su última evidencia por AC@v y SHA es `passed` y la produjo `system_gate` (o `human` si el AC es manual). Una versión nueva no hereda la verificación | Tests y test de arquitectura (ningún run crea evidencia) |
| I6 Jueces externos | Gates y pruebas congeladas se cargan desde la release en ejecución | Modificar los gates en el workspace no cambia el veredicto |
| I7 Contexto y salidas | Cada run tiene un context pack de su constructor declarado, con la versión del grafo. Una salida fuera de schema da `failed/invalid_output` sin ningún efecto | Hash del envío igual al del reintento. Simulador que devuelve salida inválida |
| I8 Trazabilidad | Toda tarea cubre al menos 1 AC aprobado. Con el alcance aceptado, todo AC está cubierto. Si cambia una versión del alcance, el Change Set pasa a `paused` | Tests |
| I9 Aislamiento y proyecto | El runner no tiene datos, credenciales ni root. Toda entidad lleva `project_id`. Se archiva en lugar de borrar en cascada | Sonda dentro del runner y test de consultas |
| I10 Conocimiento | El grafo es una proyección: reconstruirlo desde la autoridad con las clasificaciones guardadas da la misma huella. Un clasificador solo escribe conocimiento derivado y propuestas: nunca un estado de autoridad ni qué gates se aplican. Ningún trabajo empieza con el grafo desfasado respecto a su alcance | Test de reconstrucción (misma huella) · test de arquitectura sobre lo que escribe el clasificador · un evento sin proyectar bloquea `in_progress` |

---

## 5. Hoja de ruta por incrementos

Tamaños relativos: S < M < L. Cada incremento termina con CI en verde, un E2E con agentes simulados, la suite de invariantes, criterios de UX propios y una ejecución real registrada. Tras S0 se mide la velocidad real. Si S3 y S4 juntos superan el doble de lo estimado, se revisa el plan y se activa el MVP de repliegue.

| # | Incremento | Objetivo | Funcionalidades | Pilar | Tamaño | Criterio de salida |
|---|---|---|---|---|---|---|
| D0 | **Diseño inicial en el repositorio** | Especificar lo justo para empezar sin ninguna aplicación | Carpeta `design/` con Markdown de formato fijo (frontmatter con código, versión, estado y AC con ID y verificación) · validador en la CI · spike de stack y del runner · ADR de stack y ADR de viabilidad del runner · FDR con AC de S0–S2 · taxonomía inicial | 1 | M | El validador pasa en la CI · ADR de stack y del runner aceptados por la persona (merge suyo) · FDR de S0–S2 con todos los AC verificables |
| S0 | **Esqueleto técnico** | Pasar por todas las piezas con contenido trivial | Núcleo puro: comando → capacidad → tabla → evento, con matriz como datos · diario protegido · migraciones y configuración inyectada · motor de pasos durable · puerto de agentes (simulador determinista, un adaptador real, JSON Schema común) · runner aislado · UI en español con actualización incremental | base | L | CI de 4 etapas en verde · matar el proceso con un trabajo en curso → se reanuda y su efecto ocurre una sola vez · la sonda no ve credenciales ni abre la base · 403 y 409 generados desde la matriz · UPDATE sobre el diario falla · salida inválida → `invalid_output` sin efectos |
| S1 | **De la intención a «Listo para construir», con canal de agentes** | La franja más fina del Pilar 1, usable por una persona o por un agente | Conversación y `exploration_chat` · lotes con run y context pack · RecordVersion con plantilla validada, aprobar sin crear versión · AC con verificación, comprobación y chequeo de verificabilidad · `design_proposal` (FDR y AC en un paquete) · readiness · bandeja y «Estado del producto» mínimos · estado epistémico visible · **canal de agentes** (MCP y API con token: leer, conversar con su nombre, registrar fuentes y proponer) | 1 | L | E2E: intención → decisión («Aceptar y aprobar») → FDR con 2 AC → «Listo para construir» y la bandeja queda vacía · un agente por el canal propone y la persona acepta en la UI · propiedad: todo comando decisivo con actor no humano se rechaza · readiness falsa por cada motivo · el context pack del reintento coincide con el del envío |
| S2 | **Conocimiento y contexto básicos** | Que el conocimiento se mantenga al día solo y cada acción reciba el contexto relevante | Grafo como proyección de la autoridad detrás de `KnowledgeGraph` · taxonomía aprobada por la persona · clasificador (Jev) detrás de `Classifier` con salida validada · paso «Actualizar conocimiento» disparado por cada evento de autoridad (§7.3) · invalidar en lugar de borrar · gate de frescura · evaluación de cada idea nueva, visible en la bandeja · context packs por rol con presupuesto · importador idempotente de `design/` | ambos | L | Aprobar una versión dispara la actualización y sube la versión del grafo · un veredicto que no cubre un candidato o cita un nodo inexistente → `rejected` sin efectos · un veredicto que invalida una decisión aprobada → propuesta en la bandeja, nunca un cambio directo · reconstruir con las clasificaciones guardadas da la misma huella · una idea que duplica una decisión aparece marcada con la cita · conjunto de evaluación del clasificador con precisión y cobertura registradas · importar dos veces `design/` no duplica |
| **H1** | **La v2 diseña** | Que la v2 pase a ser la autoridad de diseño | Importación de `design/` como lote pendiente → la persona lo ratifica en un paso · `design/` pasa a ser una exportación generada · el Pilar 2 se diseña ya dentro de la v2: la persona en la UI y los agentes por el canal | transversal | S | Mismos recuentos que el origen y nada aprobado sin acción humana · la FDR de S3 nace y se aprueba en la v2 · la exportación regenerada coincide con `design/` sin diff |
| S3 | **Change Set y pruebas de aceptación congeladas** | Convertir una FDR lista en trabajo comprometido, con pruebas que demuestran cada AC | «Preparar implementación» (Change Set propuesto por el sistema) · aceptar el alcance en un paso · workspace desde plantilla versionada (JUnit, typecheck, lint) · agente `acceptance_tests` con su context pack · **la persona acepta el mapa AC → comprobación → prueba** · G0: pruebas confinadas, una por AC, en rojo sobre la base y congeladas por hash | 2 | L | E2E hasta «Listo para implementar» · aceptar el alcance de una FDR no lista → rechazo con lo que falta · tabla de transiciones cubierta al 100 % · con el simulador, G0 en rojo al escribir fuera, con una prueba que ya pasa o con un AC sin prueba · reinicio sin commits duplicados |
| S4 | **Implementación gobernada, evidencia y revisión** (cierra el esqueleto) | Completar el ciclo con gates del sistema y juicio humano | Gate de frescura antes de empezar · implementador en el worktree (red solo hacia su proveedor) con el context pack de S2 · gates G1–G5 **cargados desde la release** · evidencia solo del sistema y Claim separada · bucle de 3 intentos **en la misma sesión lógica y con la evidencia del KO** → bloqueo · presupuesto por Change Set · vista Revisión (AC en lenguaje de producto, «qué cambió» rotulado como afirmación, «no comprobado», consumo, lista guiada para AC manuales) · Aceptar / Pedir cambios / Abrir exploración | ambos | L | E2E completo hasta FDR «Verificada» y nueva exploración con su origen · un agente que dice «terminado» con pruebas rojas → gate rojo → reintento en la misma sesión → verde · siempre falla → bloqueada tras 3 · modificar una prueba congelada pone G2 en rojo · un `failed` posterior revoca · tocar los gates en el workspace no cambia el veredicto · ninguna ruta de run crea evidencia |
| S5 | **Ejecución robusta, observable y bugfix** | Aguantar trabajo real, también correcciones | `changeset_proposal` con varias tareas y cobertura validada · worker en serie · `failure_kind` (infraestructura, agente, inestable) con repetición antes del veredicto · cancelar desde la UI · Reintentar / Aclarar / Abrir exploración con fallos explicados en lenguaje de producto · **pausa si cambia una versión del alcance** · política de perfiles con escalado · **procedimiento mínimo de bugfix** (registro `bug` con reproducción → prueba de regresión en rojo → mismo ciclo) · métricas, incluida «¿faltó contexto?» (lo que el agente pidió con `request_clarification` o buscó fuera del pack) · copia con `git bundle` | 2 | L | E2E: 2 tareas, la 2.ª bloqueada → Aclarar → en revisión · matar el worker → se reanuda con el mismo hash sin evidencias duplicadas · cancelar en menos de 10 s · un AC sin tarea se rechaza antes de llegar a la persona · aprobar una versión nueva del alcance → `paused` · 2 rojos seguidos → sube el perfil · un bugfix con la prueba de regresión en rojo antes y en verde después · la restauración conserva los SHA |
| **H2** | **La v2 se construye a sí misma** | Ejecutar Change Sets reales de la v2 sin poner en riesgo ninguna instancia | Workspace sobre un clon del repo · instancia estable propia (otro puerto, otros datos) · construye la release anterior, con los gates de esa release · rutas protegidas como segunda barrera · desde aquí, nada en `main` fuera de un Change Set | transversal | M | Un Change Set pequeño de la v2 queda aceptado con gates en verde y se fusiona con la CI en verde · un workspace sobre datos o sobre el repo servido se rechaza |
| S6 | **Exploración guiada, atención y ramas** | Que la calidad no dependa de cuánto escribe la persona | Preguntas con impacto y acciones completas · política de atención versionada (máximo 3; las de bajo impacto se infieren) · una síntesis por ronda sin IDs · **ramas de ideas con ciclo de vida y vista mínima** (origen, estado y relación con el conocimiento) · hipótesis e incógnitas · conflicto detectado por la evaluación de ideas → pregunta | 1 | L | E2E con 3 preguntas: confirmar, posponer y descartar → síntesis → decisión en la bandeja · 5 preguntas → 3 abiertas · ninguna salida de agente produce `confirmed` · una rama apartada se retoma con su contexto · atención por decisión medida |
| S7 | **Cambio con historia e impacto** | Revisar decisiones sin perder la historia | Versión nueva con nota de cambio y arrastre de AC · `needs_review` y propuesta de mantener, revisar o añadir por cada elemento afectado según el grafo · realización por versión («Basado en X v1 · vigente v2») · familia ADR · vista Relaciones sobre el grafo | ambos | L | E2E «invitados» (`VISION.md:212-214`): socios v1 → v2 → FDR en `needs_review` → FDR v2 con un AC nuevo → nuevo Change Set · la evidencia de v1 sigue en v1 · FDR v2 «sin implementar» |
| S8 | **Endurecimiento, segundo producto y release** | Declarar el MVP con evidencia | Capturas de Playwright como evidencia · auditoría de dependencias como gate · UX P0 (cancelar, Escape y foco, estados en español, nombres antes que IDs) · 7 escenarios con agentes reales · **una persona no técnica construye la asociación solo desde la web** · tag | transversal | M | Evaluación con media ≥ 4/5, ninguna nota por debajo de 3 y sin fallos críticos de autoridad, trazabilidad o evidencia · asociación aceptada con evidencia de sistema en todos sus AC y sin terminal · umbral de atención cumplido · CI en verde en el commit etiquetado |
| | **═══ CORTE DEL MVP ═══** | *D0–S8 con H1 y H2. Pilar 1 básico: S1, S2, S6 y S7. Pilar 2 básico: S3, S4 y S5. Motores: flujo determinista (S0, S3–S5), conocimiento y trazabilidad (S1, S2, S7), contexto (S2), observabilidad (registro desde S0 y métricas en S5)* | | | | |
| S9 | Selección y aprendizaje | Mejora basada en evidencia | Selección de modelos por reglas e historial · dataset de resoluciones y gates · banco de replays · mejorar el clasificador con las correcciones humanas · búsqueda semántica si una eval la justifica | transversal | M | 20 replays reproducibles · cualquier cambio de clasificador o de enrutado entra como propuesta con su eval |
| S10 | Planificación y calidad ampliadas | Trabajo de varias FDR y más controles | Planificador multi-FDR · revisor informativo · SAST y cobertura mínima · mutación sobre las pruebas de aceptación · detección de divergencias entre requisitos, especificación, código y tests | 2 | M | Change Set de 4 tareas con cobertura completa · una dependencia vulnerable bloquea · los comentarios del revisor aparecen como «Opinión del agente» |

**Fuera del MVP:**
- entrega, despliegue, hosting y operación de la app generada;
- más de una plantilla de stack;
- apps existentes distintas del repo de la v2;
- equipos y autenticación de varias personas;
- coste monetario;
- otros proveedores como implementadores;
- mapa visual completo del conocimiento (en el MVP solo la vista de ramas y la de relaciones);
- importar documentos arbitrarios;
- paralelismo entre Change Sets;
- aprendizaje automático (el MVP solo registra e informa);
- afirmar «calidad de producción». El MVP solo afirma que los AC comprometidos tienen evidencia de sistema sobre un SHA concreto, y enumera lo que no se ha comprobado.

**MVP de repliegue.** Si se agota el tiempo, el MVP queda en D0, S0–S5 con H1 y un S8 reducido, sin H2: los agentes externos siguen construyendo con el protocolo manual (§6). Los dos pilares siguen existiendo en la v2: S1–S2 y S3–S5. S6 y S7 pueden perder funcionalidades, pero no invariantes: la pausa, `needs_review` y que `confirmed` sea solo humano se mantienen. S2 puede perder la evaluación de ideas, pero no el paso verificado ni el gate de frescura.

---

## 6. El arranque (bootstrap)

```
D0: diseño en el repositorio → S0–S2 construidos por agentes externos con el protocolo manual
  → H1 (la v2 diseña) → S3–S5 diseñados en la v2 y construidos con el protocolo manual
  → H2 (la v2 se construye a sí misma) → S6–S8 dentro de la v2
```

**Por qué así.** La v1 no se usa, así que al principio no hay ninguna aplicación donde diseñar. El diseño empieza como archivos del repositorio, con un formato fijo que la v2 sabrá importar. En cuanto la v2 tiene diseño guiado, canal de agentes y conocimiento (S2), pasa a ser la autoridad de diseño (H1). En cuanto tiene el Pilar 2 completo y robusto (S5), se construye a sí misma (H2).

**Etapas:**
1. **D0: diseño en el repositorio.**
   - La persona y Claude Code escriben `design/` en Markdown con formato fijo. Claude Code propone por PR y la persona acepta con el merge: esa es la aceptación humana antes de que exista la aplicación. La rama `main` está protegida.
   - Un validador en la CI comprueba el formato, que los códigos sean únicos, que cada AC tenga verificación y que los enlaces existan.
   - Se diseña justo a tiempo: solo S0–S2 antes de empezar.
   - En paralelo, el spike de stack (2–3 días) y el del runner: un agente en un contenedor modifica un repo de ejemplo y un runner sin datos ni credenciales ejecuta sus pruebas. Salen el ADR de stack y el de viabilidad del runner.
2. **Construir S0–S2 con agentes externos**, con un protocolo que ya imita el Pilar 2:
   1. Se exporta el paquete de construcción: la FDR@v, sus AC, las decisiones y ADR vigentes y sus orígenes.
   2. Una sesión escribe las pruebas con el código del AC en el nombre.
   3. La persona acepta el mapa AC → comprobación.
   4. Otra sesión implementa sin tocar esas pruebas. La CI comprueba que siguen intactas y hace de hard gate.
   5. La persona acepta el PR. Los commits llevan el trailer `AC:` y se registran el consumo, los reintentos y los fallos.
   6. Al cerrar S4, el gate genera evidencia **retroactiva** sobre HEAD, rotulada como tal, que nunca satisface un AC.
3. **H1 (al cerrar S2).**
   - La v2 importa `design/` de forma idempotente como lote pendiente y la persona lo ratifica en un paso.
   - Desde aquí, `design/` es una exportación generada. La CI falla si alguien lo edita a mano.
   - S3–S5 se diseñan dentro de la v2. Se siguen construyendo con el protocolo manual, pero el paquete se exporta desde la v2 y los agentes la consultan por MCP.
4. **H2 (al cerrar S5).**
   - La v2 ejecuta un primer Change Set pequeño sobre un clon de su propio repo. Quien construye es la release anterior, y los gates vienen de esa release.
   - Desde aquí, nada entra en `main` fuera de un Change Set.

**Cómo se respeta la aceptación humana:**
- **Antes de H1:** solo la persona fusiona en `main`. Los agentes trabajan en ramas y proponen por PR.
- **Desde H1:** el servidor fija el actor. La UI es `human`, las ejecuciones son `agent:<run>`, el token de un agente externo es `agent:<nombre>:<sesión>` y los automatismos son `system`.
- Con token de agente solo se permiten lectura, conversación con su nombre, registro de fuentes y propuestas. Es una lista de permitidos: todo lo demás devuelve 403.
- Ninguna propuesta llega a `accepted` sin un evento `actor=human`. La credencial humana (cookie httpOnly) queda fuera del alcance de los agentes.
- Los lotes de agentes externos llevan como máximo 10 elementos y se resuelven **elemento a elemento**, con la fuente visible y aviso de obsolescencia. Los paquetes coherentes que genera DEMIURGO (FDR con AC, Change Set con cobertura validada, ratificación de una importación) se aceptan en un paso.

**Decisiones que te corresponden:**
- a) Dónde vive la v2. Recomendación: este repositorio, con el estado actual etiquetado como `v1-referencia`.
- b) Sustituir la regla «solo :8000» de `AGENTS.md`, que es de la v1, por la de la instancia estable de la v2 (puerto y datos propios), y prohibir que un workspace o un test apunte a una instancia o a una base en uso. Tiene que quedar escrito antes de H2.
- c) Fijar el umbral de atención del gate de S8.

---

## 7. Motor de contexto y conocimiento

### 7.1 Qué se recupera de la visión original

| Visión original (archivo) | En la v2 |
|---|---|
| Memgraph como grafo de conocimiento del proyecto (DR-0030) | Grafo detrás del puerto `KnowledgeGraph`. Empieza en Postgres y puede pasar a Memgraph sin coste de migración, porque es una proyección reconstruible (§7.6) |
| Un estado explícito del flujo que actualiza el grafo, controlado por el orquestador (REQ-032) | Paso «Actualizar conocimiento» (§7.3), con gate de frescura |
| Jev identifica, clasifica u ordena artefactos y no controla el flujo (DR-0011) | Puerto `Classifier` con dos usos: clasificar y decidir qué conocimiento cambia (§7.4 y §7.5) |
| «¿El grafo es autoritativo o una proyección reconstruible?» (pregunta abierta de DR-0030) | Proyección reconstruible (§7.2) |
| Evaluar cada idea contra el conocimiento antes de avanzar (REQ-020) | IdeaAssessment en la bandeja (§7.7) |
| Contexto relevante en una entrada semiplantillada, sin gastar tokens en lo irrelevante (REQ-005) | Context packs por rol con presupuesto (§7.8) |

### 7.2 Dos capas de conocimiento

- **Autoridad.** Decisiones, FDR, ADR, AC, alcance y taxonomía. Tienen versiones, viven en Postgres y solo una persona las aprueba.
- **Conocimiento derivado.** El grafo de entidades y relaciones, los enlaces a código, tests y commits, las categorías y los resúmenes. No tiene autoridad y se puede reconstruir entero a partir de la autoridad y de las clasificaciones guardadas.

Por eso el clasificador puede actualizar el grafo sin que una persona acepte cada cambio. Si detecta que algo con autoridad ha quedado afectado («esta decisión parece obsoleta»), eso sale como propuesta en la bandeja.

### 7.3 El paso «Actualizar conocimiento»

1. **Disparo.** Cada evento de autoridad: una versión aprobada, un AC modificado, una propuesta aceptada o un Change Set fusionado.
2. **Candidatos (determinista).** Vecinos en el grafo hasta una distancia fija, coincidencias de texto (FTS `spanish`), nodos con las mismas categorías y ficheros tocados. El conjunto está acotado y lleva hash.
3. **Clasificación (Jev, §7.5).** Primero clasifica el artefacto nuevo o modificado según la taxonomía. Después responde, en una sola petición, una Choice por cada par (cambio, candidato): `keep`, `update`, `invalidate`, `add`, `relate` u `other`, con su distribución y su `confidence`. Los veredictos de confianza media pasan a un LLM y los de confianza baja quedan pendientes de la persona. Si un `update` o un `add` necesita texto, lo redacta un LLM en un paso aparte. Todo se guarda con el modelo, la versión y el `input_hash`.
4. **Verificación (determinista).**
   - Cada candidato tiene exactamente un veredicto.
   - Todas las referencias existen.
   - Ningún veredicto cambia directamente algo con autoridad: esos salen como Proposal.
   - Con la misma entrada, el mismo resultado aplicado: los veredictos se guardan por `input_hash` y se reutilizan.
   - Si falla algo, el update queda `rejected` sin efectos y el fallo se registra.
5. **Aplicación.** Una transacción con su evento. La versión del grafo sube. «Borrar» significa invalidar (`valid_to`), nunca borrar físicamente, para conservar la historia.
6. **Gate de frescura.** Ningún Change Set pasa a `in_progress` si la versión del grafo es anterior al último evento de autoridad de su alcance.

### 7.4 Clasificación y taxonomía

| Tipo de categoría | Ejemplos | Quién decide |
|---|---|---|
| **Estructural** | Si es FDR, ADR, AC o test | Nadie clasifica: el tipo viene dado por cómo se creó |
| **Semántica, solo para organizar y recuperar** | Área o módulo del producto · atributo de calidad (seguridad, rendimiento, UX) · tema de una idea · componente al que pertenece un fichero · si un mensaje contiene una idea, una decisión o una duda | El clasificador, directamente. Es conocimiento derivado |
| **Semántica que cambia el flujo** | Si un trabajo es funcionalidad, bugfix o refactor · nivel de riesgo, si decide qué gates se aplican | El clasificador propone y la persona confirma, o una regla determinista decide con datos objetivos |

- La **taxonomía** es cerrada, tiene versiones y la aprueba la persona. Siempre incluye «otra» para no forzar una categoría.
- Cada clasificación lleva confianza y una justificación breve. Por debajo de un umbral, queda pendiente de revisión.
- Cada clasificación guarda el modelo, la versión de la taxonomía y el `input_hash`. Así se sabe qué reclasificar cuando cambia la taxonomía o el artefacto.

### 7.5 Jev: un modelo de decisiones, no de texto

> Fuente: la documentación de TypeSafe AI consultada el 24-09-2026 ([docs.typesafe.ai/llms.txt](https://docs.typesafe.ai/llms.txt), [post de lanzamiento del 15-09-2026](https://typesafe.ai/blog/introducing-system-one-models-and-jev)). Las cifras son las que publica el fabricante. No hay benchmarks independientes.

**Qué es.** Jev (`jev-1.13.0`, alias `jev-latest`) es el primer «System One Model» de TypeSafe AI. Es una clase de modelo nueva hecha para tomar decisiones dentro del software:
- **No genera texto.** Recibe un `state` (texto o JSON) y un conjunto de preguntas tipadas, y devuelve decisiones tipadas con su distribución de probabilidad. Tiene tres primitivas:
  - **Choice:** una opción de un conjunto cerrado, de hasta 255.
  - **Score:** un nivel de una rúbrica ordenada de 2 a 10 niveles.
  - **Noul:** la probabilidad de que un enunciado sea verdadero.
- **Calibrado.** Se entrena con un algoritmo propio (RLCD) para que las probabilidades sean fiables y la `confidence` sirva para enrutar. La calibración es de grupo, no por respuesta individual.
- **Rápido y barato.** Declaran 70–500 ms por petición, 0,042 $ por millón de tokens de entrada y salida gratuita. Todas las preguntas de una petición se resuelven en paralelo.
- **Acceso.** API propietaria alojada en EE. UU. y en early access, con SDK de TypeScript `@typesafe-ai/sdk` 0.6 (MIT). Contexto de 64k tokens (32k para el `state` más la pregunta). No entrenan con datos de cliente. La retención cero solo existe en el plan enterprise.

**Por qué encaja como pieza central del motor de contexto.** Es la pieza que faltaba entre el orquestador determinista y los agentes que generan. DEMIURGO queda con tres niveles:
1. **Orquestador determinista:** decide los avances.
2. **System One (Jev):** muchas decisiones pequeñas, tipadas y calibradas, baratas como para tomarlas en cada evento.
3. **System Two (agentes LLM):** redactar, razonar y escribir código.

Que el precio y la latencia sean casi nulos es lo que permite disparar «Actualizar conocimiento» en **cada** evento de autoridad y evaluar **cada** idea, en lugar de hacerlo por lotes.

**Cómo se usa en la v2** (siempre detrás del puerto `Classifier`):

| Uso | Primitiva | Efecto |
|---|---|---|
| Veredicto por candidato en «Actualizar conocimiento» | Choice `keep\|update\|invalidate\|add\|relate\|other` por cada par (cambio, nodo candidato), todos los pares en una petición | Conocimiento derivado, con verificación determinista (§7.3) |
| Clasificar un artefacto según la taxonomía | Choice por eje (clasificación jerárquica en varias peticiones si hace falta) | Conocimiento derivado |
| Relevancia de un nodo para un context pack | Score (rúbrica de relevancia) | Orden dentro del presupuesto (§7.8) |
| Evaluación de ideas | Choice `relates\|conflicts\|inconsistent\|duplicates\|none` por par (idea, nodo) | Evidencia en la bandeja (§7.7) |
| Chequeo de verificabilidad de un AC | Noul («el enunciado es observable y comprobable») | Aviso en el formulario, nunca un bloqueo |
| Impacto de una pregunta (política de atención de S6) | Score | Qué preguntas se muestran y cuáles se infieren |
| Tipo de trabajo o nivel de riesgo | Choice | **Solo propuesta:** la persona confirma o decide una regla |

**Reglas de uso que salen de sus límites documentados:**
- **No redacta.** Cuando un veredicto es `update` o `add` y hace falta texto (un resumen o una relación con su explicación), lo escribe un LLM (System Two) en un paso aparte. La mayoría de los nodos derivados solo referencian entidades con autoridad y no necesitan texto.
- **Estado pequeño y relevante.** La precisión cae con material irrelevante, así que cada pregunta recibe solo el par que evalúa. La preselección de candidatos es determinista (§7.3) y no se le pasa el grafo.
- **Nada multi-salto en una llamada.** Las preguntas de una petición son independientes. Las decisiones encadenadas («si hay conflicto, ¿cuál sustituye a cuál?») se resuelven en código o en otra petición.
- **Fechas, versiones y precedencia, en código.** Jev trata las fechas como texto. Qué versión sustituye a cuál lo decide la autoridad.
- **Enrutado por confianza, en cascada.** Con confianza alta, el veredicto se aplica al conocimiento derivado. Con confianza media, lo revisa un LLM. Con confianza baja, queda `pending_review` para la persona. Los umbrales se ajustan con datos propios.
- **Inyección.** Las fuentes importadas son entrada no confiable: van delimitadas y Jev nunca tiene la última palabra sobre la autoridad.
- **Idioma.** El soporte fuera del inglés tiene «precisión variable». Hay que medir las preguntas y criterios en español frente a los mismos en inglés.
- **Probabilidades.** P(sí) + P(no) puede no sumar 1, así que se usa una sola formulación por pregunta (Choice mejor que dos Noul).
- **Proveedor.** Es early access, en EE. UU. y con SDK 0.x. El puerto `Classifier` tiene un modelo de referencia (un LLM pequeño con salida estructurada, por ejemplo Haiku 4.5) como alternativa, y enviar el contenido del proyecto a TypeSafe se registra como ADR.

**Qué no se ha podido verificar.** La arquitectura (no la publican), la precisión en tareas como las de DEMIURGO, el rendimiento en español, la latencia desde Europa y las condiciones del early access. Por eso Jev entra con un conjunto de evaluación propio (§7.9) antes de sustituir al modelo de referencia.

### 7.6 Dónde vive el grafo

| Opción | A favor | En contra |
|---|---|---|
| **Tablas de nodos y aristas en Postgres, con CTE recursivas** (recomendada para empezar) | Una sola base, transacciones junto a la autoridad, una sola copia de seguridad y DBOS en el mismo sitio | Consultas de recorrido más largas de escribir. Hay que medir el rendimiento con el tamaño real |
| **Memgraph** (elegida en la visión original) | Cypher, rendimiento en memoria y algoritmos de grafos | Segundo almacén que sincronizar y respaldar. Hay que revisar la edición y la licencia |
| **Apache AGE** | Cypher dentro de Postgres | Extensión con menos adopción. Hay que comprobar que es compatible con PostgreSQL 18 |

**Recomendación.** Empezar en Postgres detrás de `KnowledgeGraph` y pasar a Memgraph o AGE cuando las consultas o el volumen lo justifiquen. Como el grafo se reconstruye desde la autoridad, cambiar de motor es reconstruirlo en el nuevo. El valor está en el paso de actualización, no en el motor.

### 7.7 Evaluación de ideas

- Cada idea o propuesta nueva pasa por el mismo mecanismo: candidatos → clasificador → verificación.
- El resultado es un IdeaAssessment con hallazgos (`relates`, `conflicts`, `inconsistent`, `duplicates`), cada uno con su cita.
- Se muestra en la bandeja junto a la propuesta. Es evidencia para la persona, no una decisión.
- Un conflicto o una incoherencia se convierte en pregunta en S6.

### 7.8 Context packs

- Cada rol (explorar, diseñar, escribir pruebas, implementar, reparar un KO) tiene un constructor puro con un presupuesto por sección.
- El constructor recorre el grafo desde el alcance de la acción y elige los nodos. Cada nodo incluido lleva el motivo.
- El pack guarda la versión del grafo y su hash. El reintento usa el mismo pack (I7).
- Para el código, el agente usa la búsqueda de su propio arnés. El pack le da el conocimiento de producto y los enlaces a los ficheros relevantes.

### 7.9 Evaluación y límites

- **Lo que garantiza lo determinista:** que se ha revisado todo el conjunto de candidatos, que el resultado aplicado es coherente y que nada con autoridad cambia sin la persona.
- **Lo que no garantiza:** que el conjunto de candidatos incluya todo lo afectado. Un falso negativo del clasificador no se detecta en el momento.
- **Cómo se mide y se reduce ese hueco:**
  - un conjunto de evaluación etiquetado, con precisión y cobertura por tipo de veredicto, que crece con cada corrección de la persona;
  - una reconstrucción completa periódica con el clasificador actual, comparada con el grafo incremental: la diferencia mide la deriva;
  - los fallos que señala la persona, que pasan a ser casos de evaluación;
  - el indicador «¿faltó contexto?» de cada run (S5).

---

## 8. Dónde importa la elección de stack

La mayoría de estos puntos quedaron resueltos en `docs/investigacion-stack-2026-09-24.md`. La tabla se conserva como criterios de entrada del ADR de stack.

| Punto | Por qué importa | Estado |
|---|---|---|
| Motor de pasos durable | Condiciona S0, S4 y S5 | Recomendado: máquina de estados propia + DBOS Transact en el mismo Postgres |
| Adaptador de agentes de código | Implementador y agente de pruebas (S3–S4) | Puerto `Executor` con Claude Agent SDK TS y Codex |
| Contrato único de schemas | Tipos de la UI, la API, la validación de salidas y las herramientas MCP | Zod 4 → OpenAPI |
| Tipos de estado y tests de propiedades | Invariantes I1–I3 y I10 | Uniones discriminadas y fast-check |
| Runner y contenedores en Windows | S0 y S4 son las piezas más frágiles | Broker propio con contenedores endurecidos; plan de contingencia en WSL2 |
| Persistencia | Diario append-only, UI incremental y grafo | PostgreSQL 18 con triggers que impiden UPDATE y DELETE |
| Grafo de conocimiento | S2 y S7 | Tablas en Postgres detrás de `KnowledgeGraph`; Memgraph o AGE si se justifica (§7.6) |
| Clasificador | S2 | Puerto `Classifier` con Jev (`@typesafe-ai/sdk`) y un LLM pequeño con salida estructurada como referencia; elección por eval (§7.5) |
| UI incremental | Evitar el sondeo de estado | SSE sobre el log de eventos |
| E2E | Protegen cada incremento | Playwright |
| JUnit e ID del AC en el nombre del test | Gates G4 y autoalojamiento (H2) | Reporter JUnit de Vitest |
| Plantilla de las apps generadas | S3 y S8 | Decisión aparte: React Router 8 frente a Next.js, con evaluaciones propias |
| Empaquetado | Instancia estable y runner | Imágenes OCI con usuario no root |
| MCP | Canal de agentes (S1) | DEMIURGO como servidor MCP con el SDK 2.x |

---

## 9. Riesgos principales y mitigación

| Riesgo | Mitigación |
|---|---|
| **S3 y S4 concentran lo más difícil** (git, sandbox, runner en Windows, agente con escritura) y pueden pasar semanas sin nada que enseñar | Spike del runner en D0, simulador primero, una plantilla y una tarea. Runner por subproceso restringido antes que contenedor hermano. Límite de tiempo y MVP de repliegue |
| **Falsa confianza del simulador**: los agentes reales casi nunca pasan los gates o cuestan demasiado | Una ejecución real registrada en cada incremento, con su tasa de gates en rojo |
| **Oráculo**: una prueba débil da verde sobre un AC incumplido | Rojo antes de verde, congelado por hash, la persona acepta el mapa AC → comprobación, y capturas en S8. Mutación en S10. Se declara lo que no se ha comprobado |
| **Autocertificación y circularidad** en el autoalojamiento | Gates y pruebas cargados desde la release en ejecución; construye la release anterior; clon separado; rutas protegidas; CI del repo como segunda barrera; agentes externos como respaldo. La evidencia retroactiva se rotula y no cuenta |
| **Un agente suplanta a la persona** | La credencial humana (cookie httpOnly) queda fuera del alcance de los agentes. Token por agente con lista de permitidos. Antes de H1, rama protegida y merge solo humano |
| **Doble fuente de verdad** entre D0 y H1 | Una sola autoridad de diseño en cada momento. Tras H1, `design/` es una exportación y la CI falla si se edita a mano |
| **El diseño en Markdown se queda corto** antes de que exista la aplicación | Validador de formato en la CI, diseño justo a tiempo (solo S0–S2) y H1 lo antes posible |
| **El clasificador omite conocimiento afectado** (falsos negativos) | Conjunto de evaluación con cobertura medida, reconstrucción periódica comparada con el grafo, fallos señalados por la persona convertidos en casos y el indicador «¿faltó contexto?» (§7.9) |
| **El grafo deriva respecto a la autoridad** | Proyección reconstruible, huella comparada y gate de frescura |
| **Taxonomía mal diseñada o inestable** | Taxonomía con versiones y aprobada por la persona, categoría «otra» y reclasificación por `input_hash` |
| **Dependencia de un modelo recién publicado** (Jev: early access, API propietaria en EE. UU., SDK 0.x, inglés como idioma principal) | Puerto `Classifier` con un modelo de referencia, evaluación propia en español antes de adoptarlo y ADR sobre el envío del contenido del proyecto a TypeSafe |
| **Inyección en el `state` del clasificador** desde fuentes importadas | Fuentes delimitadas como no confiables, verificación determinista y ningún efecto sobre la autoridad |
| **Fatiga de aprobaciones o aprobar sin leer** | Un paso para los paquetes del sistema; elemento a elemento y máximo 10 para agentes externos. El conocimiento derivado no pide aprobación. Umbral de atención en el gate de S8 |
| **Cuota y coste** de los bucles de 3 intentos con agentes reales | Simulador en la CI, ejecuciones reales bajo demanda, presupuesto por Change Set como parada dura y un presupuesto global con proveedor alternativo |
| **Pruebas inestables y fallos del host** confundidos con fallos del agente | Repetición determinista antes del veredicto, `failure_kind` propio para infraestructura e inestabilidad, y la cuarentena como decisión humana auditada |
| **El stack sin decidir bloquea S0** | ADR de stack como condición de entrada, con los criterios de §8 |
| **Retrabajo del núcleo** al llegar a S7 | Modelo completo desde S0, pausa como invariante desde S5 y eventos para reproyectar |
