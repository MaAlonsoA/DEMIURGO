# Informe: DEMIURGO frente a la nueva visión (MVP con Pilar 1 y Pilar 2)

> Las rutas son relativas a `D:\Dev\Demiurgo`. Cuando digo «el código hace», está comprobado en el código o con `python -m pytest -q`, que da 18 pruebas superadas. Cuando digo «el documento dice», es lo que afirman los textos del repositorio. Los porcentajes son estimaciones, no medidas.

---

## 1. Veredicto

1. DEMIURGO es hoy un copiloto de exploración que además registra decisiones y diseños. El ciclo se corta en Diseño: las pestañas Implementación y Revisión solo muestran un texto provisional (`frontend/src/App.tsx:210`).
2. **Pilar 1 (algo más de la mitad del recorrido básico).**
   - La Exploración está bien resuelta. La conversación se convierte en preguntas con hilos aislados. El agente solo llega a «inferido» y confirma una persona. Toda salida de la IA es una propuesta que una persona acepta. Hay controles deterministas para las salidas que llegan obsoletas.
   - El paso a Decisión es débil. Se pueden confirmar acuerdos vacíos, no se puede corregir, descartar ni reabrir una tarjeta, y una heurística de palabras clave marca propuestas como «aceptadas».
   - El paso a Diseño está en esbozo. El FDR/ADR se escribe a mano en un textarea, los criterios de aceptación (AC) solo existen por API y no hay ninguna definición de «listo para construir».
3. **Pilar 2 (alrededor del 10 %).** Solo hay esquema y reglas por API: AC ligados a una versión, tareas, Change Sets, evidencias y dos gates en SQL. Esos gates evalúan datos que cualquier llamada puede declarar y tienen agujeros comprobados. Por ejemplo, un resultado verificado se puede «desverificar» y una evidencia fallida posterior no bloquea. No hay repositorio del producto, agente implementador, orquestador, pruebas ejecutadas por el sistema ni interfaz.
4. **Capacidades transversales.** Existe un buen registro por ejecución: tokens, fases y spans OTel. El contexto no se selecciona por relevancia, el reintento arma un contexto distinto del envío original, no hay agregados de consumo y no se aprende de ejecuciones anteriores.
5. **Estado de ingeniería.** El repositorio no tiene ningún commit, así que la CI y el gate de release nunca se han ejecutado. Los tres E2E recorren una interfaz que ya no existe. En 2 de cada 3 ejecuciones, pytest deja hilos que escriben en el `demiurgo.db` de la raíz.
6. **Documentación.** AGENTS.md, VISION.md, README, el prompt v6 (que se envía al modelo en cada ejecución) y la propia interfaz siguen diciendo que el MVP termina en Diseño. Contradicen directamente la nueva visión.
7. **Qué se puede aprovechar.** La base sirve para construir encima: el flujo de propuestas, el registro de ejecuciones, los perfiles por acción, la traza de tareas y el esquema de trabajo. Para el Pilar 2 casi todo lo ejecutable es nuevo.

---

## 2. Cobertura de la visión

| Afirmación de la nueva visión | Estado | Evidencia principal |
|---|---|---|
| Transformar una idea en una aplicación de calidad de producción sin programar | Parcial (solo diseño) | `frontend/src/App.tsx:210`. Codex solo corre en modo de solo lectura: `app/codex.py:147` |
| El usuario gobierna: decide lo relevante | Parcial | Propuestas con aceptación humana en `app/main.py:684-718`. La interfaz no deja corregir, descartar ni reabrir tarjetas: `frontend/src/App.tsx:226` |
| El usuario evalúa los resultados | Ausente | `verify_result` solo por API: `app/main.py:623-638` |
| DEMIURGO explora el problema | Completo | `app/codex.py:385-394`, `tests/test_journey.py:234-287` |
| Estructura el conocimiento | Parcial | `project_state.facts` no incluye AC, links, observaciones ni propósitos: `app/project_state.py:8-22` |
| Detecta cuestiones que hay que resolver | Parcial | Hay preguntas. Los conflictos con decisiones vigentes solo existen como instrucción de prompt: `.demiurgo/agents/exploration/v6.md:17` |
| Prepara propuestas | Parcial | El chat principal puede proponer decisiones, FDR y ADR (`app/codex.py:377,383`). v6 lo desaconseja (`v6.md:7`). Ningún agente propone AC, tareas ni Change Sets |
| Ejecuta el trabajo técnico | Ausente | Directorio temporal vacío y solo lectura: `app/codex.py:141-147` |
| Verifica los resultados | Ausente | La evidencia es texto declarado: `app/main.py:640-651` |
| Aporta evidencias de qué se hizo y por qué | Esbozo (solo API) | Traza de tarea: `app/main.py:727-744`, sin interfaz |
| La calidad no depende de la disciplina del usuario (prompts, contexto, documentación) | Parcial | El contexto se inyecta solo (`app/codex.py:333-343`), pero diseño y AC son manuales: `frontend/src/Artifacts.tsx:81` |
| Sistema guiado, persistente, trazable | Parcial | Persistente y trazable en el backend. Guiado solo en Exploración |
| El proceso que coordina los modelos no es probabilístico | Parcial | Huella, obsolescencia y validación: `app/codex.py:330-370`. No hay orquestación entre etapas; son hilos daemon: `app/codex.py:51` |
| Saber qué se intenta resolver | Parcial | Las exploraciones no tienen estado. El propósito solo vive en `audit_events`: `app/main.py:302` |
| Saber qué está confirmado y qué es propuesta | Casi completo | Estados «inferred»/«confirmed» y propuestas «pending». Excepción: autoaceptación en `app/project_state.py:53` |
| Saber qué está pendiente | Parcial | La vista del proyecto lista, pero no señala huecos: `frontend/src/ProjectOverview.tsx:61-72` |
| Saber qué trabajo se hace, de qué decisión procede y con qué evidencia | Esbozo | `app/main.py:727-744` (solo API). Las tablas de trabajo no tienen `project_id`: `migrations/versions/0001_initial.py:21-27` |
| Revisar decisiones sin perder la historia | Parcial | Revisiones inmutables (`app/domain.py:103-120`) sin propagación de impacto |
| Ciclo Exploración → … → Revisión → nueva exploración | Parcial | Se vuelve a explorar desde un artefacto o una tarjeta (`app/main.py:297-302`). Implementación y Revisión son marcadores de posición |
| Pilar 1: método estable | Parcial | v1–v6 versionados. Los prompts de fuentes, síntesis y ronda están incrustados en el código: `app/codex.py:99-101,295,425` |
| Comprender el estado y el motivo sin leer conversaciones | Parcial | Vista del proyecto y síntesis versionada (`app/main.py:53-73`). La interfaz no envía el origen: `frontend/src/Artifacts.tsx:53,56` |
| Proteger la atención y resolver solo lo que no requiere a la persona | Esbozo | Toda tarjeta pide confirmación, sin tope de preguntas. Hay hasta 3 síntesis por ronda con IDs crudos: `app/domain.py:215,244-245` |
| Pilar 2: implementación por agentes especializados | Ausente | `.demiurgo/agents` solo contiene `exploration/` |
| Orquestación determinista: el sistema controla estados, contexto y avance | Ausente | Change Set con 3 estados y sin guardas: `app/domain.py:176-183` |
| Hard gates ante pruebas fallidas, AC incumplidos o calidad insuficiente | Esbozo | `app/main.py:634`: basta con que exista algún «passed» y se ignoran los «failed» |
| Software coherente, verificable, mantenible y seguro | Ausente | Nada ejecuta pruebas ni analiza código |
| Contexto relevante por agente | Parcial | Constructores por acción, sin selección. El reintento difiere del envío: `app/main.py:410-414` frente a `app/main.py:423` |
| Observar el proceso | Parcial | `ai_runs`, `ai_events` y spans (`app/observability.py:22-65`). No se vinculan a tareas ni Change Sets: `migrations/versions/0009_ai_runs.py:12-14` |
| Tokens, compute, tiempo, reintentos y fallos | Parcial | Datos por ejecución (`app/observability.py:68-108`). Sin agregados ni tipo de fallo |
| Selección dinámica de modelos y herramientas | Esbozo | Perfiles estáticos por acción: `app/ai_config.py:74-87` |
| Aprender de ejecuciones anteriores | Ausente | Los lotes no guardan `run_id` (`migrations/versions/0001_initial.py:28`). No hay evaluaciones (`docs/evaluations/` solo tiene TEMPLATE.md) |
| No confundir la afirmación de un modelo con evidencia | Pilar 1 casi completo; Pilar 2 ausente | Pilar 1: `app/codex.py:395-401`. Pilar 2: `app/main.py:640-651` |
| Trazabilidad sin burocracia | En riesgo | Reglas rígidas sin asistencia del agente: `app/domain.py:91-93,147-148,180-181` |
| Ambas etapas terminadas en versión básica para el MVP | No | Ver Pilar 2 |

---

## 3. Brechas bloqueantes para el MVP

### Pilar 1: el diseño tiene que poder alimentar la construcción

**B1-1. No hay un paso de diseño guiado. El FDR/ADR se escribe a mano.**
- Qué hace el código: el chat principal puede proponer FDR/ADR (`app/codex.py:377`) y esas propuestas llegan a Artifacts (`tests/test_journey.py:199-231`).
- Qué falta: el método v6 dice «No fuerces decisiones, FDR, ADR» (`v6.md:7`), las propuestas no traen `decision_id` ni AC, y los hilos de tarjeta y la revisión de ronda solo pueden proponer exploraciones (`app/codex.py:378,430`).
- Solución mínima:
  - Crear la acción `design_proposal` en `ACTION_DEFINITIONS` (`app/ai_config.py:15-22`), con su método en `.demiurgo/agents/design/v1.md` y un schema propio `{fdr|adr, decision_id, body por secciones, criteria[{texto observable, cómo se comprueba}]}`.
  - Lanzarla con el botón «Proponer diseño» sobre una decisión aprobada.
  - Reutilizar `proposal_batches`, el panel «Propuestas pendientes» de `Artifacts.tsx` y `resolve_batch`, que al aceptar crearía el registro y sus AC.

**B1-2. Los AC canónicos no existen en la interfaz y su versión se desancla.**
- Qué hace el código: la tabla `criteria` existe (`app/domain.py:135-144`), pero la interfaz ni los crea ni los muestra, y el formulario pide escribirlos en prosa (`frontend/src/Artifacts.tsx:81`).
- Primer problema: aprobar un borrador obliga a crear una versión nueva (`d.revise` siempre hace v+1, `app/domain.py:103-120`; la interfaz aprueba por revisión, `Artifacts.tsx:53`). Así, los AC y los links `design_of` creados sobre v1 quedan anclados a un borrador.
- Segundo problema: `GET /api/records/{id}` mezcla los criterios de todas las versiones (`app/main.py:485`).
- Solución mínima:
  - Nuevo `PATCH /api/records/{id}/revisions/{v}/status` que aprueba la versión existente, con motivo y auditoría, sin crear v+1.
  - En el detalle del FDR/ADR, listar y añadir los AC de la versión vigente mediante `POST /api/criteria`, con el aviso «sin AC».
  - Al revisar un registro, pedir a la persona que conserve, modifique o descarte los AC de la versión anterior.

**B1-3. No hay contrato «listo para construir» entre el Pilar 1 y el Pilar 2.**
- Qué hace el código: `accept_scope` no comprueba que la revisión esté aprobada y vigente, ni que falten links en `needs_update` (`app/domain.py:176-183`). Además, `tests/test_journey.py:64-70` acepta un alcance sobre un FDR en borrador sin decisión.
- Solución mínima: una función pura `readiness(record_id)` que exija:
  - una decisión aprobada;
  - la versión aprobada y vigente del FDR/ADR con al menos un AC;
  - ningún link en `needs_update`;
  - ninguna tarjeta pendiente o pospuesta enlazada.

  Para calcularla hay que ampliar `project_state.facts` con AC, links y `review_status`. Se mostraría como la etiqueta «Listo para construir» y sería la precondición del Pilar 2.

**B1-4. El gobierno humano de las tarjetas está incompleto en la interfaz.**
- Qué falla:
  - Solo existen Confirmar/Posponer y «Confirmar inferencia» (`frontend/src/App.tsx:226`).
  - Se puede confirmar sin conclusión, porque `app/main.py:443-454` lo acepta.
  - No hay forma de corregir, descartar ni reabrir una tarjeta.
  - Una tarjeta pospuesta no tiene ninguna salida, porque el agente solo actúa sobre pending/inferred (`app/codex.py:397`).
- Solución mínima: campo de conclusión editable y acciones Confirmar (con conclusión obligatoria), Posponer, Retomar, Descartar con motivo y Reabrir, todas con el `PATCH /api/cards` existente. En el backend, rechazar `confirmed` con la conclusión vacía.

### Pilar 2: ejecución gobernada (todo es nuevo salvo lo indicado)

**B2-1. No hay espacio de trabajo del producto.**
- Qué falta: ningún proyecto tiene repositorio. Los agentes corren en un directorio temporal vacío (`app/codex.py:141-142`) y la imagen no incluye git (`Dockerfile:18-21`).
- Solución mínima: tabla `workspaces(project_id, path, default_branch, test_command, stack)`. Repositorio git en `DEMIURGO_DATA_DIR/workspaces/<project_id>`, separado de la base de datos, con una rama o worktree por Change Set. Añadir git a la imagen.

**B2-2. No hay agente implementador.**
- Qué falta: `_invoke_codex` está fijado a solo lectura, un schema de exploración y un límite de 120 o 240 s según el nombre del modelo (`app/codex.py:147,159`). Qwen no dispone de herramientas (`app/codex.py:200-259`).
- Solución mínima: parametrizar `_invoke_codex` (cwd = worktree, sandbox `workspace-write`, schema y límite de tiempo por acción). Añadir la acción `implementation` con `.demiurgo/agents/implementation/v1.md` y un schema `{summary, files_changed[], open_issues[]}`. Su salida se guarda solo como afirmación en `ai_runs.result_json`. En el MVP, solo Codex.

**B2-3. No hay orquestador determinista y las transiciones actuales no tienen guardas.**
- Qué falla: el Change Set solo tiene draft → scope_accepted → result_verified. `accept_scope` no comprueba el estado de origen, así que devuelve un Change Set verificado a `scope_accepted` (comprobado con TestClient). La tarea pasa a «done» con un PATCH libre (`app/main.py:563-576`).
- Solución mínima:
  - `app/orchestrator.py` con una tabla explícita de transiciones y respuesta 409 fuera de ella.
  - Tabla `work_steps(changeset_id, task_id, step, status, attempt, run_id, detail)`.
  - Un único worker que procesa las tareas en serie y reanuda los pasos al arrancar, en lugar de marcarlos como `interrupted` (`app/main.py:26`).
  - Solo el orquestador puede poner «done» una tarea ejecutada por agentes.

**B2-4. No hay hard gates ejecutados por el sistema.**
- Qué falta: nada ejecuta pruebas. `verify_result` solo mira filas declaradas (`app/main.py:632-635`).
- Solución mínima: tras cada ejecución del implementador, el backend (no el agente) comprueba:
  1. que el diff no está vacío y queda dentro del worktree;
  2. que los tests de aceptación congelados siguen intactos (hash);
  3. que `test_command` termina con código 0;
  4. que cada AC tiene su test en verde, según el JUnit XML.

  Si algo falla, la tarea vuelve al implementador con el log como contexto. Tras N=3 intentos queda `blocked` y se escala a la persona.

**B2-5. La evidencia no distingue afirmación de comprobación.**
- Qué falla: la evidencia no registra quién la produjo, no enlaza commit ni ejecución, y `verify_result` acepta cualquier «passed» aunque exista un «failed» posterior (`app/main.py:634`).
- Solución mínima: añadir a `evidence` las columnas `producer` (system_gate|human), `gate`, `run_id`, `changeset_id`, `commit_sha` y `artifact` (extracto de log o JUnit). `verify_result` exige que la última evidencia de cada AC sobre el SHA sea «passed» y venga de `system_gate`, o de `human` solo si el AC se marcó como manual al planificar. Las afirmaciones de los agentes nunca cuentan.

**B2-6. No hay contexto para implementar.**
- Qué falta: `facts` no incluye AC, tareas ni links (`app/project_state.py:8-22`).
- Solución mínima: `implementation_context(task_id)` a partir de la lógica de `trace` (`app/main.py:727-744`). Incluye la tarea, sus AC con el cuerpo de la versión exacta, la decisión y el ADR aprobados enlazados, las convenciones del workspace y los fallos de gates anteriores.

**B2-7. No hay interfaz de Implementación ni de Revisión con aceptación humana.**
- Qué falta: toda la cadena AC → tarea → Change Set → evidencia es solo API (UX-M11, `docs/revision-ux-2026-09-24.md:87`).
- Solución mínima: las vistas de la sección 5, reutilizando `GET /api/changesets/{id}` (`app/main.py:616-621`) y el cajón de ejecuciones.

**B2-8. Aislamiento del código generado.**
- Qué falla: el backend corre como root (el `Dockerfile` no declara `USER`). En el mismo contenedor están montados `/data` (todas las bases) y `/codex` (credenciales) (`compose.yaml:13-15`). El sandbox de solo lectura impide escribir, no leer. Solo se eliminan del entorno las variables `DEMIURGO_*` (`app/codex.py:144`).
- Solución mínima: los tests se ejecutan en un subproceso con entorno mínimo (sin `CODEX_HOME` ni `DEMIURGO_DB`), cwd = worktree y límite de tiempo, idealmente en un contenedor runner hermano sin `/data`. Añadir un usuario no root.

### Ingeniería (bloquea poder declarar «terminado»)

**B0-1. No hay línea base verificable.**
- Qué falla: el repositorio no tiene commits y el remoto `origin` está vacío (`git ls-remote` no devuelve referencias). La CI nunca se ha ejecutado. La imagen estable se construyó desde un árbol sin commit, así que no se puede identificar qué código ejecuta.
- Además, los E2E buscan textos que no existen: «El diseño empieza con una conversación.» en `frontend/e2e.mjs:50-51`, «Enviar mensaje» en `:70` (el botón actual es «Enviar», `ConversationPane.tsx:45`) y «Aplicar revisión del lote» en `e2e-codex.mjs:51`. Por tanto, `.github/workflows/ci.yml:37-41,60-65` fallaría.
- Solución mínima: commit inicial y push. Reescribir `e2e.mjs` sobre la interfaz actual, sin Codex. Registrar una evaluación en `docs/evaluations/`.

---

## 4. Brechas importantes (no bloqueantes)

| ID | Brecha | Evidencia | Solución mínima |
|---|---|---|---|
| P1-G5 / Q-R8 | Una heurística léxica crea borradores de decisión y marca propuestas del agente como «accepted». Se ejecuta en cada arranque | `app/project_state.py:42-58`, `app/main.py:27-28` | Botón «Registrar como decisión» con `origin_type='card'`. La propuesta afectada pasa a `superseded`. Quitar el backfill del arranque |
| P1-G6 / Q-B7 | Revisar una decisión no marca los diseños ni los links dependientes | `app/domain.py:103-120` | En `revise()`, poner `needs_update` a los links de la versión anterior. Mostrar «Basado en X v1 · vigente v2» con enlace |
| P1-G7 | No se detectan conflictos con decisiones vigentes | `v6.md:17`, `VISION.md:101` | `conflicts[]` en el schema → tarjeta pendiente con link `conflicts_with` |
| P1-G8 | Los registros no tienen estructura mínima | `migrations/versions/0001_initial.py:18-19` | Plantillas Markdown por tipo con secciones obligatorias validadas en el backend |
| P1-G9 | La atención no se protege: todas las preguntas pasan a tarjetas y hay 3 síntesis por ronda con IDs crudos | `app/codex.py:385-391,450`, `app/domain.py:215,244-245` | Tope de preguntas y campo de impacto. Un único mensaje de integración con nombres legibles |
| P1-G10 | No hay «qué falta ni cuál es el siguiente paso» | `frontend/src/ProjectOverview.tsx:61-72` | Bloque «Pendiente de ti» calculado con readiness, con contadores en la barra lateral |
| P1-G11 / Q-M3 | Hay propuestas invisibles (tipo card, fuentes) y registros sin exploración que quedan fuera de `facts` | `frontend/src/App.tsx:75,79`, `app/main.py:712`, `app/project_state.py:14` | `exploration_id` obligatorio. Una sola bandeja de propuestas por proyecto |
| P1-G12 / P1-X3 | Un diseño solo puede apoyarse en una decisión de su exploración, aunque sea un borrador. La interfaz preselecciona `decisions[0]` | `app/domain.py:90-93`, `frontend/src/Artifacts.tsx:70,78` | Admitir decisiones aprobadas del proyecto y sus ancestros. Exigir que estén aprobadas. No preseleccionar |
| P1-G14 | Las exploraciones no tienen ciclo de vida (activa, concluida, apartada) | `migrations/versions/0001_initial.py:15` | Columnas `status` y `reason` en una migración |
| P1-X1 | Las observaciones claim/hypothesis/unknown se pierden fuera de las rondas con preguntas | `app/codex.py:385-394` | Persistirlas por mensaje, incluirlas en `facts` y mostrar «Hipótesis e incógnitas» |
| P1-X8 | No hay vista de relaciones: los links solo aparecen como «Basado en» | `frontend/src/Artifacts.tsx:66,81` | Sección «Relaciones» con `review_status` y un catálogo cerrado de tipos |
| Q-B8 | Un v2 en borrador oculta el v1 aprobado en la interfaz y en `design_records` | `app/main.py:51,414` | Calcular `approved_revision` junto a `current_revision` |
| TC-CTX-02 / Q-R7 | El reintento arma otro contexto (sin `project_knowledge` ni `exploration`) | `app/main.py:410-414` frente a `:423` | Un único `build_message_context()` y un test que compare envío y reintento |
| TC-CTX-03 | La revisión de ronda no recibe `project_state` aunque v6 lo da por presente | `app/domain.py:62-69`, `v6.md:21` | Añadir `project_state` filtrado y la síntesis a su contexto y a su huella |
| TC-CTX-04 | El contexto crece sin límite y la huella global relanza llamadas por cambios que el agente ni ve | `app/project_state.py:8-22`, `app/codex.py:330-348` | Subconjunto de hechos declarado por acción y huella calculada solo sobre él |
| TC-MISS-01 | El agente no recibe el propósito de la línea ni el mensaje que originó la tarjeta, aunque la interfaz los muestra | `app/main.py:321-339` frente a `:410` | Llevar `exploration_context()` al constructor de contexto único |
| Q-B6 / P2-M2 / Q-M2 | No hay actor. El cliente declara `approved` y `origin_type` | `app/domain.py:26-27,83-89` | Columna `actor` (human, agent:<run>, system) que fija el servidor según la ruta |
| TC-KNOW-04/05 | La edición de propuestas no se audita y las propuestas no se vinculan a la ejecución que las generó | `app/main.py:672-682`, `migrations/.../0001_initial.py:28` | Auditar con el payload anterior. `run_id` en `proposal_batches` |
| P2-G7 | No hay agente revisor | `app/ai_config.py:15-22` | Acción `code_review` informativa, después del MVP básico |
| P2-G12 | No hay estado de realización por versión (sin implementar, en curso, verificado) | `app/domain.py:141` | Calcularlo con una consulta a partir de los Change Sets y la evidencia |
| P2-G14 | Tareas y Change Sets sin `project_id`; `/api/state` es global | `app/main.py:51` | Migración con backfill a través de criteria → records → explorations |
| P2-M4 | No hay resultado tangible para una persona no técnica | `migrations/versions/0004_...:14-15` | Capturas del recorrido con Playwright (`playwright-core` ya es dependencia) como artefacto de la evidencia |
| P2-M6 | No hay comprobación de conjunto del Change Set | `migrations/.../0001_initial.py:27` (`criterion_id NOT NULL`) | Evidencia con `changeset_id` para la suite completa sobre el SHA final |
| P2-M8 | Las copias de seguridad solo cubren SQLite | `app/main.py:765-769`, `app/restore.py:7-15` | Un `git bundle` por proyecto junto al `.db` |
| TC-OBS-04 | No hay tipo de fallo legible por máquina | `app/codex.py:117,323,412,458` | Columna `failure_kind` enumerada |
| TC-MET-02 | No hay agregados de tokens, tiempo e intentos por proyecto o Change Set | `app/main.py:76` | Consulta `GROUP BY` sobre `ai_runs` |
| TC-DOC-02 | La validación de salidas es distinta por función y solo es estricta con Codex | `app/codex.py:205,298-302,350-354,428-430` | Validación común con jsonschema para cualquier proveedor |
| P1-R4 | Siguen abiertos defectos UX P0: no hay botón de cancelar, los estados aparecen en inglés, los diálogos no responden a Escape | `frontend/src/ConversationPane.tsx:38`, `app/codex.py:121-129` | Corregirlos junto con la vista Trabajo |

---

## 5. Propuesta de alcance mínimo del Pilar 2

### 5.1 Recorrido que vería el usuario

1. **Diseño listo.** Un FDR en versión aprobada, con sus AC, lleva la etiqueta «Listo para construir» (gate de entrada B1-3). Si no la tiene, la etiqueta explica qué falta.
2. **Preparar implementación.** DEMIURGO propone un Change Set con:
   - el resultado esperado;
   - los AC incluidos (todos los de esa versión);
   - las tareas que los cubren;
   - para cada AC, una comprobación descrita en lenguaje de producto.

   La persona acepta o corrige el paquete **en un solo paso** con `resolve_batch`.
3. **Aceptar alcance y ejecutar.** Es una acción humana auditada. El Change Set pasa a `in_progress`.
4. **Ejecución visible.** Por cada tarea se ve el paso actual (implementando → comprobando → superada / reintento n de 3 / bloqueada), el tiempo, los tokens y los intentos. Una tarea bloqueada ofrece «Reintentar», «Aclarar» (responder a la pregunta del agente) y «Abrir exploración desde aquí».
5. **Revisión.** Cuando todas las tareas pasan y la comprobación de conjunto está en verde sobre el commit final, el Change Set pasa a `in_review`. La vista Revisión muestra:
   - cada AC en lenguaje de producto, con su estado y su evidencia de sistema (test, log y SHA);
   - el resumen de archivos cambiados;
   - las ejecuciones con su consumo;
   - el resumen del agente, marcado como **«Afirmación del agente, no es evidencia»**.
6. **Decisión humana.**
   - «Aceptar resultado» pasa el Change Set a `accepted` y marca el FDR vN como «verificado».
   - «Pedir cambios» reabre la tarea con el comentario como contexto.
   - «Abrir exploración desde aquí» crea una línea nueva cuyo origen es el Change Set, la tarea o la evidencia.

### 5.2 Piezas técnicas

| Pieza | Imprescindible en el MVP | Reutiliza | Nuevo |
|---|---|---|---|
| Workspace del producto | Repo git por proyecto con una rama por Change Set, creado desde una **plantilla de stack** que incluye andamiaje, arnés de pruebas y `test_command` conocido. El sistema lo crea de forma determinista, sin agente | — | Tabla `workspaces`, git en la imagen, plantillas |
| Modelo de trabajo | `project_id` en tasks y changesets. Estados del Change Set: draft → scope_accepted → in_progress → in_review → accepted, más `blocked`. Estados de tarea: open → implementing → checking → passed \| blocked | Tablas `criteria`/`tasks`/`changesets`/`evidence` y reglas de inmutabilidad (`app/main.py:551-553,570-573`) | Migración, tabla de transiciones con 409 |
| Orquestador | Worker único por workspace, pasos persistidos, reanudación al arrancar, N=3 reintentos y escalado | Cancelación y watchdog (`app/codex.py:121-129,157-161`), patrón de huella y obsolescencia | `app/orchestrator.py`, `work_steps` |
| Agente de comprobaciones | Ejecución previa e independiente que escribe **solo** `tests/acceptance/`, un test por AC con su ID en el nombre. El sistema congela esos ficheros por hash al aceptar el alcance | `_invoke_codex` parametrizado, perfiles por acción | Acción `acceptance_tests` y su método |
| Agente implementador | Codex con `workspace-write` en el worktree, con contexto `implementation_context(task_id)` y límite de tiempo por acción | Registro de ejecuciones y `summarize_events`, que ya cuenta `file_change` y `command_execution` (`app/observability.py:89-92`) | Acción `implementation`, método y schema |
| Hard gates | Diff dentro del worktree, tests congelados intactos, `test_command` con código 0, cada AC con su test en verde, suite completa sobre el SHA final. Reglas versionadas con `GATES_VERSION` | `verify_result` como gate final, endurecido | Ejecutor de gates en un subproceso aislado |
| Evidencia | `producer`, `gate`, `run_id`, `changeset_id`, `commit_sha`, `artifact`. Cuenta la última evidencia por AC y SHA | Tabla `evidence`, `GET /api/criteria/{id}/evidence` | Migración |
| Actor | `actor` en `audit_events`: la interfaz marca `human`, el orquestador `system`, el agente `agent:<run>` | `audit()` (`app/domain.py:26-27`) | Migración |
| Observabilidad | `task_id`, `changeset_id` y `step` en `ai_runs`. Suma por Change Set | `ai_runs`, `ai_spans`, `Runs.tsx` | Migración y consulta |
| Desviaciones | `open_issues` del implementador → propuesta (card o exploration) enlazada a la tarea, y la tarea queda `blocked` | Flujo de propuestas | Enlace tarea ↔ propuesta |
| Vuelta a exploración | Una exploración puede tener como origen un Change Set, una tarea o una evidencia | `origin_record_id`, `/context` (`app/main.py:315-355`) | Tipo de origen nuevo |
| Interfaz | Pestañas Implementación y Revisión según 5.1, en español y con roles accesibles para el E2E | Endpoints existentes (`app/main.py:539-655`), cajón de ejecuciones | Componentes nuevos |
| Aislamiento | Tests sin credenciales ni base de datos, con usuario no root y límite de tiempo | Filtrado de variables de entorno (`app/codex.py:144`) | Runner (subproceso o contenedor hermano) |

### 5.3 Qué puede esperar

- Agente revisor (primero informativo; bloqueante más adelante).
- Agente de planificación que divida el trabajo en muchas tareas. En el MVP basta con que el paquete lo proponga el agente de diseño o comprobaciones, o una tarea por FDR.
- Qwen como implementador.
- Selección dinámica de modelos y aprendizaje automático.
- Coste monetario.
- Capturas o preview del resultado (recomendado como primera ampliación si el stack es web).
- Lint y análisis de seguridad como gates.
- Varios stacks.
- Push, PR y despliegue.

---

## 6. Decisiones que corresponden al usuario

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| 1 | ¿Evolucionar este código o reimplementarlo («antes de reimplementarlo», `AGENTS.md:3`)? | a) Evolucionar. b) Reimplementar con arquitectura limpia | **a)**. El flujo de propuestas, el registro de ejecuciones y el esquema de trabajo son reutilizables. Extraer routers de `main.py` a medida que se añada el Pilar 2 |
| 2 | ¿Qué aplicaciones construye el MVP? | a) Un stack de referencia. b) Varios. c) Cualquier repo con `test_command` | **a)**, con `test_command` configurable para ampliar después. Hace deterministas los gates y la plantilla base |
| 3 | ¿Dónde vive el código del producto? | a) Repo local gestionado por DEMIURGO. b) Ruta aportada por la persona. c) GitHub | **a)**. Push y PR fuera del MVP |
| 4 | Nivel de aislamiento para ejecutar código generado | a) Subproceso restringido en el mismo contenedor. b) Contenedor runner sin `/data` | **b)** para los tests. Como mínimo, a) con usuario no root y entorno vacío |
| 5 | ¿Qué cuenta como evidencia para el gate? | a) Solo comprobaciones del sistema. b) Además, comprobación humana en AC marcados como manuales. c) También autoevaluación de un agente | **b)**. Nunca c) |
| 6 | ¿Quién escribe los tests de aceptación? | a) El implementador. b) Un paso previo separado, aceptado y congelado. c) La persona | **b)**. a) es autocertificación |
| 7 | Autonomía del orquestador | a) Aprobar cada tarea. b) Ejecutar el Change Set entero y escalar solo bloqueos | **b)**, con N=3 reintentos. La persona interviene al aceptar el alcance y al aceptar el resultado |
| 8 | ¿Agente revisor en el MVP? | a) Bloqueante. b) Informativo. c) No | **c)** en la primera entrega y **b)** en la siguiente. La revisión humana se apoya en la evidencia del sistema |
| 9 | ¿Cómo se generan los AC, las tareas y el Change Set? | a) A mano en la interfaz. b) Propuestos por un agente con aceptación en lote | **b)**. El usuario objetivo no programa |
| 10 | Proveedor del implementador | a) Solo Codex CLI. b) Construir un bucle agentic para Qwen | **a)** |
| 11 | Estados del Change Set | a) Los actuales ampliados. b) Los seis de `VISION.md:226` | a) ampliado: draft → scope_accepted → in_progress → in_review → accepted, más `blocked`, separando la **verificación del sistema** de la **aceptación humana** |
| 12 | Primer producto que construye DEMIURGO | a) DEMIURGO v2. b) Un proyecto pequeño de ejemplo | **b)** primero y después a), siempre en un workspace distinto y nunca contra `:8000` (`AGENTS.md:9`) |
| 13 | Paso de tarjeta a decisión | a) Mantener la heurística. b) Propuesta del agente. c) Acción humana | **c)**, retirando la autoaceptación y el backfill del arranque |
| 14 | Política de autonomía en Exploración | a) Como hoy. b) Tope de preguntas y campo de impacto, cerrando como inferidas las de bajo impacto | **b)**, con un tope de 3 preguntas por respuesta |
| 15 | ¿Un usuario o equipos? | a) Un usuario, con actor humano/agente/sistema. b) Autenticación | **a)** en el MVP |
| 16 | Plantilla de los registros | a) Markdown libre. b) Secciones mínimas validadas | **b)**, sin tablas nuevas |
| 17 | Síntesis automática al abrir el proyecto | a) Mantener. b) Solo a petición | **b)**: hoy consume tokens sin que se pida (`frontend/src/ProjectOverview.tsx:38-44`) |
| 18 | ¿Qué declara «terminado» el MVP? | a) Solo E2E. b) Solo evaluación humana. c) Ambos | **c)**, con escenarios nuevos del Pilar 2 en `docs/evaluation-quality.md` |

---

## 7. Documentos a actualizar

| Ruta:línea | Qué dice hoy | Cambio |
|---|---|---|
| `AGENTS.md:3` | «hasta Diseño; Implementación y Revisión… aún sin ejecutar» y «antes de reimplementarlo» | El MVP incluye el Pilar 2 básico. Decir si se evoluciona o se reimplementa (decisión 1). Mantener la aceptación humana |
| `AGENTS.md:9` | Trabajar solo contra `:8000` | Añadir que los workspaces de producto y sus tests nunca usan `:8000` ni la base estable |
| `VISION.md:19-21` | Enunciado anterior y enfoque «vibecoding» | Sustituir por la nueva visión (tesis, dos pilares, capacidades transversales, principio de calidad) |
| `VISION.md:29,31` | «La orquestación automática de agentes no es requisito» y «todavía no construya ni despliegue» | Exigir el Pilar 2 básico en el MVP y definir qué es «versión más básica» (sección 5) |
| `VISION.md:294,296,302` | Qué se coordina «manualmente» y «ya no es condición de la primera versión» | Reescribir como pendientes del MVP con ambos pilares |
| `VISION.md:95-101` | Presenta como acordado lo que el código no hace (enlaces en la síntesis, pregunta de conflicto, reabrir o descartar tarjetas) | Marcar cada regla como «acordado · implementado/pendiente» |
| `README.md:1,3` | «DEMIURGO mínimo» y modelos fijos | Título nuevo. Los modelos son perfiles configurables (`app/ai_config.py:15-22`) |
| `README.md:20` | Solo lectura, «cancelación», no aplica cambios | Precisar el invariante: la IA nunca escribe en la base de datos y los implementadores solo escriben en el workspace. La cancelación no tiene botón en la interfaz |
| `README.md:37` | `model_calls` nulo «si Codex no lo informa» | Con Codex es siempre nulo (`app/observability.py:106`) |
| `README.md:39-49,64,66` | Botones de exportar y copiar inexistentes, «recorrido completo de navegador», «todavía no ejecutan trabajo» | Alinear con la superficie real y el nuevo alcance |
| `CLAUDE.md:34` | «tests join these threads» | Es falso en parte: los hilos de revisión de ronda escapan (`app/codex.py:409`, `app/main.py:470`) |
| `CLAUDE.md:40` | Invariante «AI never writes the DB» | Añadir la regla de escritura en el workspace, los gates y la evidencia `system_gate` |
| `CLAUDE.md:35` | «card → exploration → …» | Solo hay dos niveles |
| `.demiurgo/agents/exploration/v6.md:5,7` | «La aplicación actual llega hasta los artefactos de Diseño» y «No fuerces… FDR, ADR» | Crear `v7.md` con el ciclo completo (sin afirmar implementaciones sin evidencia) y subir `METHOD_VERSION` en `app/codex.py:24` |
| `frontend/src/App.tsx:196,210` | «Copiloto de diseño» y «Esta fase llegará después…» | Sustituir al construir las vistas del Pilar 2 |
| `docs/product/FLUJOS.html:287,450,743` | Construir, comprobar y evidencia son «capacidades posteriores» | Añadir el tramo Change Set → agentes → gates → evidencia → revisión, o marcar el documento como histórico |
| `docs/evaluation-quality.md:7-11,21` | Los escenarios 1, 2, 3 y 5 dependen de interfaz inexistente. No hay escenarios del Pilar 2. «Escenarios críticos» sin definir | Adaptarlos a la interfaz real. Añadir: agente que dice «terminado» con tests en rojo → bloqueo; evidencia de agente frente a evidencia de sistema; cambio de decisión con trabajo en curso; vuelta a exploración desde la revisión |
| `docs/revision-ux-2026-09-24.md:19,52,55,96,102` | «funciona… hasta Diseño», líneas de código obsoletas, UX-L5, UX-O1 | Actualizar. UX-O1 está resuelto: la instancia estable tiene montajes bind (`docker inspect`) |
| `docs/development-and-releases.md` | No define versionado ni tags | Definir la numeración y el tag de cada release evaluada |
| `migrations/versions/0013_project_overview.py:1` | Promete «unique card decisions» sin índice | Corregir la docstring o añadir el índice único |
| `wireframes.html:152` | Termina en un Change Set «en borrador» | Wireframes de Implementación y Revisión |
| `.gitignore` | No excluye `.playwright-cli/` | Añadirlo |

---

## 8. Riesgos y deuda técnica que afectan al Pilar 2

1. **No hay historia git.** No existe ningún commit y el remoto está vacío. El «resultado evaluable» de DEMIURGO no se puede identificar, y la CI y el gate nunca se han ejecutado.
2. **Las pruebas no protegen la interfaz actual.** Los E2E están obsoletos (`frontend/e2e.mjs:50-51,70,82-162`) y la CI fallaría.
3. **Las pruebas escriben fuera de su sitio.** Hay hilos daemon que escapan en los tests: en 2 de 3 ejecuciones escriben en el `demiurgo.db` de la raíz, porque `DB_PATH` se resuelve al importar (`app/db.py:6`, `app/codex.py:409`). Con una base migrada, un test la modificaría.
4. **Ejecución frágil para trabajos largos.**
   - Hilos daemon sin cola ni reanudación.
   - `PROCESSES` vive en memoria (`app/codex.py:18`), así que la cancelación solo funciona dentro del mismo proceso.
   - El límite de tiempo depende del nombre del modelo (`app/codex.py:159`).
   - Qwen puede tardar hasta unos 600 s sin watchdog.
5. **Los gates actuales se pueden saltar.** Comprobado con TestClient: un Change Set verificado vuelve a `scope_accepted` y la tarea se reabre, y un «failed» posterior no bloquea. Además, la evidencia sin `task_id` también cuenta (`app/main.py:645`).
6. **Autocertificación por API.** No hay autenticación ni actor. Cualquier proceso con acceso HTTP puede poner «done», «passed», «approved» y un origen «proposal» (`app/domain.py:71-89`, `app/main.py:563-576,640-651`). Un agente con red podría hacerlo.
7. **Seguridad.** El backend corre como root. El sandbox de solo lectura no impide leer `/data` ni `/codex`, así que un documento importado con instrucciones maliciosas podría extraer datos de otros proyectos.
8. **Versión y aprobación acopladas.** Aprobar crea v+1 y deja los AC y links en v1 (Q-M1). Esto rompe la trazabilidad por versión que necesitan los gates.
9. **`main.py` monolítico.** Tiene 782 líneas y el borrado en cascada es manual (unas 125 líneas, `app/main.py:159-286`). Los estados son TEXT sin CHECK y `links` es polimórfico sin claves foráneas. Cada tabla nueva amplía la purga manual o deja huérfanos.
10. **Contención en SQLite.** Hay una transacción `BEGIN IMMEDIATE` por evento JSONL (`app/codex.py:169-170`) y la interfaz pide `/api/state` completo cada 2 s (`frontend/src/App.tsx:105-109`). Un implementador con miles de eventos aumentará la contención.
11. **Contexto sin presupuesto.** La huella es global y el reintento difiere del envío, así que un implementador de larga duración se invalidaría por cambios ajenos.
12. **Validación de salidas heterogénea.** El chat es todo o nada; las fuentes descartan en silencio (`app/codex.py:312-314`). No hay jsonschema común.
13. **Las copias de seguridad solo cubren SQLite.** Con evidencia que apunta a SHAs, restaurar dejaría referencias colgando.
14. **«Construir DEMIURGO con DEMIURGO».** Choca con la regla de la instancia estable si el workspace apuntara al repositorio vivo.
15. **Burocracia.** Las reglas de trazabilidad son correctas pero manuales. Sin agentes que propongan el paquete completo, el Pilar 2 traslada trabajo documental a la persona.
16. **Deuda del frontend.**
    - `App.tsx` concentra todo el estado.
    - Hay `api()` y `fetch` duplicados (`frontend/src/Artifacts.tsx:7-12`, `Runs.tsx:17-21`).
    - Unas 36 clases CSS no se usan.
    - Python local es 3.14 y en CI 3.12.11.

---

## 9. Plan por fases

**Fase 0: línea base verificable**
- Trabajo:
  - Commit inicial y push; `.gitignore`.
  - Fixture que hace join de los hilos `demiurgo-run-*`, o ruta de base explícita en el ejecutor.
  - Reescribir `e2e.mjs` sobre la interfaz actual con un proveedor simulado.
  - Actualizar `AGENTS.md`, `VISION.md` y `README.md`; crear `v7.md` y subir `METHOD_VERSION`.
  - Resolver las decisiones 1–7 de la sección 6.
- Criterios de salida:
  - CI en verde en GitHub sobre `main` (pytest, build, E2E y E2E contra el contenedor).
  - `pytest` ejecutado 3 veces sin `PytestUnhandledThreadExceptionWarning`.
  - `grep -n "hasta Diseño\|aún sin ejecutar" AGENTS.md README.md .demiurgo/agents/exploration/v7.md` no devuelve nada.
  - `docs/evaluations/v0.x.md` registrada.

**Fase 1: Pilar 1 como fundamento de construcción**
- Trabajo:
  - B1-4 (tarjetas) y retirada de la heurística de autoaceptación.
  - Aprobar una versión sin crear v+1.
  - AC en la interfaz por versión (B1-2).
  - Agente de diseño que propone FDR/ADR con AC (B1-1).
  - `readiness` y ampliación de `facts` (B1-3), con el bloque «Pendiente de ti».
  - `exploration_id` obligatorio, diseño solo sobre decisión aprobada, columna `actor`, constructor de contexto único para envío y reintento.
- Criterios de salida:
  - E2E: mensaje → tarjeta confirmada con conclusión → «Registrar como decisión» → aprobar → «Proponer diseño» (simulado) → FDR aprobado con al menos un AC → etiqueta «Listo para construir».
  - Pytest:
    - confirmar sin conclusión → 400;
    - aprobar no crea una versión nueva;
    - ninguna propuesta llega a `accepted` sin resolución humana auditada;
    - `readiness` es falso con un link en `needs_update` o sin AC;
    - el contexto del envío y el del reintento tienen las mismas claves.

**Fase 2: cimientos de ejecución (sin agentes reales)**
- Trabajo:
  - Tabla de transiciones con 409.
  - `verify_result` tomando la última evidencia por AC y SHA.
  - `accept_scope` exigiendo `readiness`.
  - `project_id` en tasks y changesets; columnas nuevas en `evidence` y `ai_runs`.
  - `workspaces`, plantilla de stack y git en la imagen.
  - Runner aislado con usuario no root.
  - `orchestrator.py` con `work_steps`, reanudación y un worker por workspace.
  - Ejecutor de gates.
- Criterios de salida (pytest):
  - volver a aceptar un Change Set verificado → 409;
  - un «failed» posterior bloquea la verificación;
  - la evidencia `human` no satisface un AC automático;
  - sobre un repo de ejemplo con un test en rojo, la tarea queda `blocked` tras 3 intentos;
  - un reinicio reanuda el paso en curso;
  - el entorno del test no contiene `CODEX_HOME` ni `DEMIURGO_DB`.

**Fase 3: agentes y recorrido completo**
- Trabajo:
  - `_invoke_codex` parametrizado.
  - Acciones `acceptance_tests` e `implementation` con sus métodos y schemas.
  - Congelado de los tests de aceptación por hash.
  - Propuestas de tipo `criterion`, `task` y `changeset` con aceptación en lote.
  - `implementation_context`.
  - `open_issues` → propuesta y tarea `blocked`.
  - Origen changeset/task/evidence en las exploraciones.
  - Interfaz de Implementación y Revisión.
- Criterios de salida:
  - E2E con implementador simulado: FDR aprobado → paquete aceptado → ejecutar → gate en rojo → reintento → verde → `in_review` → «Aceptar resultado».
  - Segunda rama del E2E: bloqueo → «Abrir exploración desde aquí».
  - Test: modificar un test congelado hace fallar el gate.
  - Una ejecución real con Codex sobre el proyecto de ejemplo, registrada con su SHA y su consumo.

**Fase 4: calidad del MVP y evaluación**
- Trabajo:
  - Escenarios del Pilar 2 en `docs/evaluation-quality.md`.
  - UX P0: cancelar con tiempo transcurrido, estados en español, diálogos.
  - Copia de seguridad con `git bundle` y validación de SHAs al restaurar.
  - Agregados por Change Set y `failure_kind`.
  - Estado de realización por versión.
  - Opcionales: revisor informativo y capturas con Playwright.
- Criterios de salida:
  - `docs/evaluations/v1.0.0.md` con media ≥ 4/5, ningún escenario por debajo de 3 y sin fallos críticos, incluidos los escenarios nuevos del Pilar 2.
  - Test de copia y restauración que conserva los SHAs citados en la evidencia.
  - Tag `v1.0.0` construido desde un commit identificado.