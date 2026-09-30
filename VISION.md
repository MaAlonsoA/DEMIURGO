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
nombre (por ejemplo, criterios Dado/Cuando/Entonces o *walking skeleton*), con su fuente citada. No inventa
procesos que ningún equipo serio usaría ni presenta como estándar un número sin fuente: lo que es
convención nuestra se dice así. Es el criterio para decidir qué diseñar en la v3 y para revisar lo que
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

Los agentes siguen «Building effective agents» de Anthropic: un agente especializado por artefacto
(enrutado) y una puerta de validación en código entre pasos (encadenado de prompts con puerta
programática; https://www.anthropic.com/engineering/building-effective-agents). Las salidas
estructuradas garantizan el esquema, no las reglas de negocio ni las longitudes de las listas, así
que las valida nuestro sistema
(https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

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
   decisión necesita algo en lo que basarse y dos opciones reales (convención nuestra).

Después se diseña la primera funcionalidad, que arranca con el walking skeleton (ver abajo). La **arquitectura** real se abre cuando hay al menos una
funcionalidad aprobada. La **seguridad** se analiza antes de construir, junto a la arquitectura: es
el modelo de amenazas (qué puede salir mal y cómo se evita, con el método STRIDE del SDL de
Microsoft; fuente: Microsoft Security Development Lifecycle). No repite preguntas ya contestadas en la definición. Cada mitigación se convierte en un
criterio de la funcionalidad o la tarea que la construye.

### Walking skeleton

El *walking skeleton* (esqueleto que ya camina) es la porción de punta a punta más fina, con una
funcionalidad deliberadamente trivial, que demuestra que se puede construir, desplegar y probar todo
el recorrido (Freeman y Pryce, *Growing Object-Oriented Software, Guided by Tests*; Alistair Cockburn:
«una implementación diminuta… una pequeña función de punta a punta»). Se hace una sola vez, al
empezar el proyecto, como la primera tarea de la primera funcionalidad; no es diseñar y construir
entera la primera funcionalidad. La infraestructura mínima que necesita entra como tareas de esa
funcionalidad, no como un proyecto aparte.

### Épicas y backlog

Una épica agrupa funcionalidades que juntas cumplen una capacidad (una épica es una historia
demasiado grande para una iteración; Mike Cohn). En DEMIURGO solo existe cuando una capacidad no cabe
en una funcionalidad (convención nuestra). Tiene:

- **Objetivo**, que nombra el resultado de la definición al que sirve.
- **Fuera de alcance**, lo que deja fuera a propósito, para poder decir que no a lo que se cuela.
- **Terminada cuando**, la condición de cierre.

  Estos tres campos son convención nuestra (la hipótesis de épica de SAFe también lleva dentro y fuera
  de alcance; solo lo confirman fuentes secundarias).
- **Estado**: sin empezar, en curso o terminada (cuando todas sus funcionalidades vivas están
  construidas). Coincide con las tres categorías de estado por defecto de Jira (por hacer, en curso,
  hecho).
- Sus funcionalidades, que son registros desde que se listan, en el orden que decide la persona.

Las épicas forman un **backlog** (lista ordenada de trabajo pendiente; Scrum Guide) cuyo orden fija la persona. Ese
orden manda en la cola de construcción. Una épica crece por versiones. El backlog se refina de forma
continua, no en una fase única (Scrum Guide).

La primera versión es una porción fina que recorre toda la columna vertebral del mapa de historias
(Jeff Patton: «el sistema más pequeño posible que daría funcionalidad de punta a punta»;
https://jpattonassociates.com/the-new-backlog/), no la primera funcionalidad de cada épica.

La épica es la unidad de entrega: el conjunto de trabajo que se entrega junto. No existe un «Change
Set» aparte ni estados propios para él; bastan el estado de la épica y los de sus funcionalidades.

Una funcionalidad está **planificada** cuando está aprobada y ocupa un lugar en el orden de su
épica. Antes es una propuesta revisable, no trabajo prometido. (Se dice «planificada» y no
«comprometida»: en 2011 la Scrum Guide sustituyó el «commit» del equipo de desarrollo en la Sprint
Planning por «forecast» (pronóstico; scrum.org, «Commitment vs. Forecast»); desde 2020 «compromiso»
nombra el Product Goal, el Sprint Goal y la Definition of Done.)

### Funcionalidades

Una funcionalidad es una **historia** que aporta algo útil al usuario. Se escribe así:

- **Comportamiento**: el flujo principal de un caso de uso, en 3 a 9 pasos numerados (Alistair
  Cockburn, *Writing Effective Use Cases*: «Use 3 to 9 steps»; en otros textos suyos, 3 a 11).
  Rechazar lo que quede fuera de 3 a 9 es convención nuestra.
- **Criterios de aceptación**: cada uno en formato Dado/Cuando/Entonces (BDD, desarrollo guiado por
  comportamiento; Dan North) y ligado al paso que comprueba. Ligar cada criterio a un paso es
  convención nuestra.
- **Pequeña y comprobable** (INVEST, Bill Wake: la historia debe ser *Small* y *Testable*). INVEST no
  fija un número de criterios y aquí no hay tope. El agente estima su talla (XS a XL; Cohn admite
  tallas de camiseta y sugiere pasarlas a números). Se divide una historia cuando es demasiado grande
  para caber con holgura en una iteración o cuando el dueño del producto priorizaría distinto sus
  criterios (Mike Cohn). «XL significa dividir» es convención nuestra sobre eso. La división es en
  porciones verticales (Bill Wake, 2003, «slice the cake» y *Twenty ways to split stories*), con
  patrones de Richard Lawrence (Humanizing Work) y SPIDR (Cohn), en varias funcionalidades de su
  épica.
- **Definition of Ready** (lista para construir): ningún paso sin criterio. La Scrum Guide 2020 no
  tiene «Definition of Ready»: dice que los elementos que pueden quedar Hechos en un Sprint están
  «listos para su selección». Nuestra DoR es convención nuestra.
- **Definition of Done** (hecha), que Scrum sí exige (Scrum Guide 2020, https://scrumguides.org/scrum-guide.html).
  Para una funcionalidad, convención nuestra: cada criterio verificado por una prueba en verde en CI
  (o comprobado a mano si es manual), sus pull requests revisados y fusionados, y las comprobaciones de
  calidad de producción en verde.

La funcionalidad incluye el detalle de experiencia, datos o contratos que haga falta para
construirla y comprobarla. No hay documentos paralelos de requisitos ni de diseño detallado.

### Decisiones (ADR)

Un ADR recoge una decisión de arquitectura con opciones reales y consecuencias, en el formato MADR
(Markdown Architectural Decision Records: contexto, opciones, elección, motivo y consecuencias; no la
plantilla original de Nygard, que no lleva opciones). Que haya al menos dos opciones reales es
convención nuestra. Solo se crea cuando hace falta. Se basa en una funcionalidad o en
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
funcionalidad debe estar cubierto por alguna tarea. Convención nuestra, para la trazabilidad de
requisito a implementación: que las tareas listen los criterios que cubren y que los puntos sean
XS=1, S=2, M=3, L=5, XL=8 (tallas relativas, nunca duración).

Las tareas no se clasifican por área técnica (frontend, backend) ni por dominio funcional. La
etiqueta de aspecto y el código de la épica ya dicen de qué parte del producto se trata.

### Construcción y evidencia

- **GitHub flow** (documentación de GitHub): cada tarea tiene su rama y su pull request. No se usa
  GitFlow.
- **ATDD** (pruebas de aceptación primero): cada criterio automático tiene una prueba. Que su título
  empiece por el código del criterio es convención nuestra.
- La **evidencia** la registra DEMIURGO sola desde la integración continua (CI): el resultado de
  cada prueba del pull request, con su enlace. Es del criterio, no de la tarea. No se escribe a mano.
- **El agente construye solo.** DEMIURGO lanza el agente de cada tarea en el orden del backlog; el
  agente trabaja en su rama y abre el pull request. Un agente revisor lo revisa como lo haría un
  compañero. Si lo aprueba y todas las comprobaciones de CI pasan, el pull request se fusiona solo y
  la tarea queda hecha. Exigir las comprobaciones de estado obligatorias antes de fusionar es la
  protección de rama de GitHub, y el auto-merge es comportamiento estándar: «Auto-merge merges a pull
  request automatically after all required reviews and status checks pass» (documentación de GitHub,
  https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request).
  Lo único que es decisión de la persona es que quien aprueba sea un agente. El agente revisor sigue
  un estándar de revisión: aprobar en cuanto el cambio mejora con seguridad la salud general del
  código, aunque no sea perfecto (Google eng-practices,
  https://google.github.io/eng-practices/review/reviewer/standard.html). Si algo falla o el revisor no aprueba, el
  agente lo intenta arreglar y, si no puede, se lo muestra a la persona en la ficha de la tarea.
- **Dónde y cómo se construye (decisiones de la persona, 30-09).** Cada proyecto tiene un repo
  privado en GitHub. El agente constructor escribe código y ejecuta pruebas solo dentro de un
  contenedor aislado, sin credenciales de GitHub, y solo cuando la persona pulsa «Construir con un
  agente». DEMIURGO hace el commit, el push y el pull request. Como en GitHub el autor de un pull
  request no puede aprobarlo, el veredicto del revisor es la comprobación obligatoria
  `demiurgo/review`, junto a `ci` (convención nuestra dentro de la protección de rama de GitHub). La
  CI del proyecto la añade la primera tarea, el walking skeleton, y publica sus resultados JUnit
  como artefacto `junit` (convención nuestra).
- Una tarea hecha no demuestra por sí sola que se cumplan sus criterios. La evidencia vale para el
  resultado concreto que se comprobó.

### Calidad de producción

Una aplicación tiene calidad de producción cuando cumple los estándares por defecto de un equipo
serio, comprobados sobre una versión concreta:

- todos los criterios de aceptación tienen su prueba en verde;
- no hay vulnerabilidades altas ni críticas y se cumple OWASP ASVS nivel 2 («Most applications should be striving to achieve this level»,
  ASVS 5.0, con la salvedad de que cada organización debe analizar sus riesgos y decidir el nivel;
  https://github.com/OWASP/ASVS/blob/master/5.0/en/0x03-What-is-the-ASVS.md; el Top 10 es solo
  concienciación), más análisis de dependencias;
- accesibilidad WCAG 2.2 AA en las interfaces (W3C);
- se cumplen las metas de calidad con número de la definición.

Una excepción solo vale si la persona la acepta por escrito, con su motivo. Una valoración favorable
de la IA no basta.

### Entrega y operación

- Cómo se entrega depende del tipo de aplicación: una web se despliega y aloja; un juego o una
  herramienta se distribuye de otra forma. El alojamiento web es una opción, no un requisito.
- **Observabilidad** como en cualquier servicio serio: registros, métricas y trazas (OpenTelemetry, CNCF)
  de la aplicación entregada, alertas sobre sus metas de calidad, y cada incidencia convertida en
  algo que la persona entiende por su efecto en el producto. El trabajo de la IA se ve igual: estado,
  bloqueos y consumo de cada ejecución.

### Revisión y cambios

El diseño se revisa como un RFC dentro de DEMIURGO, no en ramas (práctica de RFC de equipos de ingeniería):

- Un registro pasa de borrador a aprobado. Ese paso es la revisión del diseño.
- El borrador muestra «Cambios desde la vN» sección a sección, con los criterios añadidos,
  cambiados o quitados. Es convención nuestra, inspirada en los apéndices de cambios de los borradores
  del IETF y en el diff de un pull request; no es un estándar establecido.
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
| FDR | Funcionalidad | Flujo principal en 3–9 pasos y criterios Dado/Cuando/Entonces ligados a sus pasos | Su épica o la definición |
| ADR | Decisión de arquitectura | Contexto, opciones, elección, motivo y consecuencias (MADR) | Una funcionalidad o una restricción u objetivo de la definición |
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
- El primer paso es diseñar la primera funcionalidad (FDR-GUI-005). Su primera tarea es el walking
  skeleton: la porción de punta a punta más fina, con funcionalidad trivial, que prueba que se puede
  construir, desplegar y probar todo el recorrido.
- La v3 hereda el **conocimiento y los motivos** acumulados, con su origen. No hereda tareas
  terminadas ni evidencias: se referían a otro código.
- Lo que la v2.3 echa en falta se anota como parche o como idea para la v3. Ningún parche pasa tal
  cual a la v3.

Este uso sobre sí mismo es una prueba importante de que el producto aporta valor, pero no la única.

## 7. Pendiente de decidir

Casi todo está decidido. Lo que sigue queda para después o ya tiene rumbo fijado:

- **El arranque como conversación.** El primer día se hace como una conversación con panel lateral,
  no como una lista de respuestas. Se diseña en la v3.
- **Un vocabulario único de nombres.** DEMIURGO guarda un nombre por cosa y avisa cuando el diseño,
  los textos o el código llaman distinto a lo mismo. Se diseña en la v3.
- **Las fichas de épica, funcionalidad y tarea, y cómo se listan épicas e hilos.** Se están
  rediseñando con buenas prácticas de interfaz (octubre de 2026).
- **Sin mapa de conocimiento aparte.** Como en Linear o Jira, cada ficha muestra «En qué se basa» y
  «Qué depende de esto», y hay búsqueda. No hay una pantalla de grafo.
- **Incorporar aplicaciones existentes**, no solo empezar desde una idea. Entra en el alcance, más
  adelante.
- **El equipo** (quién decide qué cuando trabajan varias personas) se decide después de la v3. La v3
  es para una persona.

## Referencias

Como marco del ciclo de vida se consultan ISO/IEC/IEEE 12207, 29148 (requisitos) y 29119-2
(pruebas), y la guía de verificación de producto de la NASA. Se adaptan al producto; no se afirma
conformidad ni certificación.

## 8. Glosario

| Término | Significado |
| --- | --- |
| ADR | Architecture Decision Record: registro de una decisión de arquitectura con opciones y consecuencias (formato MADR). |
| ATDD | Acceptance Test-Driven Development: cada criterio automático tiene su prueba, escrita a partir del criterio. |
| Backlog | Lista ordenada del trabajo pendiente; aquí, las épicas en el orden que fija la persona. |
| Planificada | Funcionalidad aprobada que ocupa un lugar en el orden de su épica. |
| Criterio de aceptación (AC) | Condición observable Dado/Cuando/Entonces que debe cumplirse para aceptar una funcionalidad. |
| Definition of Ready | Condición para empezar a construir. La Scrum Guide 2020 no la define; es convención nuestra: ningún paso de la funcionalidad sin criterio. |
| Definition of Done | Condición para dar algo por hecho; Scrum la exige y cada equipo fija su contenido. Convención nuestra para una funcionalidad: cada criterio verificado por una prueba en verde en CI (o a mano si es manual), sus pull requests revisados y fusionados, y la calidad de producción en verde. |
| Encargo | El texto que recibe quien construye una tarea: qué hacer, qué criterios cubre y qué ya existe. |
| Épica (EPC) | Conjunto ordenado de funcionalidades para una capacidad que no cabe en una sola; es la unidad de entrega. |
| Evidencia | Prueba de que un criterio se cumple: el pull request y la prueba que lo comprueba. |
| Funcionalidad (FDR) | Historia pequeña y comprobable (INVEST) con flujo principal en 3 a 9 pasos y sus criterios. |
| GitHub flow | Una rama y un pull request por cambio, que se fusiona tras aprobarse y pasar la CI. Aquí lo aprueba un agente revisor (decisión de la persona). |
| Hilo | Conversación con los agentes sobre un tema; de ella salen preguntas y propuestas. |
| INVEST | Regla para historias (Bill Wake): independientes, negociables, valiosas, estimables, pequeñas (*Small*) y comprobables (*Testable*). No fija un número de criterios. |
| Propuesta | Cómo llega cualquier cosa de la IA; no vale nada hasta que la persona la acepta o la aprueba. |
| RFC | Request for Comments: documento de propuesta que el equipo revisa antes de aprobarlo. Nuestro «Cambios desde la vN» es convención nuestra, inspirada en los apéndices de cambios de los borradores del IETF; no es un estándar establecido. |
| STRIDE / SDL | Método de Microsoft para buscar amenazas de seguridad en el diseño, antes de construir. |
| Tarea (TSK) | Trozo de implementación de una funcionalidad, con tamaño y los criterios que cubre. |
| Walking skeleton | La porción de punta a punta más fina, con funcionalidad trivial, que prueba que se puede construir, desplegar y probar todo; se hace una vez, como primera tarea de la primera funcionalidad (Freeman y Pryce; Cockburn). |
