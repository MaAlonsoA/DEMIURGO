---
code: ADR-CLA-001
type: adr
title: Clasificador detrás de un puerto con varios adaptadores
version: 1
state: proposed
domain: conocimiento
increment: S2
links:
  - type: based_on
    target: DEC-PLN-001@1
annexes: []
---

# ADR-CLA-001 · Clasificador detrás de un puerto con varios adaptadores

## Context

S2 necesita un clasificador para mantener el conocimiento: veredictos en «Actualizar conocimiento», clasificación según la taxonomía, evaluación de ideas y chequeo de verificabilidad (§7.4 y §7.5 del plan). El plan elige Jev de TypeSafe AI, un modelo de decisiones tipadas y calibradas (Choice, Score y Noul) que no genera texto.

Jev aún no está disponible. Además, está en early access, alojado en EE. UU., con un SDK 0.x y sin medir en español.

## Options

- **Jev directamente.** No está disponible, no tiene evaluación propia y enviarle contenido del proyecto exige su propio ADR.
- **Un LLM pequeño con salida estructurada.** Disponible por la CLI con suscripción, pero más lento y sin probabilidades calibradas.
- **Solo reglas deterministas** (texto y categorías). No resuelven preguntas semánticas.
- **Un puerto con varios adaptadores.** S2 no depende de Jev y el adaptador se elige con una evaluación.

## Decision

- Puerto `Classifier` (en el código, `Classifier`) en `packages/domain/src/classifier.ts` con las tres primitivas de §7.5:
  - `choice`: una opción de un conjunto cerrado, con su distribución;
  - `score`: un nivel de una rúbrica ordenada;
  - `noul`: la probabilidad de que un enunciado sea verdadero.
- Cada respuesta lleva su confianza, y el clasificador se identifica como nombre@versión.
- Tres adaptadores:
  - un simulador determinista para las pruebas;
  - una referencia sobre `claude -p` con `--json-schema` y un modelo pequeño (Haiku, alias `haiku`, por defecto y configurable), con la frontera de ADR-RUN-001;
  - un adaptador de Jev vacío, que falla con «Jev no está disponible» sin efectos.
- Cascada por confianza: alta (desde 0,8) se aplica al conocimiento derivado; media (desde 0,55) la revisa un LLM; baja queda pendiente de la persona. Los umbrales se ajustan con datos propios. El revisor es opcional (`DEMIURGO_REVIEWER=reference`, con su modelo): la cascada combina los dos clasificadores bajo un id propio (`base>reviewer`), así que la caché y la reconstrucción la distinguen. Sin revisor, lo que queda con confianza media no se aplica solo.
- El id del adaptador de referencia lleva su modelo (`claude-reference:haiku@1`): otro modelo es otra entrada para la caché.
- El clasificador solo escribe conocimiento derivado, clasificaciones y propuestas. Nunca cambia un estado de autoridad (I10).
- Ningún clasificador se adopta sin un conjunto de evaluación propio, separado en desarrollo y prueba, con precisión y cobertura por veredicto.
- Enviar contenido del proyecto a TypeSafe exige un ADR aparte antes de conectar Jev.

## Consequences

- S2 no depende de Jev: la referencia cubre el uso real con más latencia y gasto de cuota.
- Conectar Jev es implementar su adaptador y pasar la misma evaluación. La persona decide con los resultados si sustituye a la referencia.
- Cada clasificación guarda clasificador@versión, taxonomía@versión e `input_hash`, así que se sabe qué reclasificar cuando algo cambia.
- La referencia no da probabilidades calibradas: su confianza la declara el modelo y la cascada puede mandar más casos a la persona.

## Acceptance criteria

### AC-CLA-001-01 · Puerto y Jev vacío

- Verification: automatic
- Check: Se revisa el puerto y se llama al adaptador de Jev.

Dado el puerto `Classifier`, cuando se revisa, entonces expone `choice`, `score` y `noul`; y cuando se llama al adaptador de Jev, falla con «Jev no está disponible» sin efectos.

### AC-CLA-001-02 · Simulador determinista

- Verification: automatic
- Check: Se llama dos veces al simulador con la misma entrada.

Dada la misma entrada, cuando se llama dos veces al simulador, entonces da la misma respuesta.

### AC-CLA-001-03 · Adaptador de referencia

- Verification: automatic
- Check: Se revisa la orden con la que se lanza la CLI y se normaliza una respuesta grabada.

Dada una pregunta al adaptador de referencia, cuando invoca la CLI, entonces usa `claude -p` con `--json-schema` y el modelo Haiku (alias `haiku`) por defecto, o el configurado si se indica otro; y normaliza la respuesta grabada al formato del puerto.

### AC-CLA-001-04 · Cascada por umbrales

- Verification: automatic
- Check: Se enrutan respuestas con confianza alta, media y baja.

Dada una respuesta con confianza alta, media o baja, cuando se enruta, entonces se aplica, pasa a revisión por un LLM o queda pendiente de la persona, respectivamente.

### AC-CLA-001-05 · Aceptación humana

- Verification: manual
- Check: La persona revisa el ADR y lo fusiona en `main`.

Dado este ADR en estado propuesto, cuando la persona lo revisa, entonces lo acepta con el merge.
