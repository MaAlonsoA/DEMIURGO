# DEMIURGO: visión y diseño del producto

Documento vivo de trabajo · actualizado el 30 de septiembre de 2026

Este es el único documento de diseño de DEMIURGO. Lo ampliaremos y corregiremos juntos, manteniendo una lectura coherente sin cadenas de documentos ni registros de decisiones separados. Recoge los acuerdos actuales; las hipótesis, propuestas y cuestiones pendientes se identifican expresamente.

### Cómo trabajamos esta visión

Este Markdown es la fuente de verdad. Su representación para lectura y revisión será `VISION.html`: un único documento visual autocontenido, que se pueda abrir sin instalación ni conexión. Son dos representaciones del mismo documento de diseño, no dos especificaciones independientes.

El usuario leerá el HTML y propondrá cambios sobre sus representaciones visuales cuando retomemos esa presentación. Por ahora el HTML queda congelado: trabajaremos directamente en este Markdown y no actualizaremos la vista visual hasta que se decida reanudarla. Los diagramas, recorridos y comparaciones explicarán las decisiones; el texto extenso quedará como detalle opcional. Lo acordado, las hipótesis, las propuestas y las cuestiones abiertas se distinguirán también en la futura presentación visual.

El trabajo se limita a la visión del producto. Las representaciones ilustran conceptos y consecuencias; no fijan por sí mismas las pantallas, la arquitectura ni el alcance de la primera versión. La implementación y actualización del HTML se delegará en subagentes de un modelo económico, como Luna.

En esta revisión, por instrucción expresa, se modifica solo este Markdown; la representación HTML queda intacta.

## 1. Visión y destinatarios

**DEMIURGO permite a una persona o equipo transformar una idea en una aplicación con calidad de producción mediante una experiencia web visual, intuitiva y guiada, sin exigir conocimientos de programación. Conserva y conecta todo el conocimiento del producto y gobierna su diseño e implementación mediante etapas definidas y resultados verificables.**

Está especialmente pensado para el vibecoding: crear software expresando intenciones, explorando propuestas y dirigiendo el trabajo de la IA. Su usuario central puede no haber trabajado nunca con código. También debe servir a desarrolladores y equipos, sin convertir sus conocimientos técnicos en un requisito de uso.

El usuario dirige y revisa: aporta intención, necesidades y preferencias, toma decisiones de producto y evalúa resultados. DEMIURGO aporta el método, prepara propuestas, realiza el trabajo técnico y reúne las evidencias necesarias para comprobarlo. La persona no tiene que aprender a coordinar agentes ni asumir la detección de fallos técnicos que el sistema debe comprobar.

DEMIURGO no es un nuevo IDE. Su experiencia se organiza alrededor del producto que se quiere crear. La ambición es que sea la única herramienta que una persona o equipo necesite utilizar para crear y evolucionar una aplicación. Puede apoyarse en servicios externos, pero el recorrido debe poder completarse desde DEMIURGO.

El alcance completo comprende explorar una idea, entender usuarios y dolores, diseñar la aplicación completa, crear y organizar tareas, implementar, verificar, entregar, observar el funcionamiento y gestionar mejoras. DEMIURGO propone agrupaciones coherentes de capacidades y tareas que el usuario puede validar, incluso procedentes de varias exploraciones. La observabilidad incluye tanto el trabajo de la IA como la aplicación resultante. La meta posterior es recorrer ese ciclo hasta una aplicación entregada para uso real en el formato que corresponda al proyecto, con posibilidad de evaluarla y corregirla desde DEMIURGO. Para una aplicación web eso puede requerir despliegue y hosting; para un juego en Python, ejecución o distribución de otro tipo. La visión no se limita a un sector ni a una plataforma de aplicaciones.

La estrategia de evolución acordada es construir primero una **versión funcional mínima centrada en el copiloto de diseño** y utilizarla para crear **un proyecto nuevo** que dé lugar a una versión posterior y más completa de DEMIURGO. Esta primera versión debe servir de verdad para explorar ideas, formular y organizar preguntas, conservar respuestas y razones, crear y revisar artefactos de diseño vinculados, derivar trabajo trazable y recuperar el contexto para seguir diseñando. Su interfaz debe permitir gestionar ese conocimiento sin depender de un único chat y un único documento lineal. La implementación del software diseñado puede coordinarse manualmente en esta etapa; la orquestación automática de agentes no es requisito para empezar a construir DEMIURGO con DEMIURGO. Desde finales de septiembre esa estrategia está en marcha: la versión actual (v2.3, que se parchea en caliente) se usa para diseñar dentro de la propia aplicación la versión productiva (v3), y lo que echa en falta se anota como parche o como idea para la v3.

El proyecto nuevo parte del conocimiento y las razones acumuladas en el primero, conservando su procedencia; no hereda automáticamente tareas terminadas, comprobaciones ni evidencias, porque se referían a otro código y otro resultado evaluable. Ese uso sobre sí mismo será una prueba importante del bucle de valor, no la única evidencia de calidad. DEMIURGO mínimo debe estar disponible para uso real como herramienta de diseño, aunque todavía no construya ni despliegue por sí mismo las aplicaciones diseñadas. Las funciones mínimas exactas de esa interfaz, la transferencia de contexto entre proyectos y las condiciones para considerar lograda la reconstrucción siguen por definir. La incorporación de aplicaciones existentes es otra capacidad pendiente, no una condición de esta reconstrucción.

La calidad de producción es un objetivo de diseño e implementación que exige evidencias: utilidad, coherencia de la experiencia, accesibilidad, funcionamiento, seguridad, mantenibilidad y capacidad de operar el resultado. **No se podrá afirmar que una aplicación concreta tiene calidad de producción** hasta definir para ella condiciones medibles, comprobarlas sobre un resultado evaluable identificado y verificar el entorno en que se entrega. Los umbrales mínimos, las excepciones admisibles y quién acepta el riesgo siguen sin definirse; una valoración favorable de la IA no constituye por sí sola una comprobación suficiente.

## 2. Dolores que resolvemos

### Dolores identificados

El vibecoder acaba actuando como memoria y coordinador de un proceso que exige demasiada atención. Debe recordar qué pidió, reconstruir decisiones, aportar contexto repetidamente, detectar desviaciones y comprobar resultados que pueden superar sus conocimientos técnicos.

| Dolor | Consecuencia para el usuario |
| --- | --- |
| Ideas enterradas en conversaciones interminables | Se pierden posibilidades y cuesta retomarlas. |
| Pérdida de contexto y desviación progresiva del propósito, o drift | Lo construido se aleja de la intención y contradice decisiones anteriores. |
| Documentación extensa, ADR difíciles de leer y referencias de un documento a otro | Comprender el proyecto se convierte en una tarea que termina abandonándose. |
| Decisiones y razones dispersas | No se entiende qué está acordado, qué sigue abierto ni por qué existe una solución. |
| Supervisión constante de la IA | El avance depende de la energía del usuario para reconducir el trabajo. |
| Dependencia de la terminal y de herramientas separadas | Se interrumpe el recorrido y aparecen barreras para personas no técnicas. |
| Resultados sin evidencias suficientes de calidad | Es difícil saber si la aplicación es coherente, segura y mantenible. |
| Correcciones que no se convierten en aprendizaje | Se repiten errores, se rehace trabajo y se consumen recursos sin mejorar el proceso. |

Estos dolores recogen la experiencia expresada, no mediciones de su frecuencia ni causas demostradas para todos los casos.

### Nuevos dolores por validar

Son hipótesis de diseño, todavía no conclusiones:

- Una persona sin conocimientos técnicos puede aprobar una propuesta que no comprende porque no ve sus consecuencias ni puede evaluarla de forma tangible.
- Un proceso guiado puede volverse agotador si exige demasiadas preguntas, aprobaciones o pasos que el sistema podría resolver.
- En un equipo, la falta de una visión compartida puede producir decisiones incompatibles o dudas sobre quién debe intervenir.
- Tras entregar una aplicación, el usuario puede no saber interpretar una incidencia ni decidir cómo resolverla desde su impacto en el producto.

## 3. Experiencia del usuario

**La experiencia del usuario es un pilar del producto y su atención es un recurso que debemos proteger.** DEMIURGO debe ser visual, bonito, intuitivo y centrado en lo fundamental. Cada pantalla, pregunta y notificación debe justificar la atención que pide.

### Foco y decisiones manejables

El usuario debe entender qué está resolviendo ahora, por qué importa, qué está decidido, qué falta y cuál es el siguiente paso. La información necesaria aparece primero; el detalle y las evidencias se pueden consultar sin que su lectura sea obligatoria para orientarse.

Las decisiones se presentan con propuestas concretas, consecuencias comprensibles y una recomendación fundamentada cuando corresponda. Las cuestiones técnicas que necesiten intervención humana se traducen a efectos sobre el producto, sus limitaciones, costes o funcionamiento.

DEMIURGO investiga, prepara y comprueba lo que pueda. Reserva la atención humana para intención, preferencias, decisiones relevantes y revisión de resultados. El método debe sostener el trabajo sin convertirse en un formulario interminable.

### Todo el conocimiento vive en DEMIURGO

Ideas, dolores, necesidades, diseños, decisiones, tareas, resultados y comprobaciones permanecen accesibles y conectados dentro de la aplicación. El usuario debe poder entender el porqué de una parte del producto sin recorrer una cadena de documentos.

La conversación sirve para explorar y expresar intención, pero la información relevante no puede existir únicamente en mensajes. El mapa de conocimiento del proyecto conecta ideas, preguntas, decisiones, sus motivos, diseños, tareas y evidencias. Se alimenta durante la exploración y aporta el contexto pertinente para futuras iteraciones. Debe poder consultarse, revisarse y modificarse mediante una experiencia web interactiva; su representación visual concreta sigue abierta. Presentar documentos como tarjetas no resuelve por sí solo este problema.

Debe distinguirse lo confirmado, lo propuesto, lo pendiente y lo desconocido. Las interpretaciones de la IA se identifican como tales. Las decisiones conservan sus razones y, cuando cambian, debe poder entenderse qué cambió y qué necesita revisarse.

### Explorar y revisar sin perder el rumbo

Una idea nueva se puede capturar y retomar sin abandonar el asunto activo ni darla por aceptada. Sus relaciones con lo conocido deben ayudar a reconocer duplicidades, contradicciones y oportunidades.

La revisión se apoya en resultados tangibles: pantallas, recorridos, prototipos y comportamientos que se puedan explorar, además de explicaciones. El usuario comprueba si la propuesta responde a sus necesidades y pide cambios con su propio lenguaje.

Volver sobre una decisión forma parte del proceso. DEMIURGO debe mostrar sus consecuencias y guiar la revisión del trabajo afectado, conservando el contexto y los avances válidos.

### Conversaciones, tarjetas y ramas de exploración

La persona plantea la aplicación en una conversación inicial. DEMIURGO orquesta el diseño: pregunta lo esencial mediante tarjetas etiquetadas, cada una con su pregunta, el motivo por el que aparece, su estado y una conversación propia. La persona puede profundizar en una tarjeta sin perder la orientación sobre la conversación de origen ni las demás preguntas. Las tarjetas son unidades de exploración, no decisiones aceptadas por el mero hecho de existir.

DEMIURGO cierra automáticamente una tarjeta cuando considera que tiene información suficiente y muestra su conclusión y razonamiento. El usuario puede corregirla o reabrirla. El cierre es revisable y no convierte una conclusión inferida en una decisión confirmada por la persona: el origen y el grado de confirmación permanecen visibles.

El usuario también puede posponer una pregunta, dejando constancia de que sigue pendiente, o descartarla por no corresponder. Son acciones distintas y trazables; se conserva el motivo cuando se conoce, sin inventarlo. Cuando las preguntas de una ronda quedan resueltas, pospuestas o descartadas, DEMIURGO integra una síntesis en la conversación de origen, con enlaces a las tarjetas, sus conclusiones, razones y estados. Integrar una ronda no equivale a haber resuelto sus preguntas pospuestas ni autoriza por sí mismo la construcción.

La exploración continúa como un bucle. Nuevas ideas, funcionalidades o divagaciones pueden generar ramas propias detectadas por DEMIURGO, con sus preguntas y conversaciones. Las ramas conservan su origen y pueden generar otras ramas. Sus resultados vuelven al contexto de origen y al mapa de conocimiento, que se utiliza para orientar la siguiente exploración. Este funcionamiento sirve tanto al inicio de una aplicación como durante su evolución.

Si una rama produce una conclusión incompatible con una decisión vigente y no existe una instrucción explícita de cambiarla, DEMIURGO abre una pregunta: explica el conflicto y propone cómo resolverlo. La decisión anterior permanece vigente mientras se aclara; una integración no puede presentar esa contradicción como un acuerdo resuelto. Reabrir una tarjeta ya integrada conserva el resultado anterior y señala las conclusiones relacionadas que necesitan revisión.

### Decisiones con historia y trabajo trazable

Cada decisión conserva una identidad estable, una versión vigente y las versiones anteriores. Si cambia la respuesta a la misma cuestión, se actualiza ese registro; una cuestión con sentido propio puede dar lugar a otra decisión relacionada. El historial de cambios recoge qué cambió, cuándo, por qué y qué conversación o tarjeta lo originó, distinguiendo las conclusiones de DEMIURGO de las confirmaciones humanas.

Se conserva el contenido anterior además del historial resumido. La trazabilidad debe permitir reconstruir en cualquier momento la toma de decisiones: preguntas de origen, alternativas consideradas, motivos, relaciones con otras decisiones y cambios posteriores. El usuario consulta primero lo vigente y puede profundizar en su historia sin recorrer documentos separados.

Las tareas y los resultados se vinculan a las versiones de las decisiones que los justificaron. Un cambio permite identificar trabajo afectado y correcciones necesarias sin reescribir el fundamento histórico de lo ya realizado. Decisión vigente y comportamiento implementado son estados distintos: puede haberse acordado un cambio que todavía esté pendiente de aplicar.

Ejemplo ilustrativo, no requisito de DEMIURGO: el registro «Usuarios» de una aplicación para una asociación empieza permitiendo solo miembros, porque sus actividades son internas. Una exploración posterior sobre actividades abiertas modifica el mismo registro para admitir miembros e invitados. Se conserva la versión anterior, la razón del cambio y su conversación de origen; el trabajo existente sigue ligado a la versión inicial y se hace visible lo pendiente para admitir invitados.

### Modelo de artefactos y plantillas de trabajo

El diseño sigue una jerarquía acordada (30-09-2026), en la que cada nivel se basa en el anterior: **definición del producto (DEF) → épica (EPC) → funcionalidad (FDR) → decisión de arquitectura (ADR) → construcción y evidencia**. La épica solo existe cuando una capacidad de la primera versión no cabe en una funcionalidad: fija su objetivo y sus funcionalidades en orden, y crece por versiones. Una funcionalidad se basa en su épica o en la definición; una decisión, en una funcionalidad o en una restricción u objetivo de la definición. Una propuesta no es un nivel: es la manera en que llega cualquier cosa. Las funcionalidades van antes que las decisiones: no se decide sin algo en lo que basarse. Son registros conectados, no documentos que haya que crear en cadena. Cada FDR es una funcionalidad pequeña (véase «Como lo haría un equipo profesional»); el ADR conserva las decisiones de arquitectura con alternativas y consecuencias relevantes. No toda tarea requiere un ADR, y una regla técnica nueva no se decide implícitamente al redactar un FDR.

Regla de fondo: **el modelo propone, el sistema dispone y la persona decide.** Ninguna salida de la IA cambia por sí sola algo aprobado. Lo que DEMIURGO guarda como registro va siempre en inglés, para tener un solo idioma de búsqueda, glosario y código; la persona lo lee en su idioma con una traducción de lectura marcada, que nunca es autoridad, y la interfaz se muestra en su idioma.

En pantalla se usa un vocabulario mínimo: un solo nombre por cosa más una etiqueta. Todo empieza como **propuesta**; si la persona la acepta, sigue trabajándose (**propuesta aceptada**); al aprobarla pasa a **registro** aprobado. La etiqueta (Producto, Funcionalidad, Calidad, Arquitectura, Seguridad, Producción, Épica) la decide el propio texto de la propuesta. El origen se muestra como «En qué se basa» (enlaces), no como quién lo produjo.

Cada registro de diseño mantiene, como campos comunes, un identificador estable, título, versión, estado de diseño, origen, responsable/confirmación cuando corresponda, contenido, relaciones tipadas con identificadores y versiones concretas, y una nota de cambio que explica qué cambió, cuándo, por qué y desde qué origen. El estado de implementación/verificación se conserva aparte del estado de aprobación del diseño. El historial conserva el contenido anterior. Las plantillas siguientes son un modelo inicial para validar; los campos condicionales se usan solo cuando aplican. La interfaz y el formato visual no se definen aquí.

| Registro o entidad | Plantilla mínima de trabajo | Relaciones y condición |
| --- | --- | --- |
| **Exploración y tarjeta** | Intención/origen; pregunta y motivo; alternativas o contexto; conclusión y razonamiento; estado (pendiente, resuelta inferida, confirmada, pospuesta o descartada); grado de confirmación; conflicto o pregunta de seguimiento, si aplica. | La rama conserva el origen; sus resultados regresan a la exploración y al mapa de conocimiento. Posponer no resuelve ni autoriza ejecución. |
| **Definición del producto (DEF)** | Propósito confirmado por la persona (qué trabajo resuelve, resultados observables y principios), usuarios, problema, funcionalidades de la primera versión, fuera de alcance, restricciones, metas de calidad medibles y principios de arquitectura y seguridad. | Vive en la página Producto y es la base de todo lo demás. Sus cambios son versiones con qué cambió, por qué y qué funcionalidades afecta. |
| **Épica (EPC)** | Objetivo, criterio de terminado, fuera de alcance, estado y funcionalidades en el orden que decide la persona. | Solo cuando una capacidad no cabe en una funcionalidad. Sus funcionalidades son registros desde que se listan. Está lista para construir cuando todas tienen su diseño aprobado. |
| **Decisión de producto** | Cuestión; versión y respuesta; alternativas consideradas; razones; consecuencias y alcance; origen; grado de confirmación; cambio respecto a la versión anterior. | Tiene identidad e historial propios y se enlaza con los FDR afectados. Ejemplo: quién puede participar; no es una decisión de arquitectura. |
| **ADR — Architecture Decision Record** | Contexto/problema de arquitectura; restricciones; alternativas; decisión elegida y por qué; consecuencias y límites; origen y versión; AC canónicos para verificar la decisión cuando aplique; elementos afectados. | Se crea solo si existe una decisión de arquitectura con alternativas y consecuencias relevantes. Enlaza, no sustituye, decisiones de producto ni FDR. |
| **FDR — Functional Design Record (funcionalidad)** | Dominio; resultado esperado; actores y permisos; comportamiento como flujo principal de un caso de uso en 4 a 7 pasos numerados; AC en formato Dado/Cuando/Entonces, cada uno ligado al paso que comprueba (ningún paso sin criterio); reglas, errores y límites; datos, contratos e interfaces cuando sean necesarios; decisiones y ADR relacionados; cuestiones abiertas. | Una funcionalidad es una historia pequeña: como máximo 8 criterios; si no cabe, se divide. Sus secciones de experiencia y detalle técnico se completan según necesidad. Requisitos concretos pueden expresarse como elementos trazables dentro del FDR; una restricción que afecta varios FDR puede conservarse como elemento transversal. No se crean documentos paralelos de requisitos o diseño detallado por defecto. |
| **Criterio de aceptación (AC)** | ID canónico; regla verificable en términos observables; origen exacto (registro y versión); estado/cobertura; tareas relacionadas; comprobaciones y evidencias para versiones concretas. | Vive en su funcionalidad (no en la tarea) y puede cubrirse con varias tareas. Se referencia el AC por ID; no se mantienen copias que diverjan. Cada tarea dice qué criterios cubre y cada AC de alcance comprometido tiene trabajo asociado. Los AC automáticos tienen una prueba cuyo título empieza por su código. |
| **Tarea (TSK)** | ID; objetivo y alcance; tamaño (XS a XL, que solo cambia una persona); qué criterios de su funcionalidad cubre; dependencias; funcionalidad aprobada en la que se basa; estado; evidencias. | Es una subtarea de la funcionalidad: un trozo de implementación, con rama y pull request al construirla. Los criterios no son propios de la tarea. Estar lista o aprobada no implica autorizar su ejecución. |
| **Change Set** (nombre de trabajo; en la v2.3 el conjunto que se entrega es la épica, véase más abajo) | Identidad y nombre de trabajo estables; resultado esperado; alcance incluido/excluido; motivo y exploraciones de origen; FDR y tareas agrupadas; dependencias; criterios/evidencias de conjunto; estado e historial. | Agrupa trabajo de una o varias exploraciones sin fusionar sus orígenes. Se distinguen aprobación del alcance y aceptación del resultado verificado. El catálogo/transición de estados sigue siendo propuesta. |
| **Resultado evaluable** | Referencia a la revisión de código, identificador del build o paquete, configuración pertinente, entorno donde se ejecutó y, cuando exista, despliegue accesible. | Identifica qué versión de la aplicación se construyó y se comprobó. Es una referencia del producto generado, no un documento de diseño adicional. El modo de alojarla y entregarla sigue por decidir. |
| **Comprobación y evidencia** | AC y versión objetivo; tarea/trabajo y resultado evaluable exacto; método y condiciones; resultado; evidencia observable; anomalías o excepciones; fecha cuando exista. | Una relación o enlace aislado no demuestra cumplimiento. La evidencia respalda el AC para el build y entorno comprobados; no demuestra automáticamente que otro despliegue cumpla lo mismo. |

El recorrido de trazabilidad es **exploración → decisión/requisito → FDR ↔ ADR cuando haya una decisión de arquitectura → AC ↔ tareas → comprobaciones → evidencias**. Las relaciones son de muchos a muchos y cada fuente permanece identificable y versionada; los artefactos posteriores referencian y concretan la fuente, sin copiar reglas de manera independiente. La revisión debe valorar cobertura, justificación y cumplimiento, además de la calidad de requisitos y pruebas; una red de enlaces por sí sola no garantiza que esté completa.

Cada versión comprometida de FDR o ADR mantiene AC propios y verificables para su nivel cuando correspondan: comportamiento y diseño de la capacidad, o decisión de arquitectura. Estos AC se relacionan con tareas y evidencias; no se exige generar trabajo para un registro que sigue en exploración o no está comprometido.

**Definición de trabajo de «comprometido»:** un AC y la versión de FDR o ADR que lo contiene entran en el alcance aceptado de un Change Set concreto. Antes son propuestas revisables, no trabajo prometido. La aprobación del alcance no equivale a aprobar cada tarjeta, registro o tarea por separado. Para FDR y ADR se propone distinguir un estado de diseño (*borrador, aprobado, sustituido*) de un estado de realización (*sin implementar, en curso, verificado*) por versión; el cierre verificado exige evidencias del resultado evaluable exacto. Las transiciones y quién puede aprobarlas siguen pendientes.

#### Convención de identificadores del ejemplo

Los códigos hacen posible enlazar y versionar el conocimiento, pero no son títulos para mostrar a la persona. Primero se presenta «Inscripción inmediata» o «Catálogo de actividades»; el identificador queda como referencia consultable. Esta convención describe **los ejemplos de esta visión**, no fija todavía el formato técnico definitivo de DEMIURGO.

| Código | Qué identifica |
| --- | --- |
| `EXP` | Una exploración o conversación de origen. |
| `Q` | Una tarjeta de pregunta dentro de una exploración. |
| `DEC` | Una decisión de producto con respuesta y motivos. |
| `ADR` | Un registro de decisión de arquitectura. |
| `FDR` | Un registro de diseño funcional de una capacidad. |
| `AC` | Un criterio de aceptación verificable. |
| `T` | Una tarea concreta. |
| `CS` | Un Change Set que agrupa trabajo coherente. |

En la v2.3 los códigos reales son `DEF` (definición), `EPC` (épica), `FDR`, `ADR` y `TSK` (tarea), por ejemplo `DEF-PRO-001`, `EPC-GUI-001`, `FDR-GUI-005` y `TSK-BUI-012`.

En `DEC-USU-001 v1`, `USU` indica el dominio Usuarios, `001` distingue ese registro de otros y `v1` es su primera versión. En los ejemplos, `ACT` significa Actividades e `INS`, Inscripciones. El número no indica prioridad ni orden obligatorio de ejecución. El identificador permanece estable entre versiones; los enlaces a decisiones y diseños señalan la versión concreta que los justificó.

#### Mínimo necesario antes de implementar

**Propuesta para evitar proliferación de artefactos:** DEMIURGO no crea automáticamente un registro de cada tipo ni exige completar una cadena documental antes de escribir código. Para trabajo comprometido necesita un origen entendible, el comportamiento esperado expresado en uno o varios FDR con AC verificables, tareas justificadas y un alcance de trabajo revisable. Las respuestas a tarjetas pueden permanecer en su exploración; se promueven a decisiones de producto separadas si establecen una regla duradera o una elección con consecuencias que conviene reconstruir.

Un ADR aparece si hay una elección de arquitectura con alternativas y consecuencias relevantes. El FDR incorpora el detalle de UI/UX, datos o contratos que haga falta para implementar y comprobar su capacidad; no se crea un DDR aparte. Los AC son elementos dentro de los registros, no documentos adicionales. Las tareas pueden cubrir varios AC y un AC puede requerir varias tareas. La comprobación y la evidencia se producen al verificar el resultado, no como trámite previo al código. La profundidad se amplía cuando una pregunta, riesgo o cambio lo justifica, manteniendo la obligación de cubrir y verificar los AC del alcance comprometido antes de declarar completa la implementación.

### Clasificación y aceptación de tareas

Cada tarea tendrá categorías, un tamaño y los criterios de aceptación de su funcionalidad que cubre. Se propone separar dos dimensiones de clasificación, permitiendo varias etiquetas cuando corresponda:

- **Área técnica:** frontend, backend, BBDD u otras por concretar; describe dónde se realiza el trabajo.
- **Dominio funcional:** usuarios, actividades, inscripciones u otros propios del proyecto; describe qué parte del producto afecta.

Estas dimensiones permiten ver, por ejemplo, todo el trabajo de «Usuarios» o todo el trabajo de «Backend» sin mezclarlos en una clasificación excluyente. Las etiquetas agrupan y filtran; los enlaces entre artefactos explican la dependencia y el impacto. La taxonomía y quién confirma su clasificación siguen pendientes.

Los criterios de aceptación describen condiciones observables para dar por válida una funcionalidad y, con ella, sus tareas; no son la lista de pasos para implementarla. Deben conservar su vínculo identificable con la regla y versión de origen y con la evidencia de cada comprobación. Una tarea puede cubrir solo parte de una funcionalidad: también se revisa el recorrido completo del conjunto que se entrega, porque superar comprobaciones aisladas no demuestra por sí solo el resultado conjunto.

### Cierre de diseño e implementación por versión

La aprobación de una versión de diseño y la finalización verificada de su implementación son estados distintos. Un registro no se declara completo si alguno de sus criterios de aceptación comprometidos carece de tareas asociadas, si queda trabajo necesario incompleto o si falta evidencia satisfactoria. Marcar tareas como terminadas no demuestra por sí mismo que se cumplan sus criterios.

Durante la exploración, un criterio que aún no tenga trabajo asociado se muestra explícitamente sin cobertura; no permite cerrar como completo el registro de esa versión. Al cambiar una decisión o especificación se conserva la historia y se revisa si el alcance y las evidencias anteriores siguen siendo válidos. La nueva versión no hereda automáticamente un cierre ni evidencia de la anterior.

### Simulación de una aplicación desde su idea inicial

**Caso de prueba del modelo, no requisitos de DEMIURGO ni decisiones reales de una asociación.** La persona plantea: «Queremos una aplicación para publicar las actividades de nuestra asociación y que los socios puedan apuntarse». En esta simulación se ha confirmado que la aplicación inicial permite publicar actividades e inscribir socios, sin invitados, y que la inscripción es inmediata. DEMIURGO tendría que registrar esas respuestas con su origen y separar las cuestiones aún no respondidas.

Los códigos entre paréntesis siguen la convención documentada arriba; **la persona debería ver primero nombres comprensibles**.

| Origen | Pregunta o conclusión de la exploración | Resultado confirmado para el caso simulado |
| --- | --- | --- |
| Conversación inicial (`EXP-001`) | ¿Quién publica, quién puede apuntarse y para qué necesita la asociación la aplicación? | Una persona de la organización publica actividades; los socios las consultan y se inscriben; la organización necesita conocer las inscripciones. |
| Tarjeta «participantes» (`Q-001`) | ¿Puede inscribirse cualquier persona? | Solo socios, porque las actividades iniciales son internas. Se registra «Solo socios pueden inscribirse» (`DEC-USU-001 v1`). |
| Tarjeta «inscripción» (`Q-002`) | ¿La inscripción requiere aprobación? | No: un socio confirma su plaza directamente. Se registra «Inscripción inmediata» (`DEC-INS-001 v1`). |

Las dos decisiones de producto conservan pregunta, alternativas, motivo, confirmación y origen. «Solo socios pueden inscribirse» decide **quién** participa; el FDR concreta el comportamiento observable. «Inscripción inmediata» decide la ausencia de aprobación; tampoco prescribe pantallas ni persistencia. Sus respuestas están confirmadas para esta simulación; el resto del diseño no se considera aprobado por ello.

| Registro de diseño propuesto | Contenido mínimo ilustrativo | Criterio propio que permitiría verificarlo |
| --- | --- | --- |
| «Catálogo de actividades» (`FDR-ACT-001 v1`) · dominio Actividades | Una persona de la organización publica una actividad con título y fecha; los socios consultan las publicadas. Publicar y consultar se agrupan aquí en una capacidad coherente, por elección de quien plantea el caso. Nace de la conversación inicial. | `AC-ACT-01`: la organización puede publicar una actividad con título y fecha. `AC-ACT-02`: una actividad publicada aparece a los socios; una no publicada no aparece. |
| «Inscribirse en una actividad» (`FDR-INS-001 v1`) · dominio Inscripciones | Un socio puede confirmar su inscripción; quien no es socio no puede hacerlo; la misma persona no puede duplicar su inscripción. El FDR incluye la experiencia: estado visible «inscrito» tras el éxito y mensaje recuperable si falla; y, cuando haga falta, la relación socio–actividad y el tratamiento de solicitudes repetidas. Desarrolla las decisiones «Solo socios» e «Inscripción inmediata». | `AC-INS-01`: solo un socio puede completar la inscripción. `AC-INS-02`: repetirla no crea una segunda inscripción para el mismo socio y actividad. `AC-INS-03`: tras el éxito ve «inscrito»; ante un fallo conserva el contexto y puede reintentar. |
| «Integridad de inscripciones» (`ADR-001 v1`) | Si se necesita persistencia, se propone mantener una relación identificable socio–actividad con control de unicidad, frente a una lista libre sin esa garantía. Razón: permitir inscripciones fiables. La elección concreta queda por confirmar; no se deduce del FDR. | `AC-ADR-01`: incluso con solicitudes simultáneas, no quedan dos inscripciones de un socio en la misma actividad. |

El FDR de inscripción reúne comportamiento, experiencia y detalles necesarios para comprobar la capacidad; no se crea un registro de diseño detallado separado. El ADR sigue siendo una **propuesta de la simulación**, no una decisión de arquitectura tomada para DEMIURGO ni para una aplicación real.

| Tarea propuesta | Categorías | AC que cubre | Comprobación prevista, aún sin evidencia |
| --- | --- | --- | --- |
| `T-001` · permitir a la organización publicar actividades | Frontend + Backend + BBDD · Actividades | `AC-ACT-01` | Publicar una actividad con título y fecha. |
| `T-002` · mostrar actividades publicadas a socios | Frontend · Actividades | `AC-ACT-02` | Revisar actividad publicada y no publicada. |
| `T-003` · registrar inscripción y proteger su unicidad | Backend + BBDD · Inscripciones/Usuarios | `AC-INS-01`, `AC-INS-02`, `AC-ADR-01` si se acepta el ADR | Probar acceso sin ser socio, repetición y solicitudes simultáneas. |
| `T-004` · permitir solicitar la inscripción y representar su resultado | Frontend · Inscripciones | `AC-INS-01`, `AC-INS-03` | Comprobar solicitud, éxito, fallo y reintento en el recorrido. |

`CS-001` («Actividades e inscripciones de socios») reuniría estas cuatro tareas en un resultado que tiene sentido evaluar junto, aunque procedan de dos capacidades. Su comprobación de conjunto recorrería publicar una actividad, verla como socio e inscribirse una vez. **Las respuestas funcionales indicadas arriba están confirmadas para el caso; los registros detallados, el ADR, las tareas y el Change Set siguen siendo propuestas.** Nada está implementado ni verificado y la columna de comprobación describe métodos futuros, no evidencias existentes. Si el ADR no se acepta, hay que resolver la integridad por otra decisión de diseño y revisar `T-003` antes de comprometer el Change Set.

La simulación deja para debatir qué detalle es suficiente dentro de cada FDR antes de implementar y cuándo una elección técnica merece un ADR; ninguno se crea solo para completar una plantilla. Con lo acordado el 30-09, esas fichas se escribirían como flujo principal en pasos y criterios Dado/Cuando/Entonces, y cada tarea diría qué criterios cubre en lugar de tener los suyos.

### Cómo se revisaría el impacto de un cambio

Propuesta ilustrativa: una nueva exploración plantea que **«Los invitados necesitan aprobación»**. Se revisa la decisión «Usuarios» manteniendo su identidad y registrando la nueva versión. A través de sus relaciones se señalan para revisión el FDR de inscripción, incluidos sus estados de experiencia, las tareas y sus criterios, y los Change Sets relacionados. Un ADR solo se revisa si la nueva regla afecta a una decisión técnica que recoge.

La relación indica impacto posible, no demuestra que todo deba cambiar. DEMIURGO propondría para cada elemento mantenerlo, revisarlo o añadir trabajo, con el motivo correspondiente. La evidencia anterior conserva lo que probó para la versión anterior; no acredita automáticamente el comportamiento nuevo. El trabajo terminado mantiene su historia y, si necesita corregirse, se propone trabajo nuevo relacionado. Para tareas pendientes o en curso se propone revisar alcance y criterios y hacer visible cualquier alteración de un Change Set aprobado; las condiciones de pausa y nueva aprobación siguen abiertas.

Como condición propuesta para declarar una tarea preparada: fundamento identificable, alcance y categorías claros, criterios comprobables, dependencias conocidas y ninguna pregunta pendiente que impida definir o validar su resultado. Estar preparada no autoriza por sí mismo su ejecución. Primero revisaremos la simulación inicial y ajustaremos las fronteras entre artefactos; después podremos utilizar la misma base para estudiar un cambio posterior.

### Agrupaciones coherentes para implementar

DEMIURGO propone conjuntos de capacidades descritas por FDR y tareas que tienen sentido implementar juntos y que el usuario puede validar. Cada conjunto mantiene una identidad y un único nombre a lo largo de sus estados; no cambia de concepto al pasar de propuesta a trabajo aprobado. No implica una duración fija ni una cadencia de sprint.

Una agrupación puede reunir trabajo procedente de varias exploraciones. Cada tarea conserva sus orígenes y las versiones de las decisiones que la justifican: agrupar trabajo no fusiona las conversaciones ni borra su trazabilidad. La exploración organiza las preguntas y el conocimiento; esta agrupación organiza el trabajo que se propone implementar conjuntamente.

Nombre de trabajo: **Change Set**. Nos sirve para continuar el diseño; no priorizamos cerrar ahora los nombres. En la práctica de la v2.3 (acordada el 30-09), el conjunto que se entrega es la **épica**: reúne funcionalidades en el orden que decide la persona, con su fuera de alcance y su estado, y está lista para construir cuando todas ellas tienen el diseño aprobado. Si el Change Set sigue siendo un concepto distinto de la épica, sigue abierto. Ejemplo ilustrativo: «Abrir actividades a invitados» reúne tareas procedentes de una exploración sobre usuarios y otra sobre inscripciones. Ambas contribuyen a un resultado común que el usuario puede revisar.

Como propuesta de ciclo de vida: **Draft → Proposed → Approved → In progress → In review → Accepted**. El catálogo de estados y sus transiciones no está cerrado. Se propone distinguir la aprobación del alcance antes de implementar de la aceptación del resultado después de probarlo. También quedan por concretar los ajustes, pausas, descartes y cambios de alcance tras la aprobación.

Se propone que cada conjunto muestre primero el resultado esperado, qué incluye y excluye, por qué se propone y cómo se comprobará. Las tareas, sus exploraciones de origen y las decisiones relacionadas se consultan como detalle. El mecanismo de aprobación y las condiciones para iniciar la ejecución siguen pendientes.

### Un recorrido completo dentro de la aplicación

No necesitar volver a la terminal es un criterio verificable de diseño. La preparación del proyecto, el seguimiento del trabajo, las revisiones, la entrega y la investigación de problemas deben poder realizarse desde DEMIURGO.

Ante un fallo, la aplicación explica qué ocurre, qué consecuencias tiene y qué opciones existen para recuperarse. Debe permitir ejecutar la solución y comprobar el resultado. Mostrar únicamente un registro técnico y trasladar la resolución al usuario deja incompleto el recorrido.

## 4. Dos partes fundamentales

### Gestión completa del diseño

DEMIURGO acompaña desde la idea inicial hasta una definición suficientemente clara para construir y evaluar el producto. Incluye comprender usuarios y dolores, explorar posibilidades, decidir qué resolver, diseñar la experiencia y el comportamiento, y convertir lo acordado en trabajo organizado.

El diseño completo abarca necesidades, recorridos, pantallas, estados y decisiones técnicas necesarias. El usuario participa mediante experiencias comprensibles y revisables. Las conversaciones y decisiones deben traducirse en trabajo concreto que se pueda recuperar, ampliar y corregir; cada exploración puede también concluir con conocimiento o una idea apartada, sin exigir una tarea de implementación. Las tareas conservan su conexión con los problemas que resuelven, los resultados esperados y las versiones de las decisiones que las justifican. DEMIURGO propone agruparlas de forma coherente, pudiendo reunir varias exploraciones, para que el usuario valide el conjunto. Los criterios de selección y el momento de comprometer su ejecución siguen abiertos.

El arranque de un proyecto ya tiene etapas acordadas (28 y 29-09-2026). Primero, la definición del producto: DEMIURGO infiere lo que puede de la idea, cita la frase en que se apoya cada inferencia y la persona confirma en bloque; solo pregunta lo que la idea no dice. Después, las metas de calidad globales (cada una con un número) y los principios de arquitectura y seguridad. El arranque deja principios, no decisiones: una decisión necesita algo en lo que basarse y dos opciones reales. Luego se diseña la primera funcionalidad; la arquitectura real se abre con al menos una funcionalidad aprobada, y la seguridad de todo el producto y la operación, antes de la primera versión. Cada etapa termina en algo aprobado y comprobable por sí solo.

Esta parte también está gobernada por un método determinista: etapas estables, condiciones explícitas para avanzar y reglas para revisar decisiones. Explorar no debe provocar la pérdida del estado del proyecto ni convertir una sugerencia en una decisión aceptada.

### Implementación mediante orquestación agéntica

El orquestador conduce el trabajo de los agentes conforme al diseño acordado y a reglas definidas. Los motores de contexto aportan el conocimiento pertinente para cada actividad, incluyendo decisiones, restricciones, trabajo previo y evidencias, evitando reconstrucciones innecesarias.

La implementación comprende construir, comprobar, corregir, revisar y entregar. Mantiene una relación comprensible entre intención, trabajo realizado y resultado verificado. Lo esperado y la manera de comprobarlo se concretan antes de implementar.

Los fallos deben poder investigarse y corregirse conservando su contexto. La observabilidad ayuda a entender el estado del trabajo, los bloqueos, los resultados y el consumo de recursos. La experiencia acumulada sirve para reconocer errores recurrentes y proponer mejoras, distinguiendo causas comprobadas de hipótesis.

### Un método estable para ambas partes

Las etapas de diseño y desarrollo están definidas por el producto; la IA no las improvisa en cada conversación. También son explícitas las condiciones de avance, las comprobaciones y las reglas de recuperación. Las respuestas de los modelos siguen siendo variables: el determinismo corresponde al proceso que las utiliza y verifica.

El recorrido general comprende explorar y comprender, diseñar y decidir, organizar el trabajo, construir y comprobar, entregar, observar y aprender. Expresa el alcance; el catálogo exacto de etapas más allá del arranque, sus transiciones y sus condiciones de finalización está pendiente de diseño.

El método permite iteraciones y regreso a decisiones anteriores mediante reglas conocidas. La profundidad del trabajo se ajusta a las necesidades del proyecto, manteniendo etapas y criterios explícitos.

El marco principal de referencia para el ciclo de vida del software será **ISO/IEC/IEEE 12207:2026**, que describe procesos aplicables de forma iterativa e incremental sin imponer nombres de artefactos, un modelo de ciclo de vida o una metodología. Se complementará con **ISO/IEC/IEEE 29148:2018** para ingeniería de requisitos y **ISO/IEC/IEEE 29119-2:2021** para procesos de pruebas. Como guía práctica de trazabilidad y verificación se consultarán la [matriz de verificación de requisitos de NASA](https://www.nasa.gov/reference/appendix-d-requirements-verification-matrix/) y su guía de [verificación del producto](https://www.nasa.gov/reference/5-3-product-verification/), atendiendo al origen, método, resultados y evidencia.

### Como lo haría un equipo profesional de primer nivel

Acordado el 30-09-2026. DEMIURGO replica cómo trabaja en la vida real un equipo de desarrollo top tier, una factoría de software. Todo lo que propone, muestra y guía sigue una práctica real con nombre, y no inventa procesos que ningún equipo serio usaría. Este es el criterio para decidir qué diseñar en la v3 y para revisar lo que ya existe.

Prácticas adoptadas (en la v2.3 y como base del diseño de la v3):

- **Cada cosa se decide en su sitio.** Una propuesta sobre un registro se decide en su ficha, una pregunta en su hilo, el plan de una épica en la épica y la definición en Producto. La bandeja de avisos solo indica qué espera y lleva allí, como las notificaciones de GitHub. Cada lista marca «Te espera» con una sola regla.
- **Funcionalidad = historia con flujo principal y criterios BDD.** El comportamiento es el flujo principal de un caso de uso, en 4 a 7 pasos numerados. Cada criterio de aceptación va en formato Dado/Cuando/Entonces y dice qué paso comprueba. Ningún paso queda sin criterio (Definition of Ready).
- **Historias pequeñas (INVEST).** Una funcionalidad tiene como máximo 8 criterios; si no cabe, se divide.
- **Tareas = subtareas de la historia.** Una tarea es un trozo de implementación con objetivo, alcance y tamaño, y dice qué criterios de su funcionalidad cubre; los criterios viven en la historia.
- **GitHub flow y ATDD al construir.** Cada tarea tiene una rama y un pull request, y cada criterio automático una prueba cuyo título empieza por su código. La evidencia enlaza el pull request y la prueba, y «hecho» lo marca la persona tras el merge.
- **El diseño se revisa como un RFC, no en ramas.** El paso de borrador a aprobado es la revisión del diseño, y muestra los cambios desde la última versión aprobada como el diff de un pull request. Un rechazo vuelve al hilo con su motivo, como «Request changes».
- **Seguridad desde el diseño (SDL/STRIDE).** El análisis de amenazas se hace antes de construir, junto a la arquitectura, y cada mitigación es un criterio de la funcionalidad o tarea que la construye.
- **Metas de calidad medibles.** Una meta sin número no se da por buena.
- **Walking skeleton.** La primera funcionalidad se diseña y se construye de punta a punta con la infraestructura mínima, antes de ensanchar.
- **Preguntas como alternativas de un RFC.** Cada opción trae su coste y una recomendada.
- **Épicas con fuera de alcance y estado, y un backlog ordenado por la persona.**

Estas referencias se adaptarán al producto; no se afirma conformidad ni certificación, ni que formen una tríada universal. DEMIURGO debe aportar el rigor del método sin exigir que el usuario conozca la terminología o gestione documentos normativos. El catálogo de etapas y la adaptación concreta de prácticas siguen abiertos. ([ISO/IEC/IEEE 12207:2026](https://www.iso.org/standard/90219.html), [ISO/IEC/IEEE 29148:2018](https://www.iso.org/standard/72089.html), [ISO/IEC/IEEE 29119-2:2021](https://www.iso.org/standard/79428.html))

## 5. Propuestas y cuestiones abiertas

### Soluciones propuestas pendientes de concretar

Estas son candidatas de diseño, no funcionalidades ni interfaces cerradas:

- La representación y navegación concretas del mapa de conocimiento. Su función de conectar el conocimiento y aportar contexto ya está acordada.
- Comparaciones de alternativas mediante vistas o prototipos que ayuden a evaluar consecuencias antes de decidir.
- Detección automática de desviaciones entre lo acordado, lo construido y lo comprobado, con revisión guiada de su impacto.
- Comprobación de soluciones reutilizables antes de producir código nuevo.
- Indicadores de calidad, tiempo, coste, reintentos y regresiones para evaluar el proceso y sus mejoras.
- Si el Change Set, con sus estados y la presentación de resultado esperado, alcance, motivos y comprobaciones, sigue existiendo junto a la épica o la sustituye. La agrupación coherente de trabajo bajo una identidad estable ya está acordada; no requiere una cadencia de sprints.
- Generar y actualizar automáticamente tareas como propuestas antes de comprometer su ejecución. El paso de conocimiento a trabajo autorizado aún no está definido.
- Las plantillas de ADR y de las entidades de apoyo se proponen como registros conectados, sin documentos paralelos de diseño detallado. La del FDR (historia con flujo principal y criterios Dado/Cuando/Entonces) ya está acordada.
- Los umbrales, controles concretos y presentación de la cobertura, justificación, cumplimiento y calidad de requisitos y pruebas, además del formato de la evidencia. La revisión de estos aspectos, la trazabilidad entre versiones, criterios, tareas, comprobaciones y evidencias, y el cierre por versión descritos arriba son acuerdos de trabajo.
- El vínculo exacto entre código, build, entorno, entrega y evidencias; la referencia a un resultado evaluable ya forma parte del modelo propuesto. Aún hay que definir cómo se ejecuta, distribuye u opera cada clase de aplicación generada, incluido hosting cuando corresponda.
- Reducir las intervenciones humanas a decisiones con consecuencias de producto, aprobación del alcance de trabajo y valoración del resultado, escalando durante la ejecución solo bloqueos o cambios que alteren lo aprobado. El límite de autonomía y las excepciones requieren una regla explícita para evitar fatiga de aprobaciones.
- La separación final entre área técnica y dominio funcional, las etiquetas y quién confirma su clasificación. Que toda tarea diga qué criterios de su funcionalidad cubre y tenga tamaño ya es un requisito acordado.

### Acordado desde el 23-09

- 28-09: la definición del producto vive en la página Producto; la persona confirma el propósito; el arranque infiere primero y la persona confirma en bloque.
- 29-09: el arranque deja principios y las decisiones salen de funcionalidades; vocabulario mínimo de pantalla (propuesta, aceptada, aprobada, etiqueta de aspecto, «En qué se basa»); los registros van en inglés con traducción de lectura.
- 30-09: jerarquía DEF → EPC → FDR → ADR → construcción y evidencia; la épica es el conjunto que se entrega, con sus funcionalidades como registros y un orden que fija la persona.
- 30-09: cada cosa se decide en su sitio y Needs you es solo un índice que lleva allí; los criterios viven en la funcionalidad y las tareas dicen cuáles cubren; el diseño se revisa como un RFC. Detalle en «Como lo haría un equipo profesional».

### Decisiones que abordaremos después

- Qué etapas concretas forman el método después del arranque, qué resultados exige cada una y cómo se adaptan las referencias normativas y prácticas citadas al producto.
- Qué campos condicionales requiere cada cambio y dónde está la frontera entre una funcionalidad y una decisión de arquitectura que merece ADR; cómo revisar dependencias y versiones antes de generar tareas sin crear registros innecesarios.
- Si el arranque de un proyecto será una conversación en lugar de una lista de respuestas (idea aparcada para la v3 el 29-09), y un vocabulario único de nombres de funcionalidad que avise cuando el diseño, los textos o el código llamen distinto a lo mismo (idea anotada para la v3).
- Cómo representar y navegar conversaciones, tarjetas, ramas y mapa de conocimiento manteniendo la atención, y cómo comprobar su comprensión con personas sin conocimientos técnicos.
- Qué puede resolver el sistema de forma autónoma más allá del cierre revisable de tarjetas, y qué requiere intervención humana, incluida la colaboración y responsabilidad dentro de los equipos.
- Cómo seleccionar y priorizar el trabajo de cada agrupación, cuándo está suficientemente definido, cómo se revisa su alcance y qué autoriza su ejecución; una pregunta pospuesta puede seguir afectando al trabajo. Confirmar el nombre y concretar estados, transiciones y aceptación del resultado.
- Qué etiquetas y categorías adicionales de decisiones convienen, y qué modelo ayudará a clasificar las tarjetas. No se fija todavía un proveedor o modelo.
- Qué evidencias y niveles de cobertura/calidad demostrarán calidad de producción en diseño e implementación, y cómo se presentan sin trasladar la verificación técnica al usuario.
- Qué recorrido mínimo del copiloto de diseño permite pasar de una idea a exploraciones, preguntas, decisiones, FDR/ADR cuando correspondan, criterios y tareas recuperables; cómo detectar lagunas y gestionar cambios sin convertirlo en trabajo documental excesivo. Definir qué debe funcionar dentro de DEMIURGO y qué puede coordinarse manualmente en esta etapa.
- Cómo iniciar un proyecto nuevo para construir una versión más completa de DEMIURGO a partir del conocimiento del primero, conservando la procedencia sin atribuir al nuevo código tareas terminadas ni evidencias anteriores; qué prueba concreta demostraría que el copiloto ya aporta valor en esa reconstrucción.
- Qué capacidades posteriores permiten completar el ciclo: construcción, verificación, entrega para uso real, evaluación y corrección desde DEMIURGO. Este resultado sigue siendo una meta de producto, pero ya no es condición de la primera versión centrada en diseño.
- Qué modalidades de ejecución, distribución, despliegue y operación debe soportar DEMIURGO, cómo elige la adecuada para cada proyecto y quién asume cada responsabilidad. Hosting es una decisión pertinente para algunas aplicaciones, no un requisito universal.
- Cómo se concreta la observabilidad del proceso y de la aplicación entregada, y cómo se actúa ante incidencias.
- Qué primera experiencia de diseño demostrará el valor del copiloto y cómo mediremos recuperación del contexto, detección de lagunas, esfuerzo de supervisión y utilidad de los artefactos para construir.
- Qué proyectos usar para validar la versión funcional mínima sin convertir esos ejemplos en un límite de la visión; cómo se incorporarán aplicaciones existentes y qué capacidades de ejecución simultánea, proveedores y modelos serán necesarias.

Las restricciones anteriores sobre MVP, concurrencia y proveedores quedan sujetas a revisión; no se consideran decisiones vigentes de esta nueva definición. Tampoco se fija aquí una arquitectura técnica ni un diseño de pantallas.

## 6. Glosario vivo

Este glosario fija el significado compartido de los conceptos y se actualiza con las decisiones. Un nombre propuesto no se considera definitivo. Los términos ingleses pendientes no obligan a que la interfaz se presente en inglés.

| Término | Significado en DEMIURGO | Estado |
| --- | --- | --- |
| Exploración | Proceso de desarrollar una idea, necesidad o cambio mediante conversaciones y preguntas; puede producir conocimiento, decisiones y trabajo. | Concepto acordado. |
| Rama de exploración | Exploración derivada de otra que conserva su origen y devuelve sus conclusiones al contexto de partida. | Concepto acordado. |
| Tarjeta de pregunta | Pregunta etiquetada con motivo, estado y conversación propia; su cierre es revisable y no equivale a confirmación humana. | Concepto acordado. |
| Decisión | Registro de una respuesta acordada o propuesta a una cuestión, con identidad estable, razones y grado de confirmación visible. | Concepto acordado. |
| Versión de decisión | Contenido de una decisión en un momento determinado; permite conservar y reconstruir el fundamento del trabajo. | Concepto acordado. |
| Mapa de conocimiento | Conjunto de relaciones entre ideas, preguntas, decisiones, trabajo y evidencias que conserva la historia y aporta contexto. | Función acordada; representación pendiente. |
| Definición del producto (DEF) | Registro con el propósito, usuarios, problema, funcionalidades de la primera versión, fuera de alcance, restricciones, metas de calidad y principios. Base de toda la jerarquía. | Concepto acordado. |
| Épica (EPC) | Conjunto de funcionalidades en orden con objetivo, fuera de alcance y estado, para una capacidad que no cabe en una funcionalidad. Crece por versiones. | Concepto acordado. |
| Funcionalidad | Historia pequeña del producto que aporta utilidad al usuario: registro FDR con flujo principal en pasos y hasta 8 criterios Dado/Cuando/Entonces. | Concepto acordado. |
| Artefacto | Registro identificable, versionado y relacionado; no implica un documento independiente. | Modelo de campos inicial propuesto para validar. |
| Requisito | Necesidad, resultado o restricción con motivo y origen, expresada como elemento trazable en un FDR o como restricción transversal cuando afecta varios. | No genera un registro independiente por defecto. |
| ADR | Architecture Decision Record: contexto, alternativas, decisión de arquitectura, razones, consecuencias y elementos afectados. | Familia acordada; campos iniciales propuestos, fronteras por validar. |
| FDR | Functional Design Record: el registro de una funcionalidad; concreta actores, flujo principal, reglas, límites y AC. | Acordado; campos condicionales abiertos. |
| Sección de experiencia / técnica del FDR | Parte condicional del FDR para describir recorrido, estados, datos, contratos o restricciones necesarios para una capacidad. | No genera un documento separado. |
| Tarea | Subtarea de una funcionalidad: trozo de implementación con objetivo, alcance, tamaño y los criterios de su funcionalidad que cubre; se construye con rama y pull request. | Concepto acordado; clasificación y ciclo de vida pendientes. |
| Criterio de aceptación (AC) | Condición observable (Dado/Cuando/Entonces) que debe cumplirse para aceptar una funcionalidad, ligada al paso que comprueba; conserva vínculo identificable con regla y versión de origen y evidencia de comprobación. | Obligatorio y trazable; formato y controles detallados pendientes. |
| Trazabilidad por versión | Relaciones de muchos a muchos entre versiones de registros y AC, tareas, comprobaciones y evidencias. Cada tarea justifica AC y cada AC comprometido tiene trabajo asociado. | Acuerdo; representación y controles de cobertura pendientes. |
| Área técnica / dominio funcional | Dos dimensiones propuestas: dónde se trabaja (front, back, BBDD) y qué parte del producto afecta (usuarios, actividades). | Clasificación propuesta; etiquetas no exhaustivas. |
| Change Set | Agrupación coherente de capacidades descritas por FDR y tareas propuesta por DEMIURGO para validación del usuario; puede reunir varias exploraciones y mantiene su identidad entre estados. En la v2.3 esa función la cumple la épica. | Concepto acordado; su relación con la épica, el nombre y los estados siguen abiertos. |
| Evidencia | Resultado de una comprobación que ayuda a evaluar si lo construido cumple lo esperado. | Concepto acordado; criterios pendientes. |

«Sprint» fue el término inicial para esta agrupación coherente, sin implicar un periodo de tiempo. «Propuesta de implementación» y «entrega» no designan dos entidades distintas de ese conjunto. La distinción entre aprobación del diseño y finalización verificada de la implementación se evalúa por versión; un cierre requiere cobertura de AC, trabajo necesario completado y evidencia satisfactoria. Las familias ADR y FDR y la agrupación funcional del FDR están acordadas; el FDR incluye el diseño de UI/UX y el detalle local necesario, mientras sus campos condicionales siguen abiertos.

Este documento seguirá creciendo con las decisiones del producto. Las preguntas se resolverán en su apartado correspondiente, sustituyendo lo que haya dejado de ser válido y conservando solo el contexto necesario para comprender la visión actual.
