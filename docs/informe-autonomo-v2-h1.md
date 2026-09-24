# Informe de la sesión autónoma: v2 lista para H1 (solo back)

Fecha: 2026-09-24. Rama `v2` (sin push ni merge a `main`). La v1 queda en la etiqueta local `v1-referencia` (`bf8a9cd`). Encargo: `docs/brief-autonomo-v2-h1.md`.

> **Código en inglés.** Después de este informe, todo el código pasó a inglés: nombres, archivos, API, mensajes, pruebas y prompts (sección 11). Las secciones 2 a 7 describen el trabajo con los nombres de entonces, por ejemplo `durabilidad.test.ts` o `design/datos/`. Las secciones 8 a 11 ya usan los nombres actuales.

## 1. Resumen

- **Hecho:** D0, S0, S1 y S2 con sus criterios de salida de §5 (las excepciones están en la sección 2) y H1 preparado. La importación de `design/` genera el lote pendiente y, tras ratificarlo, la exportación coincide byte a byte.
- **No ratificado:** el lote de H1 está pendiente en la instancia de la v2, esperando tu ratificación (sección 8.3).
- **`pnpm gate:all`:** en verde en `v2`. Pasan los tipos, el lint, el formato, el validador de `design/` y la deriva de las tablas, 392 pruebas (unitarias e integración) y 491 invariantes. La trazabilidad AC → prueba está completa: 80 criterios automáticos con prueba pasada.
- **Revisiones:** un subagente revisor independiente intentó refutar cada incremento (D0, S0, S1, S2 y H1). Todo lo que encontraron se corrigió con pruebas nuevas o queda documentado aquí (sección 4).
- **Pendiente de ti:**
  - aprobar los documentos de `design/`, que siguen en estado «propuesto»;
  - ratificar H1;
  - las decisiones de la sección 6.

## 2. Criterios de salida de §5

| Incremento | Criterio de salida | Estado | Dónde se demuestra |
|---|---|---|---|
| D0 | El validador pasa en la CI | Cumple en local | `pnpm gate:design`. El paso existe en `.github/workflows/ci.yml`, pero la CI no se ha ejecutado porque no hay push. |
| D0 | ADR de stack y del runner aceptados por la persona | **Pendiente de ti** | Están en «propuesto». La aceptación es tuya, con el merge (AC-FMT-001-07, manual). |
| D0 | FDR de S0–S2 con todos los AC verificables | Cumple | FDR-ESQ-001, FDR-DIS-001, FDR-CON-001 y FDR-AUT-001: cada AC tiene verificación y comprobación, y su prueba lleva el código en el nombre. |
| S0 | CI de 4 etapas en verde | Cumple en local, **CI sin ejecutar** | `ci.yml` con cuatro trabajos: tipos y lint, unitarias, integración e invariantes más trazabilidad. AC-ESQ-001-15 comprueba su estructura. |
| S0 | Matar el proceso con un trabajo en curso → se reanuda y el efecto ocurre una vez | Cumple | AC-ESQ-001-07, `durabilidad.test.ts`: proceso hijo matado con SIGKILL en tres puntos. |
| S0 | La sonda no ve credenciales ni abre la base | Cumple | AC-ESQ-001-11 y la ejecución real de la sonda: 0 violaciones. |
| S0 | 403 y 409 generados desde la matriz | Cumple | AC-ESQ-001-02/03: invariantes generadas desde `design/datos/*.yaml`, más de 490 casos. |
| S0 | UPDATE sobre el diario falla | Cumple | AC-ESQ-001-04: triggers de solo INSERT. |
| S0 | Salida inválida → `invalid_output` sin efectos | Cumple | AC-ESQ-001-08. |
| S0 | UI en español con actualización incremental | **Desviación** | Sin UI, por el brief. Existe el flujo SSE incremental (`/eventos/flujo` con Last-Event-ID, AC-ESQ-001-14). |
| S1 | E2E intención → decisión → FDR con 2 AC → «Listo» y bandeja vacía | Cumple | AC-DIS-001-01 (API y motor durable con simulador) y la ejecución real con Haiku. |
| S1 | Un agente propone por el canal y la persona acepta en la UI | Cumple, **con excepción** | Se acepta por la API con la cookie de sesión en lugar de la UI (brief, Alcance 3). AC-DIS-001-02/03. |
| S1 | Todo comando decisivo con actor no humano se rechaza | Cumple | AC-DIS-001-04 (propiedad con fast-check) e invariantes de la matriz. |
| S1 | Readiness falsa por cada motivo | Cumple | AC-DIS-001-06: los ocho motivos, más la cadena de origen propuesta → lote → ejecución. |
| S1 | El context pack del reintento coincide con el del envío | Cumple | AC-DIS-001-07. |
| S2 | Aprobar una versión dispara la actualización y sube la versión del grafo | Cumple | AC-CON-001-01 |
| S2 | Un veredicto que no cubre un candidato o cita un nodo inexistente → `rejected` sin efectos | Cumple | AC-CON-001-02/03, que también cubren un nodo que no era candidato y los veredictos duplicados |
| S2 | Un veredicto que invalida una decisión aprobada → propuesta en la bandeja, nunca un cambio directo | Cumple | AC-CON-001-04 y AC-CON-001-12. La barrera del componente `conocimiento` es una lista cerrada fijada en código, y `record_version.supersede` exige una versión aprobada posterior. |
| S2 | Reconstruir con las clasificaciones guardadas da la misma huella | Cumple | AC-CON-001-06, con propuestas, descartes, enlaces, rechazos y reintentos; también detecta un grafo alterado |
| S2 | Una idea que duplica una decisión aparece marcada con la cita | Cumple | AC-CON-001-08 |
| S2 | Conjunto de evaluación del clasificador con precisión y cobertura registradas | Cumple | AC-CON-001-11 y la ejecución real de referencia (sección 7); cada evaluación guarda el sha256 del conjunto |
| S2 | Importar dos veces `design/` no duplica | Cumple | AC-CON-001-10 |
| H1 | Mismos recuentos que el origen y nada aprobado sin acción humana | Cumple | AC-AUT-001-01/02/03. |
| H1 | La FDR de S3 nace y se aprueba en la v2 | **Pendiente** | Es lo primero tras ratificar (AC-AUT-001-07, manual). |
| H1 | La exportación regenerada coincide con `design/` sin diff | Cumple | AC-AUT-001-04 y `pnpm cli exportar-diseno <id> --comprobar design`. |

Nota sobre el historial: el commit `d9b8b6e` (correcciones de S0) incluyó por error un bloque de S2 que consulta una tabla creada en el commit siguiente. En ese commit concreto `gate:all` no pasa. Desde `f23f994` en adelante la rama está coherente. No he reescrito la historia (rebase), porque la rama es local y solo tú decides si limpiarla.

## 3. Estado de cada AC

Generado con `node packages/design/src/cli.ts estado-ac` a partir de `design/` y de los informes JUnit del último `pnpm gate:all`.
- **Verde:** su prueba pasó.
- **Manual:** lo comprueba la persona.
- **No implementado:** pertenece a un incremento posterior a H1.

**Resumen:** 92 criterios. 80 en verde, 12 manuales, ninguno en rojo y ninguno sin implementar (todos son de D0–S2 y H1).

Los 12 manuales:
- **Aceptación humana de los seis ADR** (AGE, CLA, FMT, NUC, RUN y STK): pendientes de ti.
- **Ejecuciones reales** (AC-ESQ-001-16, AC-DIS-001-17 y AC-CON-001-16): hechas y registradas (sección 7).
- **Ratificación en la instancia** (AC-AUT-001-06): pendiente de ti.
- **La FDR de S3 nace en la v2** (AC-AUT-001-07): después de ratificar.
- **Edición manual de `design/` bloqueada** (AC-AUT-001-08): se activa después de H1.

| AC | Registro | Título | Verificación | Estado | Pruebas |
|---|---|---|---|---|---|
| AC-AGE-001-01 | ADR-AGE-001 | Suscripción y salida estructurada | automática | verde | 4 pasadas |
| AC-AGE-001-02 | ADR-AGE-001 | Contrato por fixture grabada | automática | verde | 6 pasadas |
| AC-AGE-001-03 | ADR-AGE-001 | Tiempo y cancelación | automática | verde | 5 pasadas |
| AC-AGE-001-04 | ADR-AGE-001 | Aceptación humana | manual | manual | 0 pasadas |
| AC-CLA-001-01 | ADR-CLA-001 | Puerto y Jev vacío | automática | verde | 1 pasadas |
| AC-CLA-001-02 | ADR-CLA-001 | Simulador determinista | automática | verde | 1 pasadas |
| AC-CLA-001-03 | ADR-CLA-001 | Adaptador de referencia | automática | verde | 9 pasadas |
| AC-CLA-001-04 | ADR-CLA-001 | Cascada por umbrales | automática | verde | 3 pasadas |
| AC-CLA-001-05 | ADR-CLA-001 | Aceptación humana | manual | manual | 0 pasadas |
| AC-FMT-001-01 | ADR-FMT-001 | Documento canónico | automática | verde | 33 pasadas |
| AC-FMT-001-02 | ADR-FMT-001 | Códigos y enlaces | automática | verde | 15 pasadas |
| AC-FMT-001-03 | ADR-FMT-001 | Criterios verificables | automática | verde | 23 pasadas |
| AC-FMT-001-04 | ADR-FMT-001 | Taxonomía con «otra» | automática | verde | 3 pasadas |
| AC-FMT-001-05 | ADR-FMT-001 | Trazabilidad | automática | verde | 9 pasadas |
| AC-FMT-001-06 | ADR-FMT-001 | Gates en la CI | automática | verde | 2 pasadas |
| AC-FMT-001-07 | ADR-FMT-001 | Aceptación humana | manual | manual | 0 pasadas |
| AC-NUC-001-01 | ADR-NUC-001 | Tablas coherentes | automática | verde | 18 pasadas |
| AC-NUC-001-02 | ADR-NUC-001 | Sin deriva | automática | verde | 3 pasadas |
| AC-NUC-001-03 | ADR-NUC-001 | Guardas implementadas | automática | verde | 1 pasadas |
| AC-NUC-001-04 | ADR-NUC-001 | Aceptación humana | manual | manual | 0 pasadas |
| AC-NUC-001-05 | ADR-NUC-001 | Comandos compuestos | automática | verde | 1 pasadas |
| AC-RUN-001-01 | ADR-RUN-001 | Contenedor endurecido | automática | verde | 2 pasadas |
| AC-RUN-001-02 | ADR-RUN-001 | Tiempo máximo | automática | verde | 3 pasadas |
| AC-RUN-001-03 | ADR-RUN-001 | Frontera de las acciones de IA | automática | verde | 5 pasadas |
| AC-RUN-001-04 | ADR-RUN-001 | Aceptación humana | manual | manual | 0 pasadas |
| AC-STK-001-01 | ADR-STK-001 | Tipos estrictos | automática | verde | 2 pasadas |
| AC-STK-001-02 | ADR-STK-001 | Versiones exactas | automática | verde | 3 pasadas |
| AC-STK-001-03 | ADR-STK-001 | Defensas de pnpm | automática | verde | 2 pasadas |
| AC-STK-001-04 | ADR-STK-001 | Una sola base | automática | verde | 1 pasadas |
| AC-STK-001-05 | ADR-STK-001 | Dominio puro | automática | verde | 2 pasadas |
| AC-STK-001-06 | ADR-STK-001 | Aceptación humana | manual | manual | 0 pasadas |
| AC-AUT-001-01 | FDR-AUT-001 | Lote pendiente con los mismos recuentos | automática | verde | 3 pasadas |
| AC-AUT-001-02 | FDR-AUT-001 | Solo una persona ratifica | automática | verde | 2 pasadas |
| AC-AUT-001-03 | FDR-AUT-001 | Ratificar en un paso | automática | verde | 1 pasadas |
| AC-AUT-001-04 | FDR-AUT-001 | Exportación sin diff | automática | verde | 6 pasadas |
| AC-AUT-001-05 | FDR-AUT-001 | Reimportar no duplica | automática | verde | 7 pasadas |
| AC-AUT-001-06 | FDR-AUT-001 | Ratificación en la instancia | manual | manual | 0 pasadas |
| AC-AUT-001-07 | FDR-AUT-001 | La FDR de S3 nace en la v2 | manual | manual | 0 pasadas |
| AC-AUT-001-08 | FDR-AUT-001 | Edición manual bloqueada tras H1 | manual | manual | 0 pasadas |
| AC-CON-001-01 | FDR-CON-001 | Aprobar dispara la actualización | automática | verde | 1 pasadas |
| AC-CON-001-02 | FDR-CON-001 | Candidato sin veredicto | automática | verde | 2 pasadas |
| AC-CON-001-03 | FDR-CON-001 | Nodo inexistente | automática | verde | 1 pasadas |
| AC-CON-001-04 | FDR-CON-001 | Autoridad solo por propuesta | automática | verde | 3 pasadas |
| AC-CON-001-05 | FDR-CON-001 | Invalidar en lugar de borrar | automática | verde | 1 pasadas |
| AC-CON-001-06 | FDR-CON-001 | Reconstrucción con la misma huella | automática | verde | 2 pasadas |
| AC-CON-001-07 | FDR-CON-001 | Gate de frescura | automática | verde | 3 pasadas |
| AC-CON-001-08 | FDR-CON-001 | Evaluación de ideas | automática | verde | 3 pasadas |
| AC-CON-001-09 | FDR-CON-001 | Context packs por rol | automática | verde | 2 pasadas |
| AC-CON-001-10 | FDR-CON-001 | Importador idempotente | automática | verde | 1 pasadas |
| AC-CON-001-11 | FDR-CON-001 | Evaluación del clasificador registrada | automática | verde | 9 pasadas |
| AC-CON-001-12 | FDR-CON-001 | El clasificador no toca la autoridad | automática | verde | 4 pasadas |
| AC-CON-001-13 | FDR-CON-001 | Veredictos reutilizados por input_hash | automática | verde | 3 pasadas |
| AC-CON-001-14 | FDR-CON-001 | Confianza baja a la persona | automática | verde | 1 pasadas |
| AC-CON-001-15 | FDR-CON-001 | Taxonomía aprobada | automática | verde | 2 pasadas |
| AC-CON-001-16 | FDR-CON-001 | Ejecución real registrada | manual | manual | 0 pasadas |
| AC-DIS-001-01 | FDR-DIS-001 | Recorrido completo | automática | verde | 1 pasadas |
| AC-DIS-001-02 | FDR-DIS-001 | Canal de agentes por API | automática | verde | 1 pasadas |
| AC-DIS-001-03 | FDR-DIS-001 | Canal de agentes por MCP | automática | verde | 5 pasadas |
| AC-DIS-001-04 | FDR-DIS-001 | Decisivos solo humanos | automática | verde | 3 pasadas |
| AC-DIS-001-05 | FDR-DIS-001 | Lista de permitidos del agente | automática | verde | 89 pasadas |
| AC-DIS-001-06 | FDR-DIS-001 | Readiness falsa por cada motivo | automática | verde | 3 pasadas |
| AC-DIS-001-07 | FDR-DIS-001 | Mismo context pack en el reintento | automática | verde | 1 pasadas |
| AC-DIS-001-08 | FDR-DIS-001 | Aprobar no crea versión | automática | verde | 3 pasadas |
| AC-DIS-001-09 | FDR-DIS-001 | Contenido inmutable | automática | verde | 4 pasadas |
| AC-DIS-001-10 | FDR-DIS-001 | Gobierno de preguntas | automática | verde | 1 pasadas |
| AC-DIS-001-11 | FDR-DIS-001 | Lotes de agentes externos | automática | verde | 3 pasadas |
| AC-DIS-001-12 | FDR-DIS-001 | Estado epistémico visible | automática | verde | 2 pasadas |
| AC-DIS-001-13 | FDR-DIS-001 | Estado del producto mínimo | automática | verde | 1 pasadas |
| AC-DIS-001-14 | FDR-DIS-001 | Chequeo de verificabilidad | automática | verde | 1 pasadas |
| AC-DIS-001-15 | FDR-DIS-001 | Credencial humana protegida | automática | verde | 2 pasadas |
| AC-DIS-001-16 | FDR-DIS-001 | Propuesta obsoleta | automática | verde | 8 pasadas |
| AC-DIS-001-17 | FDR-DIS-001 | Ejecución real registrada | manual | manual | 0 pasadas |
| AC-DIS-001-18 | FDR-DIS-001 | Plantilla obligatoria | automática | verde | 2 pasadas |
| AC-DIS-001-19 | FDR-DIS-001 | Inferir es del sistema | automática | verde | 2 pasadas |
| AC-DIS-001-20 | FDR-DIS-001 | Procedencia del lote | automática | verde | 2 pasadas |
| AC-ESQ-001-01 | FDR-ESQ-001 | Comando → capacidad → tabla → evento | automática | verde | 3 pasadas |
| AC-ESQ-001-02 | FDR-ESQ-001 | 403 generado desde la matriz | automática | verde | 354 pasadas |
| AC-ESQ-001-03 | FDR-ESQ-001 | 409 generado desde las tablas | automática | verde | 128 pasadas |
| AC-ESQ-001-04 | FDR-ESQ-001 | Diario protegido | automática | verde | 1 pasadas |
| AC-ESQ-001-05 | FDR-ESQ-001 | Migraciones | automática | verde | 2 pasadas |
| AC-ESQ-001-06 | FDR-ESQ-001 | Configuración inyectada | automática | verde | 2 pasadas |
| AC-ESQ-001-07 | FDR-ESQ-001 | Motor durable | automática | verde | 3 pasadas |
| AC-ESQ-001-08 | FDR-ESQ-001 | Salida inválida sin efectos | automática | verde | 2 pasadas |
| AC-ESQ-001-09 | FDR-ESQ-001 | Simulador determinista | automática | verde | 2 pasadas |
| AC-ESQ-001-10 | FDR-ESQ-001 | Adaptador real | automática | verde | 4 pasadas |
| AC-ESQ-001-11 | FDR-ESQ-001 | Sonda del runner | automática | verde | 3 pasadas |
| AC-ESQ-001-12 | FDR-ESQ-001 | JobSpec cerrado | automática | verde | 3 pasadas |
| AC-ESQ-001-13 | FDR-ESQ-001 | Actor fijado por el servidor | automática | verde | 3 pasadas |
| AC-ESQ-001-14 | FDR-ESQ-001 | SSE incremental | automática | verde | 1 pasadas |
| AC-ESQ-001-15 | FDR-ESQ-001 | CI de 4 etapas | automática | verde | 1 pasadas |
| AC-ESQ-001-16 | FDR-ESQ-001 | Ejecución real registrada | manual | manual | 0 pasadas |
| AC-ESQ-001-17 | FDR-ESQ-001 | Proyecto en todas las entidades y sin borrado | automática | verde | 2 pasadas |

## 4. Revisiones independientes y correcciones

Cada revisor trabajó sobre una copia del commit (`git archive`) con bases efímeras propias, mutaciones y experimentos adversarios. No llamó a modelos reales.

| Incremento | Hallazgos principales | Corrección |
|---|---|---|
| D0 (`356eacd`) | Trazabilidad engañable (contaba pruebas por texto), huecos del validador, invariantes de autoridad solo en los datos, `proposal.create` abierto a agentes externos, estados ambiguos en H1, spikes reducidos, AC sin oráculo | `8420760`: trazabilidad desde JUnit (solo pruebas pasadas y con el código al principio del título), invariantes fijadas en código, validador ampliado y alcance reducido de los spikes declarado como desviación |
| S0 (`8f3f437`) | I-1…I-6 y M-1…M-11 (causa y correlación, diario, reintentos, configuración inyectada, etc.) | `d9b8b6e`. Quedan abiertos I-5 (roles de base de datos) y M-9 (DBOS lee variables de entorno): ver sección 6 |
| S1 (`d9b8b6e`) | Aprobar un borrador antiguo dejaba dos versiones aprobadas; paquete obsoleto que nunca quedaba obsoleto; obsolescencia que dependía de que alguien la declarara; escritura entre proyectos; criterios y enlaces añadibles a una versión ya creada; bandeja sin preguntas abiertas; AC-12 sin demostrar; 13 de 16 mutaciones sobrevivían | `581091f`. Guardas nuevas (`sin_aprobada_posterior`, `dentro_de_su_version`, `registro_del_proyecto`, `dependencias_del_proyecto`), migración `0004_integridad` (la base impone versión en borrador y mismo proyecto), obsolescencia al aprobar y al enviar (lote entero en paquetes; `basado_en` cuenta como dependencia), bandeja con preguntas abiertas y borradores, reabrir borra la conclusión, códigos de AC no reutilizables, aviso de verificabilidad al registrar, prueba por cada fila de la tabla epistémica y prueba de arquitectura de I2 |
| S2 (`d63f442`) | **Bloqueantes:** la reconstrucción divergía del grafo vivo (descartes, reintentos, orden por disparo) y «Aceptar y aprobar» dejaba lo aprobado como «propuesto» en el grafo, fuera de los context packs. **Importantes:** el reintento no funcionaba (id de flujo DBOS repetido y caché envenenada), actualizaciones que se quedaban en `classifying`, categorías fuera de la taxonomía aceptadas y fuga de caché entre proyectos, revisión perdida con códigos con dígitos, barrera del clasificador débil, cascada «media → LLM» inexistente | Fusión `0658498` (commits `1088545`, `070898d`, `0e2c915` y `f88588a`). Derivación sin mirar el estado actual. Descartar encola una retirada. Reconstrucción en orden de aplicación, que informa de la deriva en lugar de lanzar. `planificar` nunca pasa un nodo confirmado a propuesto. Un flujo por intento y caché solo de salidas verificadas. Cualquier fallo rechaza la actualización. `verificarCategorias` y guarda `clasificacion_valida`, con el `content_hash` de la taxonomía en el input_hash. La revisión localiza el registro por el origen del nodo. Lista cerrada de comandos del componente `conocimiento`. Cascada con revisor (`clasificador/cascada.ts`). Evaluación de ideas también para los paquetes de ejecuciones. Queda sin corregir m6 (sección 6) |
| H1 (`d63f442`) | Códigos DOM-NNN que chocaban entre tipos (invalidaban la exportación); exportación inválida tras una versión nueva en la v2; reimportación ciega a enlaces, nota de cambio y dominio; cambio solo de estado de la taxonomía imposible de ratificar; estados `sustituido`/`descartado` que no se conservaban; lotes imposibles de ratificar; tipos importados aceptados fuera de la importación; `design.import` humano roto; CLI que ocultaba los motivos | `5457dda`. La importación compara cada documento con su versión en la v2, renderizada como la exportación: un cambio sin subir la versión se rechaza nombrando el documento, un cambio de estado se ratifica y una importación nueva deja obsoleta la pendiente. Enlaces a versiones anteriores, `design/` solo con `propuesto`/`aprobado`, textos sin espacios al principio ni al final, «Deriva de» con ida y vuelta, códigos DOM-NNN únicos entre tipos, CLI con motivos y directorio de salida reemplazado de forma segura |
| Verificación de S1 y H1 (`e375a38`) | Un segundo revisor intentó reabrir cada hallazgo: 51 mutaciones, variantes adversarias y la CLI de verdad. **Regresiones:** las revisiones del conocimiento sobre borradores nacían obsoletas y no llegaban a la bandeja, y una importación podía hacer retroceder la taxonomía vigente. **Variantes abiertas:** aprobar una taxonomía por detrás de otra, `basado_en` junto a otra versión declarada, medio paquete por `proposal.supersede`, lotes de importación que no se podían ratificar (versión anterior aprobada, código de AC descartado, límites de longitud, DOM-NNN de la v2), «Deriva de» perdido en versiones posteriores y la CLI borrando archivos ajenos. 12 mutaciones sobrevivían | `a6a3ea8`. Una dependencia de un borrador solo caduca si se descarta o si se aprueba otra versión; al descartar, sus enlaces pasan a revisión. Guarda `taxonomia_sin_aprobada_posterior`. La importación rechaza antes de crear el lote todo lo que no se podría ratificar, y los límites de longitud son los mismos en la v2 y en el validador (`LIMITES_VERSION`). «Deriva de» sigue la cadena de arrastre. Guarda de paquete en `proposal.supersede`. La exportación solo borra archivos de `design/`. Pruebas nuevas para las mutaciones supervivientes, salvo la CLI (comprobada a mano) y dos guardas defensivas |

## 5. Desviaciones del plan y del stack

1. **Node 24.21 en lugar de 26.** Es lo que hay en la máquina (brief). Node 24 entra en mantenimiento el 20-10-2026; pasar a Node 26 LTS no exige tocar ningún build (ADR-STK-001).
2. **Versiones fijadas por antigüedad mínima.** `minimumReleaseAge` de 3 días bloqueó oxlint 1.84/1.85 y el SDK MCP 2.1.0, así que se usan oxlint 1.83.0 y MCP 2.0.0. pnpm 11.27.1 va por corepack.
3. **Lint con oxlint en lugar de typescript-eslint.** TypeScript 7 (tsc nativo) no tiene API programática. El formato lo hace Biome.
4. **Sin paso de build.** Node ejecuta TypeScript con *type stripping* (`erasableSyntaxOnly`).
5. **Sin OpenAPI generado.** En su lugar, `GET /api/comandos` publica por comando la capacidad, si es decisivo y el JSON Schema de sus datos, sacado del mismo Zod que los valida. `GET /api/tablas` sirve las tablas.
6. **Spikes de alcance reducido.**
   - El de DBOS solo prueba la recuperación tras matar el proceso. Falta el *slice* vertical con agentes y la comparación con Temporal.
   - El del runner es la sonda de aislamiento. Falta el agente que modifica un repo de ejemplo.
   - Las dos cosas quedan como decisión antes de S4 (ADR-STK-001 y ADR-RUN-001).
7. **Docker Desktop con WSL2, no Hyper-V.** El runner comparte la VM con tus distros WSL. Pasar a Hyper-V o a una microVM queda antes de S4 (ADR-RUN-001).
8. **Agentes por CLI con suscripción en lugar del SDK con API key** (ADR-AGE-001, por el brief). Codex no se ha usado.
9. **Sin UI.** Las aceptaciones humanas van por la API con la cookie de sesión y CSRF (brief).
10. **DBOS:**
    - no permite arrancar un flujo dentro de un paso, así que hay un despachador diferido;
    - `applicationVersion` y `executorID` están fijos para poder recuperar tras reiniciar;
    - la cola del conocimiento es en serie (concurrencia global 1).
11. **Motor de conocimiento:**
    - la tokenización es propia, en TypeScript, en lugar del FTS `spanish` de Postgres (por determinismo y huella reproducible);
    - la relevancia de los context packs es léxica;
    - el gate de frescura solo bloquea con actualizaciones en curso.
    Ver FDR-CON-001.
12. **CI escrita pero no ejecutada:** no hay push. El workflow está en `.github/workflows/ci.yml`.
13. **Cascada del clasificador:** la revisión por LLM de la confianza media solo actúa si configuras un revisor (`DEMIURGO_REVISOR=referencia`, `DEMIURGO_MODELO_REVISOR`). Sin él, una relación de confianza media o baja queda anotada en la actualización (`operaciones.sin_aplicar`) y no se aplica; una categoría de confianza no alta va a la bandeja.
14. **Limitaciones conocidas de `design/` como exportación:**
    - un enlace a una versión en borrador que después se descarta, o a un registro con todas sus versiones descartadas, deja una exportación que el validador rechaza hasta que el enlace se revise con una versión nueva (descartar ya marca el enlace para revisión);
    - la prueba de arquitectura de I2 es heurística: busca literales de comandos y no nombres construidos en tiempo de ejecución;
    - la CLI de operación no tiene pruebas automáticas: sus órdenes se comprobaron a mano;
    - la ejecución real de S1 («bandeja vacía») es anterior a que la bandeja contara también las preguntas abiertas y los borradores.

## 6. Decisiones tomadas en tu nombre, pendientes de revisión

Apliqué la recomendación de los documentos en cada caso y seguí adelante.

**Formato y diseño**
1. **`design/` guarda solo la versión en curso de cada registro, en estado `propuesto` o `aprobado`.** Un enlace puede seguir en una versión anterior de su destino, por ejemplo cuando se mantuvo tras revisarlo; la importación exige que esa versión ya esté en la v2. Así, aprobar una versión nueva en la v2 deja una exportación válida. La alternativa era exportar todo el historial.
2. **AC-DIS-001-12 incluye también los detalles de exploración y de lote.** Una propuesta aceptada, una pregunta confirmada o una observación del agente no están en la bandeja ni en el estado del producto. Su estado epistémico se ve donde aparecen. Se ajustaron el punto 11 y el texto del AC en FDR-DIS-001.
3. **La bandeja reúne todo lo que espera a la persona:** propuestas, preguntas inferidas, pendientes y pospuestas, versiones en borrador y enlaces por revisar, además de lo del conocimiento. Antes solo contaba lo que venía de agentes.
4. **La readiness da «Listo» aunque haya preguntas inferidas sin confirmar**, porque FDR-DIS-001 §4 solo cuenta las pendientes y las pospuestas. El revisor de S1 lo señaló como sospecha: una inferencia de IA sin confirmar desbloquea la puerta. **Recomiendo** que las inferidas también bloqueen hasta que las confirmes. No lo he cambiado porque contradice el FDR literal y S6 prevé inferir las de bajo impacto.

**Propuestas y obsolescencia**
5. **Solo cuenta lo declarado explícitamente.** Cuentan las dependencias declaradas más las referencias explícitas del contenido (`basado_en` de una FDR). No cuenta todo el context pack de `exploration_chat`: eso reintroduciría la huella global de la v1 (principio 7).
6. **Una propuesta obsoleta pasa a «Obsoleta» en cuanto se aprueba la versión nueva, o al enviarla si ya nace obsoleta.** En un paquete, o si la dependencia es del lote, queda obsoleto el lote entero: nunca se acepta medio paquete.

**Versiones, criterios e importación**
7. **Un borrador anterior a una versión ya aprobada no se aprueba: se descarta.**
8. **Los criterios y los enlaces solo nacen con su versión.** Un criterio nuevo nunca reutiliza un código ya usado, ni siquiera uno descartado.
9. **Una importación nueva deja obsoleta la pendiente.** Quien importa (persona o CLI) queda en el evento, y el lote lo produce `system:importador@1`.

**Operación**
10. **La instancia de la v2** es el proyecto compose `demiurgo-v2` en `127.0.0.1:55433`, con un volumen con nombre. La API corre en el host, porque necesita la CLI de Claude, en el puerto 8100 por defecto. El 8000 está prohibido por configuración.
11. **Clasificador por defecto `simulado`.** Ratificar H1 encola una actualización de conocimiento por cada documento aprobado o creado. Con `DEMIURGO_CLASIFICADOR=referencia` serían más de 11 llamadas a Claude. **Recomiendo** ratificar con el simulado y lanzar la reconstrucción con referencia solo si quieres medirla.
12. **Invariante I1 frente a un superusuario de Postgres.** Los triggers protegen el diario y la autoridad, pero el rol de la aplicación es el propietario del esquema y podría desactivarlos (hallazgo I-5 de S0). **Recomiendo** roles separados (propietario de migraciones y aplicación sin DDL) antes de H2.
13. **DBOS lee variables de entorno por su cuenta** (M-9 de S0). Está aislado en la configuración, pero no se puede impedir del todo.
14. **Pendientes de ADR que ya estaban anotados:**
    - pasar a Node 26;
    - API key en lugar de la suscripción;
    - completar los spikes;
    - Hyper-V o microVM.
15. **Dominio de un registro solo con letras y guiones bajos** (sin dígitos). Así los códigos `DEC-XXX-NNN` y `AC-XXX-NNN-NN` no cambian de forma. La alternativa era ampliar todas las expresiones regulares de códigos.
16. **Relaciones de confianza media sin revisor:** quedan anotadas en la actualización y no llegan a la bandeja (ver desviación 13). **Recomiendo** configurar el revisor de referencia cuando midas la cascada con datos reales.
17. **Descartar un borrador** genera un disparo `record_version_discard` que no es un evento de autoridad, pero pasa por la misma cola para retirar lo proyectado.
18. **Sin corregir (m6 de la revisión de S2):** la taxonomía vigente es la primera aprobada por código, y aprobar una taxonomía nueva no reclasifica lo existente. Hoy solo hay TAX-001. Reclasificar todo es otro flujo y queda para S3.

## 7. Ejecuciones reales

Detalle en `docs/ejecuciones-reales/` (tabla en su README):

| Incremento | Qué | Modelo | Resultado |
|---|---|---|---|
| D0 | Spike DBOS: matar el proceso en el paso 2 | — | Recuperado: paso1=1, paso2=2, paso3=1 (8,9 s) |
| S0 | Fixtures de la CLI y acción `eco` por el bus y el motor durable | Haiku | `completed`, salida válida (3,9 s; 0,003 USD) |
| S0 | Sonda del runner aislado | — | 0 violaciones |
| S1 | Recorrido completo por la API: dos turnos de `exploration_chat`, «Aceptar y aprobar», `design_proposal`, aceptación del paquete y aprobación | Haiku | «Listo para construir» (FDR-PRO-001 con 6 AC) y bandeja vacía; 59,5 s de agente y 0,0395 USD |
| S2 | Evaluación del clasificador de referencia sobre la partición de prueba | Haiku | Veredictos: 62,9 % de exactitud (simulado: 31,4 %). Ideas: 81,8 % (simulado: 50 %). 186 s |

No se ha usado Codex.

## 8. Cómo arrancar y probar

### 8.1 Desarrollo y gates

```powershell
corepack enable              # pnpm 11.27.1 fijado en packageManager
pnpm install
pnpm db:up                   # Postgres 18.6 de desarrollo: proyecto demiurgo-v2-dev, 127.0.0.1:55432
pnpm gate:all                # tipos, lint, formato, design/, deriva, pruebas, invariantes y trazabilidad
node packages/design/src/cli.ts ac-status   # tabla del estado de cada AC (tras gate:test y gate:invariants)
```

Las pruebas crean y borran bases efímeras `dmg_t_*`, nunca usan una base en uso. Algunos comandos útiles:
- `pnpm gen`: regenera las tablas del dominio desde `design/data/*.yaml`.
- `node packages/design/src/cli.ts canonicalize`: reescribe `design/` en forma canónica.
- `npx vitest run --project integration <archivo>`: ejecuta un solo archivo de pruebas.

### 8.2 Instancia de la v2 (ya montada)

```powershell
pnpm instance:db             # Postgres de la instancia: proyecto demiurgo-v2, 127.0.0.1:55433, volumen demiurgo-v2_data
$env:DEMIURGO_DATABASE_URL = 'postgres://demiurgo:demiurgo-v2-local@127.0.0.1:55433/demiurgo_v2'
pnpm cli migrate
pnpm instance:api            # API en http://127.0.0.1:8100 (DEMIURGO_PORT para cambiarlo; el 8000 está prohibido)
```

Variables de entorno (con un nombre antiguo en español, la configuración se niega a arrancar y dice el nuevo):

| Variable | Valores | Por defecto |
|---|---|---|
| `DEMIURGO_AGENT` | `simulated`, `claude` | `simulated` |
| `DEMIURGO_AGENT_MODEL` | modelo de Claude | `haiku` |
| `DEMIURGO_CLASSIFIER` | `simulated`, `reference`, `jev` | `simulated` |
| `DEMIURGO_CLASSIFIER_MODEL` | modelo de Claude | `haiku` |
| `DEMIURGO_REVIEWER` | `none`, `reference` (revisor de la cascada para la confianza media) | `none` |
| `DEMIURGO_REVIEWER_MODEL` | modelo de Claude del revisor | `sonnet` |
| `DEMIURGO_HOST` | | `127.0.0.1` |
| `DEMIURGO_PORT` | | `8100` |
| `DEMIURGO_ORIGINS` | orígenes permitidos | |
| `DEMIURGO_SESSION_HOURS` | | `12` |

La clave de la base de la instancia se puede cambiar con `DEMIURGO_V2_DB_PASSWORD` al crearla.

Estado actual de la instancia, recreada tras pasar el código a inglés (sección 11):
- proyecto «DEMIURGO»: `01a0d478-fa55-789e-831d-33a569a835f6`;
- lote de importación de `design/`: `01a0d479-14ab-7c42-8358-852cd742c32c`, en estado `pending`, en paquete y producido por `system:importer@1`;
- contenido: 14 propuestas (13 registros y la taxonomía): 1 decisión, 7 ADR, 5 FDR, 13 versiones, 114 criterios, 12 enlaces, 1 taxonomía y 2 anexos. Incluye el ADR-WEB-001 y la FDR-INT-001 que añadió la sesión de diseño de la interfaz;
- 0 registros y 0 versiones aprobadas;
- la persona `marcos` está creada (la clave no se guarda en el repo). La API no está arrancada: arráncala con `pnpm instance:api`.

El volumen anterior (`demiurgo-v2_datos`, con el lote que había antes del paso a inglés) sigue en Docker sin usar. Se puede borrar con `docker volume rm demiurgo-v2_datos`. No se ha borrado por si quieres consultarlo.

### 8.3 Ratificar H1 (lo haces tú)

```powershell
$env:DEMIURGO_DATABASE_URL = 'postgres://demiurgo:demiurgo-v2-local@127.0.0.1:55433/demiurgo_v2'
# pnpm cli create-person <usuario>        # ya hecho para «marcos»; la clave mínima es de 12 caracteres
pnpm instance:api                         # en otra terminal

$api = 'http://127.0.0.1:8100'
$proyecto = '01a0d478-fa55-789e-831d-33a569a835f6'; $lote = '01a0d479-14ab-7c42-8358-852cd742c32c'
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$sesion = Invoke-RestMethod -Method Post "$api/api/session" -WebSession $s -ContentType 'application/json' `
  -Body (@{ username = 'marcos'; password = '<clave>' } | ConvertTo-Json)
# Revisa el lote antes de ratificar: 14 propuestas (13 registros y la taxonomía), todas pendientes.
Invoke-RestMethod "$api/api/projects/$proyecto/batches/$lote" -WebSession $s | ConvertTo-Json -Depth 6
# Ratifica en un paso (comando decisivo, solo humano; sin el token CSRF da 403).
Invoke-RestMethod -Method Post "$api/api/projects/$proyecto/commands/batch.accept_package" -WebSession $s `
  -Headers @{ 'x-demiurgo-csrf' = $sesion.csrf } -ContentType 'application/json' `
  -Body (@{ entity_id = $lote; data = @{} } | ConvertTo-Json)
pnpm cli export-design $proyecto --check design    # la exportación coincide byte a byte con design/
```

Si antes de ratificar quieres aprobar documentos, tienes dos formas:
- cambia `state: approved` en esos documentos de `design/`, vuelve a importar (`pnpm cli import-design <proyectoId> design`, que deja obsoleto el lote anterior) y ratifica el nuevo;
- o ratifica y apruébalos después en la v2 con `record_version.approve`, y regenera `design/` con `pnpm cli export-design <proyectoId> design`.

Tras ratificar, `design/` pasa a ser una exportación generada. El gate que falla si alguien lo edita a mano está fuera de H1 preparado (FDR-AUT-001, Out of scope) y se activa en un cambio aparte.

### 8.4 Canal de agentes

- **Token:** emítelo con el comando `agent_token.issue` (datos `{ "name": "claude-code" }`). El secreto `dmg_agent_…` solo se muestra una vez.
- **API:** con `Authorization: Bearer <token>`, el agente puede leer, conversar con su nombre, registrar fuentes y proponer. Todo lo demás da 403.
- **MCP:** `DEMIURGO_API_URL=http://127.0.0.1:8100 DEMIURGO_AGENT_TOKEN=… DEMIURGO_PROJECT=<uuid> node packages/mcp/src/main.ts` (stdio). Expone 11 herramientas:
  - `read_product_state`, `read_inbox`, `read_explorations`, `read_exploration`, `read_record`, `read_batch`, `read_sources`;
  - `search_knowledge` (argumento `query`);
  - `converse`, `register_source` y `propose`.
  Ninguna resuelve propuestas.

## 9. Qué necesita el frontend (sesión con Claude Design)

**Contrato.**
- `GET /api/commands`: por comando, quién puede ejecutarlo, si es decisivo y el JSON Schema de sus datos.
- `GET /api/tables`: estados, etiquetas (en inglés) y transiciones de cada entidad. Los botones deben salir de aquí, no fijarse a mano.
- `POST /api/projects/:projectId/commands/:command` con `{ entity_id?, data }`: la única vía de escritura.
- Errores con `{ error, message, reasons }`: 403 (no permitido), 404, 409 (transición inválida o guarda, con `reasons` en lenguaje de producto) y 422 (datos no válidos, con `reasons`).
- `GET /api/projects/:projectId/events/stream` (SSE con Last-Event-ID): para refrescar de forma incremental.

**Sesión.**
- `POST /api/session` con `{ username, password }` devuelve la cookie httpOnly SameSite=Strict y el `csrf`.
- Toda mutación lleva la cabecera `x-demiurgo-csrf`.
- `GET /api/session` y `DELETE /api/session` para consultarla y cerrarla.

### 9.1 Pantallas

| Pantalla | Lectura | Acciones (comandos) |
|---|---|---|
| **Estado del producto** | `GET …/state`: decisiones y diseños con versión vigente, última versión, `epistemic_status`, readiness e `implementation` («not implemented»), `ready_to_build`, exploraciones con `open_questions` y el recuento de la bandeja | Abrir el registro, abrir la bandeja |
| **Bandeja única** | `GET …/inbox`: propuestas pendientes por lote (productor, tipo de lote, resolución por elemento o en paquete, ejecución, avisos de obsolescencia, evaluación de la idea con citas), `questions_to_confirm` (inferidas), `open_questions`, `versions_to_approve`, `links_under_review`, `classifications_to_review` y `rejected_updates` | `proposal.accept` (con «Accept and approve»: `approve: true`), `proposal.accept_edited`, `proposal.reject`, `batch.accept_package`, `batch.reject_package`, `question.confirm`, `record_version.approve`, `link.keep`, `link.change`, `link.obsolete`, `classification.resolve`, `knowledge_update.retry` |
| **Exploración y conversación** | `GET …/explorations`, `GET …/explorations/:explorationId`: hilo de mensajes (autor humano, agente o ejecución; observaciones con estado epistémico), preguntas con estado y conclusión, exploraciones hijas y origen | `exploration.open`, `message.post` (con `respond`), `question.raise`/`confirm`/`postpone`/`discard`/`reopen`, `exploration.conclude`, `set_aside`, `resume`, `run.request` (`exploration_chat`, `design_proposal`) |
| **Registro con versiones** | `GET …/records/:code`: versiones (draft, approved, superseded, discarded), cuál es la vigente, secciones de la plantilla, criterios con verificación, comprobación y arrastre (new, kept, modified), enlaces con su estado, anexos, nota de cambio, autor y quién aprobó, y readiness por versión | `record.create`, `record_version.create` (arrastre explícito: mantener, modificar o descartar cada AC), `record_version.approve`, `record_version.discard` |
| **Readiness** | `GET …/versions/:versionId/readiness`: `ready`, `reasons` (en lenguaje de producto) y `warnings` de verificabilidad | — |
| **Lote** | `GET …/batches/:batchId`: productor, ejecución y context pack de procedencia, propuestas con estado epistémico y resolución | Las de la bandeja |
| **Ejecuciones** | `GET …/runs/:runId`: estado, `failure_kind`, reintento de, context pack (rol, constructor, presupuesto, versión del grafo, dependencias, contenido y hash); los eventos, en `GET …/events` | `run.retry` (mismo context pack), `run.cancel` |
| **Conocimiento** | `GET …/knowledge` (nodos y aristas vigentes, versión del grafo, frescura), `…/knowledge/search?q=`, `…/knowledge/rebuild` (huella: `live`, `rebuilt`, `equal`, `drift`) | `taxonomy.propose`, `taxonomy.approve` |
| **Fuentes** | `GET …/sources` | `source.register` |
| **Tokens de agente** | `GET …/tokens` | `agent_token.issue` (el secreto se muestra una sola vez), `agent_token.revoke` |
| **Importación y ratificación** | El lote `import` con recuentos y cada documento | `design.import`, `batch.accept_package` |

### 9.2 Estados que la UI debe mostrar

Las etiquetas vienen de `/api/tables`, ahora en inglés (Draft, Approved, Superseded, Discarded…):
- **Versión:** draft, approved, superseded, discarded.
- **Pregunta:** pending, inferred, confirmed, postponed, discarded.
- **Lote:** pending, accepted, rejected, resolved, superseded (etiqueta «Obsolete»).
- **Propuesta:** pending, accepted, accepted_edited, rejected, superseded (etiqueta «Obsolete»).
- **Enlace:** current, needs_review, kept, changed, obsolete.
- **Ejecución:** queued, running, completed, failed, cancelled, interrupted.
- **Actualización de conocimiento:** queued, classifying, verifying, applied, rejected.
- **Clasificación:** applied, pending_review, resolved.
- **Exploración:** active, concluded, set_aside.

### 9.3 Invariantes que la UI debe hacer visibles

1. **Estado epistémico en cada elemento** (`confirmed`, `proposed`, `pending` o `unknown`). Lo propuesto por un agente nunca se ve igual que lo confirmado.
2. **Quién hizo qué.** Productor de cada lote (`agent:run:<id>`, `agent:<nombre>:<token>`, `system:…`) y actor de cada evento. Lo decisivo siempre es `human:…`.
3. **Aceptar es siempre un gesto humano explícito.**
   - Los lotes de agentes externos se resuelven elemento a elemento, con un máximo de 10 por lote.
   - Los paquetes del sistema (FDR con sus AC, importación) se aceptan o rechazan enteros.
   - «Accept and approve» es una sola acción humana con dos efectos visibles.
4. **Aprobar no crea versión.**
   - La vigente es la última aprobada.
   - Una versión nueva exige una nota de cambio y decidir cada criterio (mantener, modificar o descartar).
   - Un borrador anterior a una aprobada solo se puede descartar.
5. **Readiness con sus motivos:** «Ready to build» solo si no hay `reasons`. Si los hay, se muestran tal cual (están en lenguaje de producto).
6. **Obsolescencia.**
   - Una propuesta o un paquete obsoleto se muestra como tal, con su motivo (qué registro cambió y de qué versión partía).
   - Un enlace pendiente de revisión pide mantener, cambiar u obsoleto.
7. **Errores 409 y 422 con sus `reasons`,** que son accionables: nunca un «Error» genérico. Un 403 explica que la acción es de otra persona o que el agente no puede hacerla.
8. **Aviso de verificabilidad de un AC.** Nunca bloquea: se muestra al guardarlo y en la readiness.
9. **Procedencia de una ejecución:**
   - context pack con su hash, reutilizado en el reintento;
   - `invalid_output` sin efectos;
   - interrumpida tras un reinicio.
10. **Conocimiento.**
    - Versión del grafo y frescura: una acción se rechaza si el conocimiento no está al día.
    - Las evaluaciones de ideas se muestran con la cita del nodo (duplica, contradice o relaciona).
    - Una invalidación de algo con autoridad aparece como propuesta de revisión, nunca como cambio hecho.
11. **Ratificación de H1:** los recuentos del lote frente al origen, y nada aprobado hasta ratificar.

## 10. Siguientes pasos

1. **Revisar y aceptar `design/`.** Los ADR y FDR siguen «propuestos». Decide qué documentos aprobar (sección 8.3).
2. **Ratificar H1** en la instancia (sección 8.3) y comprobar la exportación sin diff.
3. **Diseñar la FDR de S3 dentro de la v2** (AC-AUT-001-07), con agentes por el canal si quieres.
4. **Activar el gate de «`design/` generado»** en la CI: falla si `design/` difiere de la exportación.
5. **Sesión con Claude Design para el frontend** con la sección 9. Los criterios de UX de S1 quedan pendientes de esa UI.
6. **Conectar Jev** cuando esté disponible.
   - El adaptador `jev` ya tiene la interfaz de §7.5 (Choice, Score, Noul, confianza y cascada por umbrales).
   - Falta el transporte.
   - Evalúalo con `pnpm cli evaluar-clasificador prueba` contra la línea base registrada.
7. **Antes de S4:**
   - completar o aceptar los spikes reducidos;
   - decidir Hyper-V o microVM para el runner;
   - roles de base de datos separados;
   - Node 26;
   - ejecutar la CI real (push a una rama de GitHub, cuando tú decidas).
8. **Decidir las recomendaciones de la sección 6**, en especial la 4 (preguntas inferidas en la readiness) y la 12 (roles de Postgres).
9. **Reclasificar al aprobar una taxonomía nueva** (m6) y **calibrar los umbrales de la cascada** con datos reales: con confianza ≥ 0,8 la referencia acertó el 69 % de los veredictos de la partición de prueba (ver `docs/ejecuciones-reales/s2-clasificador-2026-09-24.md`).

## 11. Paso del código a inglés

Tras cerrar H1 preparado, todo el código pasó a inglés. La documentación (`docs/`, `AGENTS.md`, `CLAUDE.md`), la prosa de `design/` y los commits siguen en español (regla nueva en `AGENTS.md`).

**Qué cambió.**
- **Código:** archivos y carpetas (`comandos/` → `commands/`, `motor/` → `engine/`…), identificadores, comentarios, títulos de las pruebas (los códigos AC se conservan), mensajes de error y de readiness, etiquetas de estado y salida de las CLI.
- **API:** rutas (`/api/proyectos/:id/comandos/:comando` → `/api/projects/:projectId/commands/:command`, `/bandeja` → `/inbox`…), campos JSON (`entidad_id`/`datos` → `entity_id`/`data`, `motivos` → `reasons`…), tipos de error (`no_encontrado` → `not_found`…), herramientas MCP (`leer_bandeja` → `read_inbox`…).
- **Operación:** variables de entorno (`DEMIURGO_AGENTE` → `DEMIURGO_AGENT`…, con valores `simulated`, `reference`, `none`), órdenes de las CLI (`crear-persona` → `create-person`, `exportar-diseno` → `export-design`, `canonizar` → `canonicalize`…) y scripts de pnpm (`gate:deriva` → `gate:drift`, `gate:invariantes` → `gate:invariants`, `gate:trazabilidad` → `gate:traceability`, `instancia:*` → `instance:*`).
- **Formato de `design/`:** claves del frontmatter (`code`, `type`, `title`, `state`, `domain`, `increment`, `links`, `annexes`…), valores (`proposed`, `approved`), secciones de plantilla (Goal, Scope, Out of scope, Behavior…), «Acceptance criteria», viñetas `Verification`/`Check`/`Derived from`, y carpetas `decisions/`, `taxonomy/` y `data/`. La categoría obligatoria de cada eje pasa de `otra` a `other`.
- **Base de datos:** las tablas y columnas ya estaban en inglés. Cambian los nombres de funciones y triggers, sus mensajes, los valores de las restricciones (`impact` y `epistemic`) y el canal de NOTIFY (`demiurgo_events`). Las migraciones se editaron en su sitio, así que **una base anterior no arranca**: la instancia se recreó en un volumen nuevo (sección 8.2).

**Cómo se hizo.**
1. Un glosario de unos 2.000 nombres, propuesto por subagentes y revisado a mano, se aplicó con un script determinista sobre el AST: el mismo nombre cambia en todas partes a la vez.
2. Una comprobación semántica confirmó que cada identificador sigue apuntando a la misma declaración antes y después (0 diferencias), con 0 errores de tipos.
3. Subagentes tradujeron por archivos los comentarios, los mensajes, los prompts y las pruebas, y ejecutaron cada uno sus pruebas.
4. Seis revisores independientes buscaron cambios de comportamiento, traducciones con otro sentido y restos en español. Se corrigieron los hallazgos (nombres mal traducidos por el mapa mecánico, una regresión del cliente MCP al distinguir los 404 y pruebas que habían perdido precisión).

**Decisiones tomadas en tu nombre.**
1. **Los agentes responden en el idioma de la persona.** Los prompts están en inglés, pero no piden responder en inglés, así que el comportamiento con contenido en español no cambia. Lo mismo vale para la justificación del clasificador de referencia. Los prompts se editaron dentro de su versión 1, porque no quedaba ninguna ejecución registrada con la versión anterior.
2. **El contenido escrito por personas sigue en español en las pruebas y en los datos de evaluación.** El clasificador simulado, la normalización de texto y la búsqueda de texto completo (configuración `spanish` de Postgres) dependen de esas palabras. La normalización y las pistas del clasificador simulado admiten ahora también inglés.
3. **Los slugs de dominio son contenido** (`gobierno`, `plataforma`…). El dominio por defecto de una propuesta sin dominio sigue siendo `producto`.
4. **Los identificadores de proceso cambian:** la versión de los flujos DBOS (`demiurgo-v2-workflows-1`), el identificador del clasificador de referencia (`claude-reference:<modelo>@1`) y las huellas de entrada de la caché. Con una base nueva no afecta a nada.
5. **Registros anteriores:** las ejecuciones reales de `docs/ejecuciones-reales/` y el resultado de la evaluación del clasificador conservan sus nombres de entonces. Los README explican la equivalencia.
6. **Historial:** los commits de la traducción se hicieron como puntos de control (`wip: …`). No se reescribieron porque otra sesión estaba haciendo commits en `v2` al mismo tiempo. La etiqueta local `pre-ingles` marca el estado anterior.
