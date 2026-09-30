# DEMIURGO: visión del producto

Documento vivo · reescrito el 30 de septiembre de 2026

Este es el único documento de visión de DEMIURGO. Sirve para dos cosas: saber qué es el producto y
decidir qué diseñar en la v3. La persona diseña la v3 dentro de la v2.3, en la instancia 8100. Lo
acordado se dice sin más; lo que falta por decidir está en el apartado 7. La versión anterior de
este documento sigue en el historial de git.

## 1. Qué es DEMIURGO y para quién

DEMIURGO lleva a una persona o a un equipo desde una idea hasta una aplicación con calidad de
producción. Lo hace desde una web guiada, sin exigir saber programar. Guarda y conecta todo lo que
se sabe del producto y gobierna su diseño y su construcción con pasos definidos y resultados
comprobables.

Está pensado sobre todo para el *vibecoding* (crear software dirigiendo a la IA). La persona puede no
haber escrito nunca código. También debe servir a desarrolladores y equipos, sin que saber de
técnica sea un requisito.

Reparto del trabajo:

- La persona aporta la intención, decide y revisa resultados.
- DEMIURGO aporta el método, prepara propuestas, hace el trabajo técnico y reúne las pruebas de que
  funciona.
- La persona no tiene que coordinar agentes ni cazar fallos técnicos que el sistema puede comprobar.

DEMIURGO no es un IDE (editor de código). Se organiza alrededor del producto que se quiere crear. La
ambición es que sea la única herramienta necesaria para crear y hacer evolucionar una aplicación:
explorar, diseñar, construir, comprobar, entregar, observar y mejorar. Puede apoyarse en servicios
externos, pero el recorrido se completa desde DEMIURGO, sin volver a la terminal.

### Los dolores que resuelve

La persona que hace vibecoding acaba siendo la memoria y el coordinador del proyecto. Estos son los
dolores que ha contado; no son mediciones.

| Dolor | Qué le pasa a la persona |
| --- | --- |
| Ideas enterradas en conversaciones largas | Se pierden y cuesta retomarlas. |
| Pérdida de contexto y desvío del propósito | Lo construido se aleja de lo que quería y contradice lo acordado. |
| Documentación larga y enlazada entre sí | Entender el proyecto se vuelve una tarea que se abandona. |
| Decisiones y motivos dispersos | No se sabe qué está acordado, qué sigue abierto ni por qué. |
| Vigilar a la IA todo el rato | El avance depende de su energía para reconducirla. |
| Terminal y herramientas sueltas | El recorrido se corta y excluye a quien no es técnico. |
| Resultados sin pruebas de calidad | No sabe si la aplicación es segura, coherente y mantenible. |
| Correcciones que no dejan aprendizaje | Se repiten errores y se rehace trabajo. |

Y dos dolores que aparecieron al usar la propia v2 (30-09): el volumen que genera la IA puede superar
lo que una persona puede revisar, y una misma cosa aparece en varias pantallas sin que quede claro
dónde se decide.

## 2. Principios

**El modelo propone, el sistema dispone y la persona decide.** Nada de lo que produce la IA cambia
algo aprobado por sí solo. Todo llega como propuesta; solo una persona la acepta o la aprueba. El
sistema aplica reglas fijas: quién puede hacer qué y qué cambios de estado están permitidos.

**Como lo haría un equipo profesional de primer nivel.** DEMIURGO replica cómo trabaja un equipo de
desarrollo real y de primer nivel. Cada cosa que propone, muestra o guía sigue una práctica real con
nombre (por ejemplo, criterios Dado/Cuando/Entonces o *walking skeleton*). No inventa procesos que
ningún equipo serio usaría. Es el criterio para decidir qué diseñar en la v3 y para revisar lo que
ya existe.

**Cada cosa en su sitio.** Una propuesta sobre un registro se decide en su ficha. Una pregunta, en su
hilo. El plan de una épica, en la épica. La definición, en Producto. Needs you (la bandeja de avisos)
es solo un índice que lleva a esos sitios, como las notificaciones de GitHub. No hay tres vistas para
lo mismo.

**Los registros van en inglés.** Lo que DEMIURGO guarda (definición, funcionalidades, criterios,
decisiones, preguntas) va siempre en inglés: un solo idioma para buscar, para el glosario y para el
código. La persona lo lee en su idioma con una traducción de lectura marcada, que nunca es autoridad.
La conversación y la interfaz siguen el idioma de la persona. Traducir nunca bloquea guardar.

**La atención de la persona es el recurso escaso.** Cada pantalla, pregunta y aviso tiene que
justificar la atención que pide. DEMIURGO nunca genera más de lo que la persona puede revisar de una
sentada: bucles cortos antes que mucho volumen. Las cuestiones técnicas se traducen a efectos sobre
el producto.

**Vocabulario mínimo en pantalla.** Un solo nombre por cosa más una etiqueta de aspecto (Producto,
Funcionalidad, Calidad, Arquitectura, Seguridad, Producción, Épica). Todo empieza como propuesta;
aceptada, se sigue trabajando; aprobada, pasa a registro. El origen se muestra como «En qué se basa»
(enlaces), no como quién lo produjo. La interfaz es sobria, como un documento de trabajo: sin
tarjetas en cajas ni ruido de etiquetas.

**Todo el conocimiento vive en DEMIURGO, con su historia.** Ideas, preguntas, decisiones, motivos,
diseño, tareas y pruebas están conectados dentro de la aplicación. Se distingue lo confirmado, lo
propuesto y lo pendiente. Cada registro conserva sus versiones y por qué cambió. Aprobar un diseño y
tenerlo construido y comprobado son estados distintos.

## 3. El recorrido

El diseño sigue una jerarquía. Cada nivel se basa en el anterior:

1. **Definición del producto (DEF).**
2. **Épica (EPC)**, solo cuando una capacidad de la primera versión no cabe en una funcionalidad.
3. **Funcionalidad (FDR)**, basada en su épica o en la definición.
4. **Decisión de arquitectura (ADR)**, basada en una funcionalidad o en una restricción u objetivo de
   la definición.
5. **Tareas, construcción y evidencia.**

Una propuesta no es un nivel: es cómo llega cualquier cosa. Las funcionalidades van antes que las
decisiones: no se decide sin algo en lo que basarse.

### Arranque

El arranque de un proyecto tiene tres etapas. Cada una termina en algo aprobado y comprobable por sí
solo.

1. **Definición del producto.** DEMIURGO infiere lo que puede de la idea y cita la frase en que se
   apoya cada inferencia. La persona confirma en bloque. Solo se pregunta lo que la idea no dice. La
   persona confirma el propósito: el trabajo que resuelve, los resultados observables y los
   principios.
2. **Metas de calidad.** Cada meta lleva un número. Una meta sin número no se da por buena: se
   pregunta el número (por ejemplo, «¿cuánto trabajo guardado puedes perder como mucho?»).
3. **Principios de arquitectura y seguridad.** El arranque deja principios, no decisiones. Una
   decisión necesita algo en lo que basarse y dos opciones reales.

Después se diseña la primera funcionalidad. La **arquitectura** real se abre cuando hay al menos una
funcionalidad aprobada. La **seguridad** se analiza antes de construir, junto a la arquitectura: es
el modelo de amenazas (qué puede salir mal y cómo se evita, con el método STRIDE del SDL de
Microsoft). No repite preguntas ya contestadas en la definición. Cada mitigación se convierte en un
criterio de la funcionalidad o la tarea que la construye.

### Walking skeleton

La primera funcionalidad se diseña y se construye de punta a punta con la infraestructura mínima,
antes de ensanchar. Ese *walking skeleton* (esqueleto que ya camina) demuestra que el recorrido
entero funciona. La infraestructura necesaria entra como tareas de esa funcionalidad, no como un
proyecto aparte.

### Épicas y backlog

Una épica agrupa funcionalidades que juntas cumplen una capacidad. Tiene:

- **Objetivo**, que nombra el resultado de la definición al que sirve.
- **Fuera de alcance**, lo que deja fuera a propósito, para poder decir que no a lo que se cuela.
- **Terminada cuando**, la condición de cierre.
- **Estado**: sin empezar, en curso o terminada (cuando todas sus funcionalidades vivas están
  construidas).
- Sus funcionalidades, que son registros desde que se listan, en el orden que decide la persona.

Las épicas forman un **backlog** (lista ordenada de trabajo pendiente) cuyo orden fija la persona. Ese
orden manda en la cola de construcción. Una épica crece por versiones.

La épica es la unidad de entrega: el conjunto de trabajo que se entrega junto. No existe un «Change
Set» aparte ni estados propios para él; bastan el estado de la épica y los de sus funcionalidades.

Una funcionalidad está **comprometida** cuando está aprobada y ocupa un lugar en el orden de su
épica. Antes es una propuesta revisable, no trabajo prometido.

### Funcionalidades

Una funcionalidad es una **historia** pequeña que aporta algo útil al usuario. Se escribe así:

- **Comportamiento**: el flujo principal de un caso de uso, en 4 a 7 pasos numerados.
- **Criterios de aceptación**: cada uno en formato Dado/Cuando/Entonces (BDD, desarrollo guiado por
  comportamiento) y ligado al paso que comprueba.
- **Como mucho 8 criterios** (INVEST: historias independientes, pequeñas y comprobables). Si no cabe,
  se divide en varias funcionalidades de su épica.
- **Definition of Ready** (lista para construir): ningún paso sin criterio.

La funcionalidad incluye el detalle de experiencia, datos o contratos que haga falta para
construirla y comprobarla. No hay documentos paralelos de requisitos ni de diseño detallado.

### Decisiones (ADR)

Un ADR recoge una decisión de arquitectura con opciones reales y consecuencias: contexto, opciones,
elección, motivo y consecuencias. Solo se crea cuando hace falta. Se basa en una funcionalidad o en
una restricción u objetivo de la definición. Una regla técnica nueva no se decide de forma implícita
al escribir una funcionalidad.

No hay un registro aparte para decisiones de producto. Una decisión de producto (por ejemplo, quién
puede participar) vive en la definición o en la épica; una decisión técnica, en un ADR.

Las preguntas se plantean como las alternativas de un RFC (documento de propuesta que el equipo
revisa): cada opción trae su coste y una va marcada como recomendada.

### Tareas

Una tarea es un trozo de implementación de una funcionalidad. Tiene objetivo, alcance, tamaño (XS a
XL; solo una persona lo cambia) y `covers`: los códigos de los criterios de su funcionalidad que
cubre. No tiene criterios propios: los criterios viven en la funcionalidad. Todo criterio de una
funcionalidad debe estar cubierto por alguna tarea.

Las tareas no se clasifican por área técnica (frontend, backend) ni por dominio funcional. La
etiqueta de aspecto y el código de la épica ya dicen de qué parte del producto se trata.

### Construcción y evidencia

- **GitHub flow**: cada tarea tiene su rama y su pull request. No se usa GitFlow.
- **ATDD** (pruebas de aceptación primero): cada criterio automático tiene una prueba cuyo título
  empieza por su código.
- La **evidencia** enlaza el pull request y la prueba. Es del criterio, no de la tarea.
- «Hecho» lo marca la persona después del merge.
- Una tarea marcada como hecha no demuestra por sí sola que se cumplan sus criterios. La evidencia
  vale para el resultado concreto que se comprobó.

### Revisión y cambios

El diseño se revisa como un RFC dentro de DEMIURGO, no en ramas:

- Un registro pasa de borrador a aprobado. Ese paso es la revisión del diseño.
- El borrador muestra «Cambios desde la vN» sección a sección, como el diff de un pull request, con
  los criterios añadidos, cambiados o quitados.
- Un rechazo vuelve al hilo con su motivo, como «Request changes». El agente lo ve y no repite lo
  mismo sin atender el motivo.
- Al aprobar una versión, los borradores anteriores del mismo registro se cierran.
- Cuando algo aprobado contradice otro registro, DEMIURGO pide revisarlo citando las dos frases. Lo
  compatible sigue vigente.
- Una versión nueva no hereda la evidencia de la anterior.

## 4. Los registros

Los códigos sirven para enlazar y versionar; la persona ve primero el nombre. Ejemplos reales:
`DEF-PRO-001`, `EPC-GUI-001`, `FDR-GUI-005`, `TSK-BUI-012`.

| Código | Qué es | Qué contiene | En qué se basa |
| --- | --- | --- | --- |
| DEF | Definición del producto | Propósito, usuarios, problema, funcionalidades de la primera versión, fuera de alcance, restricciones, metas de calidad con número, principios de arquitectura y seguridad | La idea y las respuestas de la persona |
| EPC | Épica | Objetivo, fuera de alcance, terminada cuando, estado y funcionalidades en orden | La definición |
| FDR | Funcionalidad | Flujo principal en 4–7 pasos y hasta 8 criterios Dado/Cuando/Entonces ligados a sus pasos | Su épica o la definición |
| ADR | Decisión de arquitectura | Contexto, opciones, elección, motivo y consecuencias | Una funcionalidad o una restricción u objetivo de la definición |
| TSK | Tarea | Objetivo, alcance, tamaño XS–XL y `covers` (criterios que cubre) | Su funcionalidad aprobada |
| AC | Criterio de aceptación | Una condición observable Dado/Cuando/Entonces, con su código y el paso que comprueba | Vive dentro de su funcionalidad; no es un documento aparte |

Todos los registros tienen un código estable, versiones con su nota de cambio y enlaces a la versión
concreta en que se basan.

## 5. Dónde se hace cada cosa

| Pantalla | Qué se hace allí |
| --- | --- |
| **Producto** | Leer y cambiar la definición. Ver el siguiente paso del proyecto. |
| **Épicas** | Ver las épicas en su orden, su estado y lo que te espera. En cada épica, decidir su plan y ordenar sus funcionalidades. |
| **Ficha de registro** | Leer un registro, revisar su borrador con los cambios desde la última versión, y aceptar o rechazar las propuestas que lo afectan. |
| **Hilos** | Conversar con los agentes y contestar preguntas. Cada hilo muestra los registros a los que afecta y su «Revisar» lleva a la ficha. |
| **Needs you** | Solo un índice: cada aviso lleva a su ficha, hilo o épica. Las listas marcan «Te espera» con una sola regla. |
| **Construir** | La cola de tareas listas, en orden, con su tamaño y su encargo (el texto para quien construye). Pedir o retirar una construcción. |

## 6. Cómo se construye DEMIURGO con DEMIURGO

La estrategia es usar una versión mínima para diseñar la siguiente, más completa:

- La **v2.3** se usa de verdad en la instancia 8100 y se parchea en caliente con lo que echa en falta.
  Es desechable: lo que importa es que funcione.
- Dentro de ella, la persona diseña la **v3**, la versión productiva, en el proyecto DEMIURGOv3. Lo
  hace paso a paso, jugando el papel de un usuario nuevo real.
- El primer paso es el walking skeleton: diseñar entera la primera funcionalidad (FDR-GUI-005) y
  construirla con la infraestructura mínima.
- La v3 hereda el **conocimiento y los motivos** acumulados, con su origen. No hereda tareas
  terminadas ni evidencias: se referían a otro código.
- Lo que la v2.3 echa en falta se anota como parche o como idea para la v3. Ningún parche pasa tal
  cual a la v3.

Este uso sobre sí mismo es una prueba importante de que el producto aporta valor, pero no la única.

## 7. Pendiente de decidir

Lo que sigue está abierto. Se decide en la v3, dentro de DEMIURGO.

- **El arranque como conversación** (idea para la v3, 29-09). La lista de respuestas del día 1 no
  convence; se prefería la conversación con panel lateral.
- **Un vocabulario único de nombres** (idea para la v3, 29-09). La misma funcionalidad se llamó de
  tres formas distintas en tres pantallas. DEMIURGO debería guardar un nombre por cosa y avisar
  cuando el diseño, los textos o el código la llaman distinto.
- **Cómo se listan las épicas y los hilos.** Hoy no se ve bien qué hilos pertenecen a qué épica.
- **Evidencia desde la integración continua.** Hoy la evidencia se escribe a mano. Falta leer los
  resultados de las pruebas del pull request y registrarlos solos.
- **Orquestación automática de agentes.** Hoy la persona copia el encargo y lanza la construcción.
  Falta decidir cuánto hace DEMIURGO solo y dónde escala a la persona.
- **Entrega y alojamiento.** Cómo se ejecuta, distribuye o despliega cada tipo de aplicación. El
  alojamiento web es una opción, no un requisito universal.
- **Observabilidad.** Cómo se ve el trabajo de la IA (estado, bloqueos, consumo) y la aplicación ya
  entregada, y cómo se actúa ante un fallo.
- **Qué demuestra la calidad de producción.** No se puede afirmar que una aplicación la tiene sin
  condiciones medibles comprobadas sobre un resultado concreto. Faltan umbrales, excepciones y quién
  acepta el riesgo. Una valoración favorable de la IA no basta.
- **El mapa de conocimiento.** Cómo se ve y se navega la red de ideas, preguntas, decisiones y
  pruebas.
- **Incorporar aplicaciones existentes**, no solo empezar desde una idea.
- **El equipo.** Quién decide qué cuando trabajan varias personas.

## 8. Glosario

| Término | Significado |
| --- | --- |
| ADR | Architecture Decision Record: registro de una decisión de arquitectura con opciones y consecuencias. |
| ATDD | Acceptance Test-Driven Development: cada criterio automático tiene su prueba, escrita a partir del criterio. |
| Backlog | Lista ordenada del trabajo pendiente; aquí, las épicas en el orden que fija la persona. |
| Comprometida | Funcionalidad aprobada que ocupa un lugar en el orden de su épica. |
| Criterio de aceptación (AC) | Condición observable Dado/Cuando/Entonces que debe cumplirse para aceptar una funcionalidad. |
| Definition of Ready | Condición para empezar a construir: ningún paso de la funcionalidad sin criterio. |
| Encargo | El texto que recibe quien construye una tarea: qué hacer, qué criterios cubre y qué ya existe. |
| Épica (EPC) | Conjunto ordenado de funcionalidades para una capacidad que no cabe en una sola; es la unidad de entrega. |
| Evidencia | Prueba de que un criterio se cumple: el pull request y la prueba que lo comprueba. |
| Funcionalidad (FDR) | Historia pequeña con flujo principal en pasos y hasta 8 criterios. |
| GitHub flow | Una rama y un pull request por cambio, que se integra tras revisarlo. |
| Hilo | Conversación con los agentes sobre un tema; de ella salen preguntas y propuestas. |
| INVEST | Regla para historias: independientes, negociables, valiosas, estimables, pequeñas y comprobables. |
| Propuesta | Cómo llega cualquier cosa de la IA; no vale nada hasta que la persona la acepta o la aprueba. |
| RFC | Request for Comments: documento de propuesta que el equipo revisa antes de aprobarlo. |
| STRIDE / SDL | Método de Microsoft para buscar amenazas de seguridad en el diseño, antes de construir. |
| Tarea (TSK) | Trozo de implementación de una funcionalidad, con tamaño y los criterios que cubre. |
| Walking skeleton | La primera funcionalidad construida de punta a punta con lo mínimo, antes de ensanchar. |
