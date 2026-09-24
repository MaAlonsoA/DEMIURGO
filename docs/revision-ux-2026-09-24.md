# Revisión exhaustiva de UX — DEMIURGO web

- **Fecha:** 24/09/2026
- **Instancia revisada:** estable, `http://127.0.0.1:8000` (contenedor `demiurgo-stable-app-1`, imagen `demiurgo:stable`, DB en `/data/demiurgo.db` dentro del contenedor)
- **Evidencia:** 46 capturas en `artifacts/ux-review/` + salidas de consola + consultas de solo lectura al DB de la instancia

## 1. Método

1. Lectura completa del frontend (`App.tsx`, `Artifacts.tsx`, `Runs.tsx`, `ExplorationContext.tsx`, `style.css`).
2. Recorrido guiado por script (Playwright + Chrome local) sobre la **instancia estable**, en dos fases:
   - **Recorrido de datos existentes** (proyecto DEMIURGO de dogfooding: 5 exploraciones, ronda cerrada con análisis, tarjeta confirmada, 5 ejecuciones): fases, líneas derivadas, diálogos, drawer de ejecuciones, vistas estrechas.
   - **Jornada nueva de principio a fin** en un proyecto temporal («Revisión UX temporal») con **ejecuciones reales de Codex**: crear proyecto → primer mensaje estratégico → **cancelar a mitad de ejecución** → **reintentar desde la UI** → comparar los prompts de ambos intentos (drawer + DB) → responder tarjeta → cerrar ronda → análisis de ronda → **4 propuestas de líneas** → aceptar una → decisión aprobada → FDR + ADR justificados → nueva revisión → línea abierta desde artefacto → **borrar proyecto temporal** (limpieza completada; al final solo queda DEMIURGO).
3. Verificación cruzada contra el DB real de la instancia (esquema, prompts guardados, spans, mensajes) y contra el código de `app/`.

Métricas globales de la jornada: **0 errores de consola, 0 pageerrors, 0 peticiones fallidas** en todo el recorrido.

## 2. Veredicto general

El producto **funciona de extremo a extremo hasta Diseño** con ejecuciones reales del modelo, sin errores de consola. La intención de producto (diseño guiado, trazabilidad de orígenes, aceptación humana de lo que propone el agente, sin promoción automática de hipótesis) **se cumple y es visible en la UI**. Los defectos relevantes son de tres familias:

1. **Contabilidad de la ejecución**: el agente tarda 15 s–4 min por acción y la UI no da cancelación, ni tiempo transcurrido, ni distingue «cancelado» de «falló». El reintento (acción de primera clase en la UI) **cambia el contexto que recibe el modelo** sin avisar.
2. **Layout y accesibilidad**: en la vista por defecto el composer nace parcialmente fuera del área visible; los diálogos no responden a Escape ni atrapan el foco.
3. **Lenguaje y coherencia**: estados crudos en inglés dentro de una UI en español; media superficie del producto (búsqueda, exportar/importar, backup, fuentes, criterios/tareas/evidencia) no tiene visibilidad en la web.

## 3. Jornada verificada (lo que funciona)

| Paso | Resultado | Evidencia |
|---|---|---|
| Crear proyecto | Diálogo con validación, aviso «Proyecto creado con su Exploración inicial.», estado vacío con guía | 21, 22 |
| Exploración inicial | Contexto «Cómo nació esta exploración», «Leer la visión inicial», estado vacío orientador | 02, 22 |
| Primer mensaje (estratégico) | Mensaje guardado, banner «Análisis #1 · running», spinner «DEMIURGO está pensando con gpt-6-sol» (modelo real del run), `Enviar` deshabilitado, polling 2 s | 23 |
| Cancelar (API, no hay botón en UI) | Banner «Análisis #1 · cancelled · Sin respuesta» + «Reintentar» | 24 |
| Reintentar desde la UI | «Análisis #2 · running»; completó en 15 s; respuesta + 1 pregunta + ronda abierta | 25, 26, 30 |
| Drawer de ejecuciones | Lista con intento/estado/tokens; detalle con modelo solicitado/observado, métricas con procedencia, prompt, fases (spans) y eventos Codex | 14, 15, 16, 18 |
| Prompts intento 1 vs 2 | **El reintento pierde `project_knowledge`** (ver UX-C2) | 27, 28 + DB |
| Hilo de tarjeta | Título = pregunta, «Contexto de esta pregunta» (razón, estado, mensaje de origen), composer «Responde a esta pregunta» | 31 |
| Responder tarjeta | Run estratégico (~2,5 min); el modelo responde con análisis **sin concluir** → tarjeta sigue «Abierta» (sin promoción automática: correcto por diseño) | 32 + DB |
| Cerrar ronda | Mensaje de integración con observaciones (claim/unknown); análisis de ronda; «Ronda cerrada» + «Ver análisis de ronda» | 35 + DB |
| Propuestas de líneas | Panel «Nuevas líneas propuestas» con 4 propuestas: título, propósito, «De dónde viene» (ronda **o respuesta de tarjeta**, con el texto de la respuesta), «Abrir línea» / «Descartar» | 36, 37 |
| Aceptar propuesta | Nueva línea con origen «Propuesta aceptada por la persona» + enlace al padre; las demás propuestas quedan pendientes | 37, 38 |
| Decisión | Formulario (título/contenido/estado/motivo), aprobada; detalle con acciones y historial | 40, 41 |
| Diseños FDR/ADR | Borradores justificados: «Basado en: Alcance del MVP de la asociación» | 42–45 |
| Revisar artefacto | v2 con motivo; historial v2/v1 con motivos | 46 |
| Línea desde artefacto | Diálogo con origen; línea «Partió del artefacto «Calendario de actividades»» | 47, 48 |
| Borrar proyecto | Confirmación con mensaje claro, aviso «Proyecto «…» borrado.», cambio automático al proyecto restante | 49 |

## 4. Hallazgos por severidad

### Críticos

**UX-C1 — La ejecución no es controlable desde la UI.**
No existe botón de cancelar (la API `/api/runs/{id}/cancel` existe y funciona; se usó durante la prueba), no hay tiempo transcurrido ni estimación, y durante la ejecución `Enviar` queda deshabilitado. Una ejecución estratégica puede tardar hasta ~4 min (timeout duro 240 s en `app/codex.py:94`); el usuario no puede abortar ni distinguir «pensando» de «atascado». Solo puede reintentar si el run *falló*. (Capturas 23, 24.)

**UX-C2 — El reintento cambia el contexto que recibe el modelo, sin aviso.**
El endpoint de reintento (`app/main.py:356`) construye un contexto distinto al del envío original (`app/main.py:343-347`): **omite `project_knowledge`** (observaciones de rondas cerradas, tarjetas confirmadas y diseños aprobados) y `exploration` (chat principal), y añade la clave `message`. Verificado en la instancia estable con el proyecto temporal:

| Intento | Longitud prompt | `project_knowledge` | Clave `message` |
|---|---|---|---|
| 1 (envío original) | 5.262 | ✓ | ✗ |
| 2 (reintento desde la UI) | 5.386 | ✗ | ✓ |

El drawer muestra ambos prompts, así que la discrepancia es auditable, pero la UI no advierte que el reintento **no** es equivalente al envío original; en un proyecto con conocimiento acumulado el modelo reintentado razona con menos contexto del producto. (Capturas 27, 28 + DB.)

### Altos

**UX-H1 — En la vista por defecto, el composer nace bajo el pliegue.**
Medido a 1360×850: `document.scrollHeight = 954 px` contra `innerHeight = 850 px`; el borde inferior del composer está en 954 → la fila «Ctrl + Enter… / Enviar» queda fuera del área visible al cargar (la lista de mensajes solo ocupa 535 px de alto porque la altura del contenedor se calcula como `calc(100vh - 158px)`, que no coincide con header + navegación real). Header y nav de fases no son sticky: al hacer scroll (necesario en conversaciones largas, y siempre en ≤1100 px porque el inbox pasa a una segunda fila) el header desaparece (capturas 19, 20).

**UX-H2 — Los diálogos no son accesibles.**
No hay manejo de `Escape` (verificado: tras `Escape` la overlay siguió interceptando clics durante 30 s en la prueba), no hay trampa de foco y solo hay `aria-modal`. Cerrar requiere clic en ×, «Cancelar» o fuera del diálogo. Afecta a todos los diálogos (proyecto, exploración, pregunta).

**UX-H3 — Terminología mixta español/inglés.**
Estados crudos en inglés dentro de una UI íntegramente en español: `running`, `completed`, `cancelled` en los banners de run y en «Ver análisis de ronda · completed» (capturas 02, 14, 23, 24, 30, 49), `draft` en el historial de revisiones «v2 · draft» (46). Los badges de tarjetas sí están en español («Abierta», «Confirmada», «Pospuesta»), lo que hace la inconsistencia más visible.

### Medios

- **UX-M1 — Estado vacío del hilo de tarjeta con el copy de la conversación principal.** `App.tsx:208` elige el texto solo por `exploration.parent_id`, ignorando `activeCard`: en una tarjeta sin mensajes se muestra «Empieza por la idea general — Cuéntame qué producto queremos construir…», cuando el composer (correcto) dice «Responde a esta pregunta». (Captura 31.)
- **UX-M2 — No hay «Descartar» en tarjetas.** Solo «Confirmar»/«Posponer» (p. pendiente) y «Confirmar inferencia»; el estado `discarded` existe en datos y badge («Descartada») pero es inalcanzable desde la UI.
- **UX-M3 — Run cancelado muestra «Sin respuesta».** El error guardado es cadena vacía; el banner dice «· Sin respuesta Reintentar», indistinguible de un fallo real y no reconoce que el usuario canceló.
- **UX-M4 — Sin tiempo transcurrido ni ETA en el spinner.** Útil solo el modelo del run; no hay señal de progreso ni de atasco en runs de minutos.
- **UX-M5 — Polling de estado completo cada 2 s.** `/api/state` devuelve todos los proyectos/runs sin LIMIT (`app/main.py:49`); en la prueba 8–10 KB por petición (con 2 proyectos); crece linealmente con el volumen de datos y re-renderiza la app entera.
- **UX-M6 — Drawer de ejecuciones.** Sin overlay de atenuación (inconsistente con los diálogos); «Prompt enviado» y «Resultado final» siempre expandidos (paredes de texto); resultado en JSON crudo sin formatear; «Fases de la traza» con timestamps ISO crudos (resto de la UI en `es-ES`); subtitular con ID crudo (`round-890a9d6dc35a`); «Llamadas al modelo: No reportado (not_reported)» es nula permanente (el backend nunca la rellena). Para runs en curso, «Resultado final: No disponible» sin indicación de que está en curso. (Capturas 15, 16, 18, 27.)
- **UX-M7 — El header solo muestra el modelo estratégico** («Visión, preguntas y rondas: gpt-6-sol · high»); el modelo de conversación posterior (gpt-6-luna · medium) solo existe en el `aria-label`. El usuario no sabe con qué modelo conversa fuera de visiones/preguntas/rondas.
- **UX-M8 — La barra lateral no indica trabajo pendiente por línea.** No hay contadores de tarjetas abiertas ni propuestas pendientes por exploración; el inbox solo cubre la exploración actual. En un proyecto con varias líneas no se ve de un vistazo dónde hay que actuar.
- **UX-M9 — Inbox sin filtros y sin truncado.** Pregunta/razón/propósito a texto completo; sin filtro por estado ni agrupación; con varias tarjetas/propuestas el panel se alarga sin colapso.
- **UX-M10 — «Basado en: <decisión>» no es un enlace.** No permite navegar a la decisión que justifica el diseño (la trazabilidad clave del producto no es navegable).
- **UX-M11 — Media superficie del producto es invisible en la web.** Solo existe por API: búsqueda global, exportar (JSON/Markdown/contexto), importar, backup/restore, importación de fuentes y revisión de propuestas de fuentes, criterios/tareas/changesets/evidencia/links/impacto/trazabilidad/auditoría. El usuario de la web no puede descubrir estas capacidades.
- **UX-M12 — Las acciones destructivas usan `confirm()` nativo** del navegador, inconsistente con el resto de diálogos estilizados; sin opción de deshacer. (Mensajes sí son claros: «¿Borrar el proyecto «X» y todo su contenido? Esta acción no se puede deshacer.»)

### Bajos

- **UX-L1 — Copy y acentos:** «Abrir conversacion» sin acento (`App.tsx:218`); kicker «DECISION» sin acento frente a «Decisión»; mayúsculas inconsistentes («Borrador» en lista vs. «BORRADOR» en detalle); «No disponible» para resultados en curso.
- **UX-L2 — Filas de la lista de ejecuciones densas:** tipo · intento · estado · fecha · trace id · tokens en una línea; el trace id compite por espacio con la información accionable.
- **UX-L3 — 29 clases CSS huérfanas** de la UI anterior (`.header-search`, `.mode-tabs`, `.work-columns`, `.proposal-grid`, `.record-grid`, …) en `style.css`.
- **UX-L4 — Los avisos («Proyecto creado…», «…borrado.») no se auto-descarten**; requieren clic en «Cerrar».
- **UX-L5 — Las pestañas Implementación/Revisión se ven activas** (mismo estilo que las operativas) aunque son placeholders; su contenido («Esta fase llegará después de completar los artefactos…») es coherente con la intención de producto, pero el estilo sugiere funcionalidad.
- **UX-L6 — En tablet (≤1100 px) el inbox pasa por debajo del contenido principal** (scroll de página): se pierde el «de un vistazo» que el diseño de tres columnas otorga en escritorio.
- **UX-L7 — Sin fecha en el historial de revisiones** (solo versión, estado y motivo).

### Operativo (afecta a la «instancia estable»)

**UX-O1 — Los datos del dogfooding viven solo en el contenedor.** El contenedor `demiurgo-stable-app-1` no tiene volumes; el DB (`/data/demiurgo.db`) está en la capa escribible del contenedor. Una recreación del contenedor (`docker compose up --force-recreate`, rebuild, etc.) **pierde todo el contenido** salvo que se exporte antes. El `demiurgo.db` de la raíz del repo (196 KB) es antiguo y no es el de la instancia.

## 5. Lo que funciona bien (preservar)

- **Recorrido núcleo completo y estable** con ejecuciones reales: 0 errores de consola en toda la jornada.
- **Trazabilidad de orígenes en todos los niveles**: «Cómo nació esta exploración», «Contexto de esta pregunta» (con mensaje de origen), «Nació de … · Propuesta aceptada por la persona», «De dónde viene» (ronda o respuesta de tarjeta, *con el texto de la respuesta*), «Basado en», «Partió del artefacto». Cumple la intención («cada nueva línea conserva su origen»).
- **Gobernanza visible**: las propuestas de líneas y artefactos requieren aceptación humana («Abrir línea»/«Descartar», «Aceptar»/«Descartar»); **no hay promoción automática** (verificado: una tarjeta respondida sin conclusión del modelo sigue «Abierta»).
- **Estados vacíos orientadores** en exploración inicial, líneas derivadas, fases de artefactos e inbox (salvo el copy de tarjeta, UX-M1).
- **Estados de run por mensaje** con intento, reintento y enlace a la traza; spinner con el modelo real de esa ejecución.
- **Observabilidad honesta**: métricas con procedencia («codex.turn.completed.usage» vs. «demiurgo.process» vs. «not_reported»), «No reportado ≠ cero», spans con duraciones, eventos Codex crudos.
- **Borrado de proyecto** con confirmación explícita, aviso posterior y cambio automático al proyecto restante.
- **Estados deshabilitados coherentes** («Enviar» sin texto o durante run; «Aceptar» propuesta de diseño sin decisiones).
- **Diseño visual coherente**: paleta consistente, contraste serif/sans, badges por estado, jerarquía clara.

## 6. Priorización sugerida

**P0 — Cumplir la promesa de «ejecución gobernada» (semana):**
1. UX-C1: cancelar run desde la UI (banner del run y/o drawer) + tiempo transcurrido en el spinner + mensaje propio de «cancelado» (absorbe UX-M3, UX-M4).
2. UX-C2: un único constructor de contexto compartido entre envío y reintento (reintento = mismo contexto que el envío original).
3. UX-H1: corregir el cálculo de alto del contenedor de conversación (o hacer sticky el composer/header) para que el composer nazca visible en 1360×850 y en 1024×768.

**P1 — Accesibilidad y consistencia:**
4. UX-H2: `Escape` + trampa de foco + `aria-live` en diálogos.
5. UX-H3: mapa de estados a español (running→en curso, completed→completado, cancelled→cancelado, draft→borrador, failed→fallido, interrupted→interrumpido).
6. UX-M1 (copy del estado vacío de tarjeta) y UX-M2 («Descartar» en tarjetas).
7. UX-M12: diálogo de borrado estilizado (consistente con el resto), idealmente con deshacer.

**P2 — Superficie y densidad de información:**
8. UX-M6 (drawer: atenuación, secciones colapsables, JSON formateado, fechas localizadas, ocultar trace id en lista).
9. UX-M7 (modelo de conversación visible en el header) y UX-M10 («Basado en» navegable).
10. UX-M8/UX-M9: contadores por línea en la barra lateral + filtros/colapso en el inbox.
11. UX-M11: decisión de producto sobre qué superficie exponer en la web (mínimo: exportar/backup; ideal: búsqueda y fuentes) — hoy es solo API.

**P3 — Limpieza:**
12. UX-L1 (pase de copy/acentos), UX-L2, UX-L3 (CSS huérfano), UX-L4…L7.

**Operativo (paralelo, fuera de UX):**
13. UX-O1: montar un volume para `/data/demiurgo.db` (o política de backup exportado) antes de cualquier recreación del contenedor.
