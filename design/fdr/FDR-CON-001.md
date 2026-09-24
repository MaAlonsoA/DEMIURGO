---
code: FDR-CON-001
type: fdr
title: Conocimiento y contexto básicos
version: 1
state: proposed
domain: conocimiento
increment: S2
links:
  - type: based_on
    target: DEC-PLN-001@1
annexes: []
---

# FDR-CON-001 · Conocimiento y contexto básicos

## Goal

Que el conocimiento del proyecto se mantenga al día solo, con un paso verificado, y que cada acción reciba el contexto relevante dentro de un presupuesto. Clasificar nunca es decidir: lo que afecta a la autoridad llega a la persona como propuesta.

## Scope

- Grafo de conocimiento en Postgres detrás del puerto `KnowledgeGraph`, como proyección reconstruible de la autoridad.
- Taxonomía con versiones, aprobada por la persona (TAX-001).
- Clasificador detrás del puerto `Classifier` (ADR-CLA-001), con salida validada y veredictos guardados por `input_hash`.
- Paso «Actualizar conocimiento», disparado por cada evento de autoridad y verificado de forma determinista.
- Invalidar en lugar de borrar, con versión del grafo.
- Gate de frescura.
- Evaluación de cada idea nueva, visible en la bandeja.
- Context packs por rol con presupuesto y hash.
- Importador idempotente de `design/`.
- Conjunto de evaluación del clasificador con precisión y cobertura registradas.

## Out of scope

- Jev real: su adaptador queda vacío.
- Búsqueda semántica y pgvector, salvo que una evaluación lo justifique.
- Mejorar el clasificador con las correcciones de la persona (S9).
- La vista de relaciones sobre el grafo (S7).
- Clasificaciones que cambian el flujo, como el tipo de trabajo o el riesgo.

## Behavior

1. Cada evento de autoridad (una versión aprobada, un AC modificado o una propuesta aceptada) encola «Actualizar conocimiento». Descartar un borrador también la encola: retira lo que había proyectado. Una propuesta aceptada y aprobada en el mismo paso solo encola la aprobación, y lo confirmado nunca vuelve a propuesto.
2. Los candidatos se eligen de forma determinista: vecinos a distancia 1 de lo que el cambio sustituye o enlaza, coincidencias de texto (similitud léxica propia, sin acentos ni palabras vacías, reproducible en la reconstrucción) y nodos con las mismas categorías. El conjunto está acotado y lleva hash. La búsqueda para la persona usa FTS `spanish`.
3. El clasificador da un veredicto por candidato (`keep`, `update`, `invalidate`, `add`, `relate` u `other`) con su confianza. La cascada decide: la confianza alta se aplica, la media la revisa un LLM si hay un revisor configurado y la baja queda pendiente de la persona. Lo que tras la cascada no tiene confianza alta no se aplica solo: una categoría queda pendiente de la persona en la bandeja y una relación queda anotada en la actualización, sin aplicar.
4. La verificación es determinista: cada candidato tiene exactamente un veredicto, todas las referencias existen y eran candidatas, cada categoría es de un eje de la taxonomía aprobada y ningún veredicto cambia la autoridad (esos salen como propuesta, localizando el registro por el origen del nodo). Si algo falla, o si una revisión no puede proponerse o el sistema falla al procesarlo, el update queda `rejected` sin efectos y el fallo se registra. Solo las salidas verificadas se guardan por `input_hash`: reintentar vuelve a preguntar.
5. La aplicación es una transacción con su evento. La versión del grafo sube, y lo sustituido queda con `valid_to` y nunca se borra.
6. Pedir una ejecución con un evento de autoridad sin proyectar se rechaza porque el grafo está desfasado.
7. Cada idea o propuesta nueva se compara con el conocimiento. Los hallazgos (`relates`, `conflicts`, `inconsistent` y `duplicates`) citan nodo@versión y se ven en la bandeja.
8. Un constructor puro por rol recorre el grafo desde el alcance de la acción, elige nodos dentro del presupuesto y registra el motivo de cada uno, la versión del grafo, las dependencias y el hash.
9. El importador lee `design/` y crea o reconoce cada elemento sin duplicar.
10. Reconstruir el grafo desde la autoridad con las clasificaciones guardadas, en el orden en que se aplicó cada actualización, da la misma huella. Si no coincide, la comparación informa de la deriva. La huella es el sha256 del JSON canónico de todos los nodos y aristas del proyecto, con su referencia, sus categorías, su estado epistémico y las versiones del grafo en que nacen y en que se invalidan, sin ids ni fechas.

## Acceptance criteria

### AC-CON-001-01 · Aprobar dispara la actualización

- Verification: automatic
- Check: Se aprueba una versión y se miran el update encolado y la versión del grafo.

Dada una versión en borrador, cuando la persona la aprueba, entonces se dispara «Actualizar conocimiento» y la versión del grafo sube.

### AC-CON-001-02 · Candidato sin veredicto

- Verification: automatic
- Check: El simulador devuelve veredictos que dejan fuera un candidato.

Dado un update cuyos veredictos no cubren un candidato, cuando se verifica, entonces queda `rejected` sin efectos.

### AC-CON-001-03 · Nodo inexistente

- Verification: automatic
- Check: El simulador devuelve un veredicto que cita un nodo que no existe.

Dado un veredicto que cita un nodo inexistente, cuando se verifica el update, entonces queda `rejected` sin efectos.

### AC-CON-001-04 · Autoridad solo por propuesta

- Verification: automatic
- Check: El simulador invalida una decisión aprobada y se miran la bandeja y la decisión.

Dado un veredicto que invalida una decisión aprobada, cuando se aplica el update, entonces aparece una propuesta en la bandeja y la decisión no cambia.

### AC-CON-001-05 · Invalidar en lugar de borrar

- Verification: automatic
- Check: Se aplica un update que sustituye un nodo y se busca el nodo anterior.

Dado un nodo sustituido por un update, cuando se aplica, entonces el nodo queda con `valid_to` y sigue en el grafo.

### AC-CON-001-06 · Reconstrucción con la misma huella

- Verification: automatic
- Check: Se reconstruye el grafo desde cero y se comparan las huellas.

Dado un grafo mantenido de forma incremental, cuando se reconstruye desde la autoridad con las clasificaciones guardadas, entonces su huella es la misma. La huella es el sha256 del JSON canónico de todos los nodos y aristas del proyecto (referencia, categorías, estado epistémico, versión del grafo en que nacen y en que se invalidan), sin ids ni fechas.

### AC-CON-001-07 · Gate de frescura

- Verification: automatic
- Check: Se pide una ejecución con un evento de autoridad aún sin proyectar.

Dado un evento de autoridad sin proyectar, cuando se pide una ejecución, entonces se rechaza porque el grafo está desfasado.

### AC-CON-001-08 · Evaluación de ideas

- Verification: automatic
- Check: Se propone una idea que repite una decisión aprobada y se mira la bandeja.

Dada una idea que duplica una decisión aprobada, cuando se evalúa, entonces aparece en la bandeja marcada como duplicado con la cita del nodo@versión.

### AC-CON-001-09 · Context packs por rol

- Verification: automatic
- Check: Se construye dos veces el pack de un rol con el mismo alcance y el mismo grafo.

Dado un rol y un alcance, cuando se construye el context pack, entonces registra rol, presupuesto, nodos con su motivo, versión del grafo, dependencias y hash; y con el mismo alcance y el mismo grafo, el hash es el mismo.

### AC-CON-001-10 · Importador idempotente

- Verification: automatic
- Check: Se importa `design/` dos veces y se comparan los recuentos.

Dado `design/`, cuando se importa dos veces, entonces la segunda importación no duplica nada.

### AC-CON-001-11 · Evaluación del clasificador registrada

- Verification: automatic
- Check: Se ejecuta la evaluación con el simulador y se revisan el archivo de resultados y la tabla.

Dado el conjunto de evaluación del clasificador, cuando se ejecuta, entonces la precisión y la cobertura por veredicto quedan registradas en un archivo y en la base.

### AC-CON-001-12 · El clasificador no toca la autoridad

- Verification: automatic
- Check: Una prueba de arquitectura revisa qué tablas y comandos escriben el clasificador y el paso de actualización.

Dado el código del clasificador y del paso de actualización, cuando se revisa qué escriben, entonces solo escriben conocimiento derivado, clasificaciones y propuestas.

### AC-CON-001-13 · Veredictos reutilizados por input_hash

- Verification: automatic
- Check: Se clasifica dos veces la misma entrada y se cuentan las llamadas al clasificador.

Dado un veredicto guardado para un `input_hash`, cuando llega la misma entrada, entonces se reutiliza sin volver a llamar al clasificador.

### AC-CON-001-14 · Confianza baja a la persona

- Verification: automatic
- Check: El simulador devuelve una clasificación de confianza baja y se mira la bandeja.

Dada una clasificación de confianza baja, cuando se registra, entonces queda pendiente de revisión y aparece en la bandeja.

### AC-CON-001-15 · Taxonomía aprobada

- Verification: automatic
- Check: Se clasifica con una taxonomía en borrador y otra aprobada, y sin ninguna aprobada.

Dada una taxonomía en borrador y otra aprobada, cuando se clasifica, entonces solo se usa la aprobada vigente; y sin taxonomía aprobada no se clasifica.

### AC-CON-001-16 · Ejecución real registrada

- Verification: manual
- Check: La persona revisa la evaluación real registrada con el adaptador de referencia.

Dado S2 terminado, cuando se revisan las evaluaciones, entonces hay al menos una evaluación real con el adaptador de referencia registrada con su resultado.
