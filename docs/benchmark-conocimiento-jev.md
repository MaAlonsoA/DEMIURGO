# Benchmark de Jev para el motor de conocimiento

## Estado de esta entrega

Implementación inicial local en `v2.2`: infraestructura, rúbricas propuestas, 40 escenarios,
fichas ciegas y pruebas con respuestas simuladas. **No hay adjudicaciones humanas, llamadas reales,
configuraciones ganadoras ni evidencia comparativa. La recomendación es «evidencia insuficiente».**
No se ha activado Jev en producción ni alterado la política de autoridad.

El objetivo es comparar Jev y Jev → Qwen contra Qwen también mejorado, con prioridad en detectar
conocimiento afectado y conflictos reales. Coste o velocidad no compensan una pérdida de calidad.
Los datos sintéticos solo pueden justificar proponer un piloto real, inicialmente sin efectos,
y sujeto a resolver las condiciones de envío a TypeSafe.

## Componentes y separación de información

- `packages/domain/src/knowledge-inputs.ts`: definiciones inglesas y constructores compartidos por
  producción, evaluación histórica y benchmark. Los argumentos opcionales activan la rúbrica
  corregida. Producción conserva las entradas anteriores hasta que haya evidencia y revisión.
- `packages/domain/src/classifier.ts`: `optionDescriptions` y `rubricVersion` opcionales.
  Jev usa las descripciones como `criteria`; el clasificador por agentes las incluye en su entrada.
- `packages/core/src/benchmark/`: validación, ejecutor sin aplicación ni conexión a Postgres,
  proveedores explícitos, reproducción y métricas. No importa servicios ni ejecuta migraciones.
- `evals/knowledge/v2/scenarios.json`: información del proyecto, taxonomía, grafo de 10 nodos,
  cambio aprobado e idea sin autoridad. Ambos se evalúan contra **el mismo grafo inicial** como
  dos eventos independientes; no se adjudica implícitamente una idea contra un grafo posterior.
- `proposals.json`: 800 propuestas de juicio de pares, con etiquetas A y B, efectos y citas.
  Son borradores de IA, incluidos los juicios de «sin relación». Deben corregirse cuando proceda.
- `cards/`: las 40 fichas completas, sin etiquetas ni explicaciones propuestas. Los modelos
  reciben únicamente objetos `ItemChoice` reconstruidos por lista explícita de campos.
- `evals/knowledge/v2-legacy-es`: dos escenarios de origen y dos variantes con registros antiguos
  en español. Es un diagnóstico secundario separado; conserva familia y partición del original.
- `historical-manifest.json`: huellas de las regresiones `v1`, `v1-en` y resultados existentes.
  Los ficheros históricos no se modifican. Sus cifras no se combinan con el nuevo conjunto.

El identificador de configuración incorpora contrato, rúbrica, contexto, política, umbrales,
condición, partición, semilla y modelos solicitados. El adaptador de Qwen añade la huella de sus
opciones efectivas. Las trazas contienen commit, estado del árbol y huella de fuentes; cada llamada
Qwen guarda su prompt real y huella. No hay caché de respuestas en el nuevo ejecutor.

## Rúbricas propuestas

La fuente única en inglés es `knowledge-inputs.ts`, con una copia legible versionada en
`evals/knowledge/v2/rubrics.json`. La versión inicial lleva `draft`: las fronteras necesitan
adjudicación antes de congelarse. Los ejemplos siguientes son exclusivamente de desarrollo.

A conserva los seis veredictos y los cinco hallazgos:

- `keep`: conservar íntegramente, sin relación nueva necesaria. `relate`: conservar y registrar
  una conexión útil. `add`: extensión puramente aditiva; `update`: modificación parcial;
  `invalidate`: reemplazo completo; `other`: evidencia insuficiente o efecto no representable.
- `duplicates`: equivalencia; `conflicts`: afirmaciones incompatibles bajo iguales condiciones;
  `inconsistent`: desajuste de premisas; `relates`: conexión compatible; `none`: sin conexión
  establecida. A no tiene una abstención semántica independiente para ideas: se representa
  con `none` y confianza baja, y se informa esta limitación.

Ejemplos: añadir SMS conservando email en F01 propone `add`; sustituir un plazo de préstamo en
F02 propone `invalidate`; cambiar la sincronización conservando almacenamiento local en F03
propone `update`. La persona debe revisar las fronteras y los efectos de forma independiente.

B mantiene tres dimensiones: relación (`unrelated`, `related`, `equivalent`,
`insufficient_context`), compatibilidad (`compatible`, `direct_conflict`, `assumption_mismatch`,
`insufficient_context`) y acción (`none`, `extend`, `revise`, `replace`, `insufficient_context`).
La acción solo se pregunta para cambios aprobados. No se convierte B a etiquetas A.

La política B propone revisión para cualquier extensión, revisión o reemplazo; muestra conflicto,
desajuste o duplicado según las dimensiones y crea relaciones compatibles. Nunca reemplaza
un nodo de autoridad por decisión de un clasificador. Una idea nunca invalida nodos.
Una relación inexistente con conflicto/acción, una equivalencia incompatible, o un conflicto
con acción de extender/no cambiar son respuestas inválidas; pasan a persona. Cualquier dimensión
insuficiente se abstiene. La confianza conservadora es el mínimo de las dimensiones: **no es una
probabilidad conjunta calibrada**. La calibración semántica usa la confianza original por dimensión.

## Revisión humana ciega

```sh
pnpm benchmark:knowledge validate
pnpm benchmark:knowledge cards --output reports/knowledge/review
```

Lea cada ficha entera y rellene su `*.blank.json`. Registre categorías, ambos contratos y efectos
esperados por separado para cada nodo y cada tarea, incluidos los que parecen irrelevantes.
Use citas textuales, explique su juicio, marque `ambiguous` cuando corresponda y permita varios
valores semánticos; no fuerce una etiqueta única. Los efectos ambiguos pueden exigir `pending`.
Declare `source: "human"`, su identificador `human:<nombre>`, `reviewedAt`, y confirme expresamente
`fullGraphReviewed: true`. Mantenga `blindJudgment: null` en ese primer fichero.

Solo después de guardar el juicio ciego, consulte la propuesta:

```sh
pnpm benchmark:knowledge reveal --scenario F01-1 \
  --judgment reports/knowledge/review/F01-1.blind.json \
  --output reports/knowledge/review/F01-1.reveal.json
```

El recibo contiene la propuesta y la huella del juicio previo. Conserve ambos. En el juicio final
copie esa huella a `blindJudgment` y registre `accepted`, `corrected` o `ambiguous`. Reúna los
40 juicios finales en un array JSON independiente y páselo como `--annotations`. Este protocolo
local deja evidencia de la revisión; no constituye autenticación de identidad ni autoridad del
producto. Ningún comando convierte una propuesta de IA automáticamente en juicio humano.

`validate` informa `modelReady`; `run` exige adjudicación completa de todo el conjunto recibido.
Se rechazan citas inexistentes, juicios obsoletos, nodos sin revisar, duplicados, familias/proyectos
en distintas particiones y traducciones sin origen de la misma familia y partición.

## Preparación y ejecución

La preparación es enteramente local y no necesita anotaciones. Muestra todos los pares; la
recuperación operativa se calcula cuando se conocen las categorías.

```sh
pnpm benchmark:knowledge prepare --config evals/knowledge/v2/configs/A-qwen.json \
  --output reports/knowledge/inputs.json
```

Las seis configuraciones iniciales están en `configs/`: A/B × Qwen/Jev/cascada. No están
seleccionadas ni congeladas. `historical-qwen.json` conserva el prompt de producción actual sin
las nuevas definiciones, con política actual y trazabilidad nueva; no pretende recrear tiempos
ni respuestas pasadas. Los resultados originales siguen en el manifiesto histórico.

Antes de ejecutar, compruebe modelo, esfuerzo y ruta del fichero de OpenCode de la configuración.
Jev requiere `TYPESAFE_API_KEY` exclusivamente para `run`. El comando no carga `.env` por sí mismo.
No use contenido de un proyecto real. Las trazas contienen íntegramente el contenido enviado;
las cabeceras y claves no se copian.

```sh
pnpm benchmark:knowledge run --allow-network \
  --config evals/knowledge/v2/configs/A-qwen.json \
  --annotations reports/knowledge/adjudicated.json --output reports/knowledge/A-qwen.json
```

Cada escenario se ejecuta cinco veces, con semilla y orden registrados. `condition: controlled`
envía un par por contexto (las dimensiones de B juntas a Qwen); `operational` agrupa los pares
por evento del mismo proyecto. Jev hace una petición por dimensión mediante su adaptador actual;
esa diferencia de llamadas se mide, no se oculta. No se mezclan proyectos en llamadas.

`retrieval: isolated` suministra todos los pares, incluso versiones resueltas por código;
`production` usa exactamente los selectores, límites y recortes actuales;
`exhaustive` elimina exclusiones de criterios y recortes, conservando exclusiones estructurales
del cambio. Compare `categories: adjudicated` con `predicted` para aislar pérdidas por categoría.
El límite de 12 cambios no puede saturarse con grafos de 10 nodos: se prueba con un fixture mayor;
el límite de 8 ideas sí puede perder nodos en el piloto.

`policy: current` reproduce los efectos de A mediante `buildPlan` y el comportamiento de ideas
actual (incluidos `keep`/`none` silenciosos). `pending` retiene decisiones inciertas, también las
negativas. B siempre necesita dimensiones coherentes y suficientes. Los umbrales se ajustan por
categoría/cambio/idea en desarrollo. En cascada, confianza intermedia consulta Qwen sin mostrarle
la respuesta primaria; confianza baja/insuficiencia/fallo pasa a persona. El revisor vuelve a
validarse: confianza intermedia del revisor no implica aplicación automática.

Se guardan checkpoints antes y después de las llamadas. Respuestas ausentes, repetidas, fuera
del vocabulario, confianza inválida o errores de servicio dejan fallos explícitos y salida no
satisfactoria. Qwen registra sus reintentos y opciones efectivas; Jev desactiva reintentos del SDK
para que no haya consumo oculto. La traza registra cuerpos efectivos, respuestas, confianza,
uso, modelos resueltos, latencia y lotes. El precio observado desconocido es `null`, nunca cero.

## Reproducción e informes

```sh
pnpm benchmark:knowledge replay --annotations reports/knowledge/adjudicated.json \
  --input reports/knowledge/A-qwen.json --output reports/knowledge/A-qwen.replayed.json
pnpm benchmark:knowledge report --annotations reports/knowledge/adjudicated.json \
  --input reports/knowledge/A-qwen.json --output reports/knowledge/A-qwen.report.json
pnpm benchmark:knowledge compare --baseline reports/knowledge/A-qwen.report.json \
  --candidate reports/knowledge/B-cascade.report.json --output reports/knowledge/comparison.json
```

La reproducción verifica huellas, completitud, orden, inputs primarios y revisores y agrupación.
No llama modelos. Los fallos guardados permanecen fallos. Las pruebas simulan respuestas y
adjudicaciones únicamente dentro de fixtures, sin escribirlas al conjunto de referencia.

El informe incluye exactitud, macro-F1, sensibilidad y matriz por clase/tarea/dimensión, fallos,
fiabilidad/ECE, cobertura–error, abstenciones, categorías predichas y aplicadas, recuperación,
causa de omisiones, recortes, efectos incorrectos, alertas/revisiones innecesarias, carga pendiente,
llamadas, consumo y p50/p95. Los ambiguos se separan de exactitud de etiqueta única.

Denominadores:

- Omisión primaria: proporción de pares relevantes con al menos un efecto necesario ausente;
  también se informa la proporción de efectos omitidos. Todo el grafo adjudicado participa.
  Un aviso genérico `pending` no cuenta como detectar un conflicto ni como revisión específica.
- Error automático primario: pares con al menos un efecto automático incorrecto sobre todos
  los pares elegibles; se acompaña del error entre efectos emitidos y su cobertura. Conservar
  incorrectamente conocimiento también es un error si fue una decisión aplicada del modelo.
- Revisión innecesaria: pares enviados a revisión/persona sin que la referencia requiera revisión
  o abstención, sobre todos los pares elegibles. También se informa el total para carga operativa.
- Las invalidaciones por precedencia estructural se identifican y se excluyen de la comparación
  de modelos; su ejecución se verifica por código. Una propuesta nunca modifica autoridad.

Los IC95 % son bootstrap pareado por familia (10.000 remuestreos, semilla registrada), promediando
primero todas sus variantes y repeticiones. La estimación comparativa pondera familias por igual;
las cifras descriptivas agregadas ponderan pares. McNemar es solo diagnóstico de A y avisa de la
dependencia. Con pocas familias o ausencia total de discordancias, el bootstrap puede degenerar:
un intervalo puntual no demuestra no inferioridad. No se emite un candidato automáticamente.

## Etapas pendientes y confirmación

1. Adjudicar el piloto antes de llamar modelos. Los 40 escenarios completos son material de
   desarrollo del benchmark, aunque 16 permitan selección en validación. Resolver ambigüedades.
2. Ajustar prompts, recuperación y umbrales exclusivamente en desarrollo; las modificaciones de
   recuperación deben ser iguales para todos los motores. Elegir en validación una opción Jev
   y el mejor Qwen: omisiones, efectos incorrectos, revisiones innecesarias y simplicidad, por ese
   orden. Examinar resultados por tarea y clase; no habilitar usos sin cobertura suficiente.
3. Con discordancia y dependencia empíricas, calcular antes un tamaño confirmatorio. `plan-size`
   acepta `discordance`, `targetImprovement`, `designEffect` y `sourceReportHashes` en `--input`,
   y produce una **aproximación para planificación**, con potencia 80 %, margen fijo 0,02 y
   contraste pareado. Sin discordancia estimable devuelve evidencia insuficiente. Use el máximo
   exigido entre los tres criterios y someta el cálculo a revisión; no invente parámetros.
   La dependencia debe estimarse con familias completas, no contando repeticiones como casos.
4. La persona congela un protocolo que registre: huellas de configuraciones/modelos/opciones/
   prompts, tareas habilitadas, métricas y denominadores anteriores, selección del mejor Qwen,
   umbrales, estimaciones de discordancia/dependencia, tamaño y familias requeridos, método de
   intervalos en el límite, fecha de congelación y exclusión de todos los proyectos/familias piloto.
   No hay configuración congelada ni tamaño numérico en esta entrega porque faltan observaciones.
5. Crear y adjudicar un conjunto independiente después de congelar, sin ver respuestas. Una
   comparación principal; sin ajustar umbrales ni ampliar el test tras mirar los resultados.
   Requiere reducción significativa de omisiones y límite superior del empeoramiento <0,02 en
   ambos efectos incorrectos y revisiones innecesarias, sin cambios automáticos sobre autoridad.
   El margen puede exigir miles de casos y no se relajará.
6. Resultados permitidos: **candidato para piloto**, **sin ventaja demostrada** o **evidencia
   insuficiente**. El comparador de esta entrega es diagnóstico y devuelve el último: aún no
   hay adjudicación, selección ni congelación. La decisión confirmatoria y cualquier activación
   de producción quedan para esas etapas explícitas. Un candidato se entregaría versionado,
   desactivado por defecto, con vuelta inmediata a Qwen y piloto real inicial sin efectos.

## Verificación local

Las pruebas cubren separación de verdad e inputs, paridad de adaptadores, fallos, familias,
recuperación/recortes, cascada, dimensiones contradictorias, precedencia y autoridad, métricas
con resultados conocidos y reproducción idéntica. Las pruebas de integración usan únicamente
bases efímeras `dmg_t_*`. Para los gates del repositorio debe estar disponible
`DEMIURGO_TEST_DB_URL` del entorno local, sin imprimir su valor.
