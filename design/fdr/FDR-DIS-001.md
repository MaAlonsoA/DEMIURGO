---
code: FDR-DIS-001
type: fdr
title: De la intención a «Listo para construir», con canal de agentes
version: 1
state: proposed
domain: diseno
increment: S1
links:
  - type: based_on
    target: DEC-PLN-001@1
annexes: []
---

# FDR-DIS-001 · De la intención a «Listo para construir», con canal de agentes

## Goal

La franja más fina del Pilar 1, usable por una persona o por un agente: partir de una intención y llegar a una decisión aprobada y a una FDR con AC «Listo para construir», con la bandeja vacía. Sin UI: la aceptación humana se hace por la API con la cookie de sesión.

## Scope

- Exploraciones con propósito y origen, hilos de mensajes con el actor como autor y la acción de IA `exploration_chat`.
- Preguntas con su ciclo de vida: confirmar con conclusión, posponer y descartar con motivo, y reabrir conservando el historial.
- Lotes de propuestas con su ejecución y su context pack, y una bandeja única.
- Registros (decisión, FDR, ADR y bug) con versiones de contenido inmutable, plantilla validada y aprobación sin crear versión.
- Criterios de aceptación con verificación, comprobación y chequeo de verificabilidad.
- Acción `design_proposal`: una FDR con sus AC en un paquete que se acepta en un paso.
- Readiness de una versión y el estado «Listo para construir».
- «Estado del producto» mínimo y estado epistémico visible.
- Canal de agentes por API con token y por servidor MCP: leer, conversar con su nombre, registrar fuentes y proponer.
- Sesión humana con cookie httpOnly, SameSite=Strict y token CSRF.

## Out of scope

- La UI: se decidirá en Claude Design.
- La política de atención y la síntesis por ronda (S6).
- El impacto de una versión nueva sobre lo que depende de ella (S7).
- El conocimiento derivado y la evaluación de ideas (S2).
- Varias personas o equipos.

## Behavior

1. La persona abre una exploración con su intención. La acción `exploration_chat` responde con un mensaje y, si procede, con preguntas y propuestas en un lote pendiente.
2. La persona acepta la propuesta de decisión con «Aceptar y aprobar»: se crea el registro con su versión y se aprueba en el mismo paso humano.
3. La acción `design_proposal` propone una FDR con sus AC como un paquete. La persona lo acepta en un paso y aprueba la versión.
4. La readiness de una versión es verdadera solo si:
   - la versión está aprobada y es la vigente;
   - tiene al menos un criterio;
   - se basa en una decisión aprobada y vigente;
   - ningún enlace está pendiente de revisión;
   - no quedan preguntas pendientes ni pospuestas en su exploración de origen;
   - ninguna propuesta pendiente la afecta.
5. Si la readiness es falsa, devuelve cada motivo en lenguaje de producto. Si es verdadera, la FDR aparece como «Listo para construir».
6. Un agente externo, con su token, puede leer, conversar con su nombre, registrar fuentes y proponer, por la API o por MCP. Todo lo demás devuelve 403.
7. Los lotes de un agente externo llevan como máximo 10 propuestas y se resuelven elemento a elemento, con el productor visible.
8. Aprobar no crea versión. La vigente es la última aprobada y la aprobada anterior pasa a sustituida; un borrador anterior a una versión ya aprobada no se aprueba, se descarta. Una versión nueva arrastra cada criterio de forma explícita: mantener, modificar o descartar. Los criterios y los enlaces solo nacen con su versión y un criterio nuevo nunca reutiliza un código ya usado.
9. Si una dependencia declarada de una propuesta cambió, aceptarla se rechaza con aviso de obsolescencia y la propuesta queda obsoleta. Queda obsoleta en cuanto se aprueba la versión nueva, o al enviarla si ya nace obsoleta; en un paquete, o si la dependencia es del lote, queda obsoleto el lote entero. La referencia `based_on` de una FDR propuesta cuenta como dependencia declarada.
10. El reintento de una ejecución usa el mismo context pack que el envío.
11. Cada elemento de la bandeja, del estado del producto y del detalle de una exploración o de un lote lleva su estado epistémico: confirmado, propuesto, pendiente o desconocido, según la tabla de correspondencias de abajo. La bandeja reúne todo lo que espera a la persona: propuestas pendientes, preguntas inferidas, pendientes y pospuestas, versiones en borrador y enlaces pendientes de revisión.
12. El chequeo de verificabilidad de S1 es una regla determinista, que el Noul del clasificador sustituirá. Nunca bloquea: el AC se guarda igualmente. Un AC recibe un aviso si su enunciado:
    - no contiene un resultado observable, es decir, ninguna palabra como cuando, entonces, ve, recibe, muestra, devuelve, aparece, queda, rechaza, falla, contiene, guarda o responde;
    - o contiene un término vago: rápido, fácil, intuitivo, adecuado, correctamente, bien, amigable, robusto, eficiente o mejor.
13. Un registro se crea y se aprueba solo si sus secciones cumplen la plantilla de su tipo. Si no, se rechaza con lo que falta.
14. Solo el sistema pasa una pregunta a inferida, a partir de la salida validada de un agente. Un agente no puede inferirla ni confirmarla.
15. Cada lote de una ejecución guarda la ejecución y el context pack que lo produjeron.

Correspondencia del estado epistémico (AC-DIS-001-12 se comprueba contra esta tabla):

| Elemento | Estado epistémico |
|---|---|
| Versión aprobada | confirmado |
| Versión en borrador | propuesto |
| Propuesta pendiente | propuesto |
| Propuesta aceptada | confirmado |
| Pregunta confirmada | confirmado |
| Pregunta inferida | propuesto |
| Pregunta pendiente o pospuesta | pendiente |
| Observación `claim` o `hypothesis` | propuesto |
| Observación `unknown` | desconocido |
| Enlace pendiente de revisión | pendiente |

## Acceptance criteria

### AC-DIS-001-01 · Recorrido completo

- Verification: automatic
- Check: Un E2E por la API con el simulador recorre el camino entero.

Dada una intención nueva, cuando la persona acepta y aprueba la decisión propuesta, acepta en un paso la propuesta de diseño (una FDR con 2 AC) y aprueba la FDR, entonces la FDR aparece como «Listo para construir» y la bandeja queda vacía.

### AC-DIS-001-02 · Canal de agentes por API

- Verification: automatic
- Check: Un agente de prueba usa la API con su token y la persona acepta con su sesión.

Dado un agente con token, cuando usa la API, entonces lee, conversa con su nombre, registra una fuente y propone; y la persona acepta la propuesta con su sesión.

### AC-DIS-001-03 · Canal de agentes por MCP

- Verification: automatic
- Check: Un cliente MCP de prueba llama a cada herramienta del servidor.

Dado un agente conectado por MCP, cuando usa las herramientas, entonces puede leer, conversar, registrar fuentes y proponer, y ninguna herramienta aprueba ni acepta.

### AC-DIS-001-04 · Decisivos solo humanos

- Verification: automatic
- Check: Una prueba de propiedades recorre los comandos decisivos con actores no humanos.

Dado cualquier comando decisivo, cuando lo ejecuta un actor que no es humano, entonces se rechaza sin efectos.

### AC-DIS-001-05 · Lista de permitidos del agente

- Verification: automatic
- Check: Se recorren con un token de agente todas las operaciones de la API.

Dado un token de agente, cuando pide cualquier operación que no sea leer, conversar, registrar fuentes o proponer, entonces recibe 403.

### AC-DIS-001-06 · Readiness falsa por cada motivo

- Verification: automatic
- Check: Una prueba por motivo construye una versión a la que solo le falta esa condición.

Dada una versión a la que le falta una sola condición, cuando se calcula su readiness, entonces es falsa y explica el motivo en lenguaje de producto. Se cubre cada motivo: versión no aprobada, no vigente, sin criterios, sin decisión aprobada, decisión no vigente, enlace pendiente de revisión, preguntas pendientes o pospuestas en la exploración de origen y propuestas pendientes que la afectan.

### AC-DIS-001-07 · Mismo context pack en el reintento

- Verification: automatic
- Check: Se reintenta una ejecución y se comparan los hashes de los dos context packs.

Dada una ejecución terminada, cuando se reintenta, entonces el hash del context pack del reintento coincide con el del envío.

### AC-DIS-001-08 · Aprobar no crea versión

- Verification: automatic
- Check: Se aprueba una versión y se cuentan las versiones del registro.

Dada una versión en borrador, cuando se aprueba, entonces el número de versiones no cambia, la vigente es la última aprobada y la aprobada anterior queda sustituida.

### AC-DIS-001-09 · Contenido inmutable

- Verification: automatic
- Check: Se intenta modificar una versión y sus criterios en la base, y se crea una versión nueva sin arrastrar todos los criterios.

Dada una versión con criterios, cuando se intenta modificar su contenido o sus criterios, entonces la base lo rechaza; y una versión nueva exige arrastrar cada criterio: mantener, modificar o descartar.

### AC-DIS-001-10 · Gobierno de preguntas

- Verification: automatic
- Check: Se confirma, pospone, descarta y reabre una pregunta con y sin los datos exigidos.

Dada una pregunta, cuando se confirma sin conclusión o se pospone o descarta sin motivo, entonces se rechaza; y cuando se reabre, conserva su historial.

### AC-DIS-001-11 · Lotes de agentes externos

- Verification: automatic
- Check: Un agente externo envía lotes de 10 y de 11 propuestas y la persona resuelve uno.

Dado un agente externo, cuando envía un lote de más de 10 propuestas, entonces se rechaza; y un lote admitido se resuelve elemento a elemento y muestra su productor.

### AC-DIS-001-12 · Estado epistémico visible

- Verification: automatic
- Check: Se consultan la bandeja, el estado del producto y los detalles de exploración y de lote con un elemento de cada fila de la tabla de correspondencias y se compara el estado epistémico de cada uno con la tabla.

Dada la bandeja, el estado del producto y los detalles de exploración y de lote, cuando se consultan, entonces cada elemento lleva el estado epistémico que le asigna la tabla de correspondencias de Comportamiento: confirmado, propuesto, pendiente o desconocido.

### AC-DIS-001-13 · Estado del producto mínimo

- Verification: automatic
- Check: Se consulta el estado de un proyecto con decisiones, diseños y propuestas pendientes.

Dado un proyecto con decisiones y diseños, cuando se consulta su estado, entonces lista cada uno con su versión vigente, su estado y su readiness, junto con el recuento de la bandeja.

### AC-DIS-001-14 · Chequeo de verificabilidad

- Verification: automatic
- Check: Se registran un AC sin ninguna palabra de resultado observable, otro con un término vago y otro que cumple la regla.

Dado un AC cuyo enunciado no contiene ninguna palabra de resultado observable o contiene un término vago de la regla determinista de S1 (Comportamiento, punto 12), cuando se registra, entonces recibe un aviso y se guarda igualmente: el chequeo nunca bloquea. Un AC que cumple la regla no recibe aviso.

### AC-DIS-001-15 · Credencial humana protegida

- Verification: automatic
- Check: Se revisan los atributos de la cookie, se envía una mutación sin token CSRF y se intenta abrir sesión con un token de agente.

Dada la sesión humana, cuando se emite la cookie, entonces es httpOnly y SameSite=Strict; una mutación con cookie sin el token CSRF se rechaza; y un token de agente no obtiene una sesión humana.

### AC-DIS-001-16 · Propuesta obsoleta

- Verification: automatic
- Check: Se cambia una dependencia declarada de una propuesta pendiente y la persona intenta aceptarla.

Dada una propuesta con una dependencia declarada que cambió, cuando la persona la acepta, entonces se rechaza con aviso de obsolescencia y la propuesta queda obsoleta.

### AC-DIS-001-17 · Ejecución real registrada

- Verification: manual
- Check: La persona revisa la ejecución real registrada y su resultado.

Dado S1 terminado, cuando se revisa el registro de ejecuciones, entonces hay al menos una ejecución real con Claude registrada con su resultado.

### AC-DIS-001-18 · Plantilla obligatoria

- Verification: automatic
- Check: Se crea y se aprueba un registro de cada tipo al que le falta una sección de su plantilla.

Dado un registro cuyas secciones no cumplen la plantilla de su tipo (por ejemplo, un bug sin Reproducción), cuando se crea o se aprueba, entonces se rechaza con lo que falta.

### AC-DIS-001-19 · Inferir es del sistema

- Verification: automatic
- Check: Un agente intenta inferir y confirmar una pregunta, y el sistema la infiere a partir de la salida validada de una ejecución.

Dada una pregunta pendiente, cuando un agente intenta inferirla o confirmarla, entonces se rechaza; y solo el sistema la pasa a inferida, a partir de la salida validada de un agente.

### AC-DIS-001-20 · Procedencia del lote

- Verification: automatic
- Check: Se completa una ejecución que produce un lote y se revisa lo que guarda el lote.

Dada una ejecución que produce un lote de propuestas, cuando se guarda el lote, entonces guarda la ejecución y el context pack que lo produjeron.
