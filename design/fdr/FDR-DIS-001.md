---
codigo: FDR-DIS-001
tipo: fdr
titulo: De la intención a «Listo para construir», con canal de agentes
version: 1
estado: propuesto
dominio: diseno
incremento: S1
enlaces:
  - tipo: based_on
    destino: DEC-PLN-001@1
anexos: []
---

# FDR-DIS-001 · De la intención a «Listo para construir», con canal de agentes

## Objetivo

La franja más fina del Pilar 1, usable por una persona o por un agente: partir de una intención y llegar a una decisión aprobada y a una FDR con AC «Listo para construir», con la bandeja vacía. Sin UI: la aceptación humana se hace por la API con la cookie de sesión.

## Alcance

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

## Fuera de alcance

- La UI: se decidirá en Claude Design.
- La política de atención y la síntesis por ronda (S6).
- El impacto de una versión nueva sobre lo que depende de ella (S7).
- El conocimiento derivado y la evaluación de ideas (S2).
- Varias personas o equipos.

## Comportamiento

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
8. Aprobar no crea versión. La vigente es la última aprobada y la aprobada anterior pasa a sustituida. Una versión nueva arrastra cada criterio de forma explícita: mantener, modificar o descartar.
9. Si una dependencia declarada de una propuesta cambió, aceptarla se rechaza con aviso de obsolescencia y la propuesta queda obsoleta.
10. El reintento de una ejecución usa el mismo context pack que el envío.
11. Cada elemento de la bandeja y del estado del producto lleva su estado epistémico: confirmado, propuesto, pendiente o desconocido.

## Criterios de aceptación

### AC-DIS-001-01 · Recorrido completo

- Verificación: automática
- Comprobación: Un E2E por la API con el simulador recorre el camino entero.

Dada una intención nueva, cuando la persona acepta y aprueba la decisión propuesta, acepta en un paso la propuesta de diseño (una FDR con 2 AC) y aprueba la FDR, entonces la FDR aparece como «Listo para construir» y la bandeja queda vacía.

### AC-DIS-001-02 · Canal de agentes por API

- Verificación: automática
- Comprobación: Un agente de prueba usa la API con su token y la persona acepta con su sesión.

Dado un agente con token, cuando usa la API, entonces lee, conversa con su nombre, registra una fuente y propone; y la persona acepta la propuesta con su sesión.

### AC-DIS-001-03 · Canal de agentes por MCP

- Verificación: automática
- Comprobación: Un cliente MCP de prueba llama a cada herramienta del servidor.

Dado un agente conectado por MCP, cuando usa las herramientas, entonces puede leer, conversar, registrar fuentes y proponer, y ninguna herramienta aprueba ni acepta.

### AC-DIS-001-04 · Decisivos solo humanos

- Verificación: automática
- Comprobación: Una prueba de propiedades recorre los comandos decisivos con actores no humanos.

Dado cualquier comando decisivo, cuando lo ejecuta un actor que no es humano, entonces se rechaza sin efectos.

### AC-DIS-001-05 · Lista de permitidos del agente

- Verificación: automática
- Comprobación: Se recorren con un token de agente todas las operaciones de la API.

Dado un token de agente, cuando pide cualquier operación que no sea leer, conversar, registrar fuentes o proponer, entonces recibe 403.

### AC-DIS-001-06 · Readiness falsa por cada motivo

- Verificación: automática
- Comprobación: Una prueba por motivo construye una versión a la que solo le falta esa condición.

Dada una versión a la que le falta una sola condición, cuando se calcula su readiness, entonces es falsa y explica el motivo en lenguaje de producto. Se cubre cada motivo: versión no aprobada, no vigente, sin criterios, sin decisión aprobada, decisión no vigente, enlace pendiente de revisión, preguntas pendientes o pospuestas en la exploración de origen y propuestas pendientes que la afectan.

### AC-DIS-001-07 · Mismo context pack en el reintento

- Verificación: automática
- Comprobación: Se reintenta una ejecución y se comparan los hashes de los dos context packs.

Dada una ejecución terminada, cuando se reintenta, entonces el hash del context pack del reintento coincide con el del envío.

### AC-DIS-001-08 · Aprobar no crea versión

- Verificación: automática
- Comprobación: Se aprueba una versión y se cuentan las versiones del registro.

Dada una versión en borrador, cuando se aprueba, entonces el número de versiones no cambia, la vigente es la última aprobada y la aprobada anterior queda sustituida.

### AC-DIS-001-09 · Contenido inmutable

- Verificación: automática
- Comprobación: Se intenta modificar una versión y sus criterios en la base, y se crea una versión nueva sin arrastrar todos los criterios.

Dada una versión con criterios, cuando se intenta modificar su contenido o sus criterios, entonces la base lo rechaza; y una versión nueva exige arrastrar cada criterio: mantener, modificar o descartar.

### AC-DIS-001-10 · Gobierno de preguntas

- Verificación: automática
- Comprobación: Se confirma, pospone, descarta y reabre una pregunta con y sin los datos exigidos.

Dada una pregunta, cuando se confirma sin conclusión o se pospone o descarta sin motivo, entonces se rechaza; y cuando se reabre, conserva su historial.

### AC-DIS-001-11 · Lotes de agentes externos

- Verificación: automática
- Comprobación: Un agente externo envía lotes de 10 y de 11 propuestas y la persona resuelve uno.

Dado un agente externo, cuando envía un lote de más de 10 propuestas, entonces se rechaza; y un lote admitido se resuelve elemento a elemento y muestra su productor.

### AC-DIS-001-12 · Estado epistémico visible

- Verificación: automática
- Comprobación: Se consultan la bandeja y el estado del producto con elementos en cada estado.

Dada la bandeja y el estado del producto, cuando se consultan, entonces cada elemento lleva su estado epistémico: confirmado, propuesto, pendiente o desconocido.

### AC-DIS-001-13 · Estado del producto mínimo

- Verificación: automática
- Comprobación: Se consulta el estado de un proyecto con decisiones, diseños y propuestas pendientes.

Dado un proyecto con decisiones y diseños, cuando se consulta su estado, entonces lista cada uno con su versión vigente, su estado y su readiness, junto con el recuento de la bandeja.

### AC-DIS-001-14 · Chequeo de verificabilidad

- Verificación: automática
- Comprobación: Se registra un AC con un enunciado no observable.

Dado un AC cuyo enunciado no es observable, cuando se registra, entonces recibe un aviso y se guarda igualmente: el chequeo nunca bloquea.

### AC-DIS-001-15 · Credencial humana protegida

- Verificación: automática
- Comprobación: Se revisan los atributos de la cookie, se envía una mutación sin token CSRF y se intenta abrir sesión con un token de agente.

Dada la sesión humana, cuando se emite la cookie, entonces es httpOnly y SameSite=Strict; una mutación con cookie sin el token CSRF se rechaza; y un token de agente no obtiene una sesión humana.

### AC-DIS-001-16 · Propuesta obsoleta

- Verificación: automática
- Comprobación: Se cambia una dependencia declarada de una propuesta pendiente y la persona intenta aceptarla.

Dada una propuesta con una dependencia declarada que cambió, cuando la persona la acepta, entonces se rechaza con aviso de obsolescencia y la propuesta queda obsoleta.

### AC-DIS-001-17 · Ejecución real registrada

- Verificación: manual
- Comprobación: La persona revisa la ejecución real registrada y su resultado.

Dado S1 terminado, cuando se revisa el registro de ejecuciones, entonces hay al menos una ejecución real con Claude registrada con su resultado.
