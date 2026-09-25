---
code: FDR-INT-002
type: fdr
title: Vistas del producto, mapa y recorridos
version: 1
state: proposed
domain: interfaz
increment: H1
links:
  - type: based_on
    target: FDR-INT-001@1
  - type: based_on
    target: DEC-PLN-001@1
annexes: []
---

# FDR-INT-002 · Vistas del producto, mapa y recorridos

## Goal

La persona ve el producto que diseña de dos maneras más, junto a la portada y los orígenes:
- **el mapa:** el diseño entero por áreas, con lo que depende de qué y lo que choca;
- **los recorridos:** cómo usará la gente cada funcionalidad, paso a paso, con los caminos que sus criterios definen y los huecos que aún esperan una respuesta.

Las dos vistas solo muestran lo que el diseño ya dice: nada se infiere ni se inventa.

El detalle está en `docs/superpowers/specs/2026-09-25-mapa-y-recorridos-design.md` y el lenguaje visual, en `docs/diseno-ux-2026-09-24.md` (paso 2, vistas del producto).

## Scope

- **Pestañas del producto:** Overview, Map, Origins y Journeys.
- **Mapa:**
  - una columna por área, tomada del dominio de cada registro;
  - las funcionalidades como tarjetas y las decisiones y decisiones técnicas como reglas;
  - las relaciones que declaran los enlaces, con su tipo;
  - selección con panel, zoom y las ideas aparcadas.
- **Recorridos:** uno por funcionalidad con comportamiento escrito, con sus pasos, sus caminos y sus huecos.
- **Consultas:** una por vista, para no pedir cada registro por separado.

## Out of scope

- El propósito del producto, quién lo usa y sus reglas como entidades propias (S6). Siguen como «Later».
- Un agente que proponga recorridos o relaciones. Las vistas se derivan solo de lo escrito.
- Editar desde el mapa o desde un recorrido. Se edita en la página de cada registro y en los hilos.
- Los carriles por persona en la descripción de una funcionalidad.
- Móvil.

## Behavior

1. **Pestañas.** «Product» tiene cuatro vistas: Overview, Map, Origins y Journeys.
2. **Áreas del mapa.**
   - Cada registro va en la columna de su dominio. Las columnas van de la que tiene más registros a la que menos.
   - En cada columna van primero las funcionalidades, como tarjetas con su marca, y después las decisiones y decisiones técnicas, como reglas.
3. **Relaciones.**
   - Solo se dibujan los enlaces que existen, con su tipo:
     - `based_on` o `design_of` de una funcionalidad hacia otra es *needs*;
     - cualquier otro `based_on` o `design_of`, hacia una decisión o decisión técnica, es *rule it follows*;
     - `conflicts_with` es *conflicts*, en óxido;
     - `derived_from` es *affects*.
   - Un enlace pendiente de revisión y una relación *affects* se dibujan discontinuos.
   - Los enlaces que solo dicen de dónde viene algo no se dibujan.
4. **Selección.**
   - Al señalar un elemento se iluminan sus conexiones en los dos sentidos y el resto se atenúa.
   - Al elegirlo, el panel muestra de dónde viene (su hilo), de qué depende, qué lo necesita, las preguntas abiertas de su hilo con «Answer» y sus checks.
   - Se elige con el ratón o con el teclado.
5. **Zoom.** «−», «+» y «Fit» cambian la escala del lienzo sin perder la selección.
6. **Ideas aparcadas.** Los hilos apartados aparecen debajo del mapa como ideas, en discontinuo.
7. **Recorridos.**
   - Cada funcionalidad con *Behavior* tiene un recorrido, tomado de su versión vigente o, si no la hay, de la última.
   - Los pasos son los puntos numerados de su *Behavior*, en orden y con sus viñetas como detalle. Sin puntos numerados, cada párrafo o viñeta es un paso.
   - Los caminos son sus criterios: «Dado…, cuando…, entonces…» se muestra como «If …», «When …» y «→ …». Un criterio sin esa forma conserva su texto.
8. **Huecos.**
   - Las preguntas abiertas del hilo del que viene la funcionalidad aparecen en su recorrido como «Not defined yet», con «Answer» hacia ese hilo.
   - El resumen cuenta los caminos, los definidos, los que esperan a la persona y los pasos.
9. **Vacío.** Sin registros, el mapa lo dice; sin funcionalidades con comportamiento, los recorridos explican de dónde salen.

## Acceptance criteria

### AC-INT-002-01 · Cada registro en su área

- Verification: automatic
- Check: Pruebas de la consulta del mapa sobre `design/` ratificado y de la disposición en columnas, y un E2E que abre el mapa.

Dado un proyecto con registros de varios dominios, cuando la persona abre el mapa, entonces ve una columna por dominio con sus funcionalidades como tarjetas y sus decisiones y decisiones técnicas como reglas.

### AC-INT-002-02 · Relaciones reales y tipadas

- Verification: automatic
- Check: Pruebas de la traducción de cada tipo de enlace y de la consulta del mapa, y un E2E que ve una línea *rule it follows*.

Dado un conjunto de enlaces entre registros, cuando se construye el mapa, entonces cada relación corresponde a un enlace existente y lleva su tipo (*needs*, *rule it follows*, *conflicts* o *affects*), y no aparece ninguna relación sin enlace.

### AC-INT-002-03 · Selección con su panel

- Verification: automatic
- Check: Pruebas de las conexiones en los dos sentidos y de lo que espera a la persona, y un E2E que elige una funcionalidad.

Dado el mapa, cuando la persona elige una funcionalidad, entonces se iluminan sus conexiones y el panel muestra su origen, las reglas que sigue, las preguntas abiertas de su hilo y sus checks.

### AC-INT-002-04 · Zoom sin perder la selección

- Verification: automatic
- Check: Un E2E cambia el zoom con un elemento elegido.

Dado un elemento elegido en el mapa, cuando la persona usa «−», «+» o «Fit», entonces cambia la escala y el elemento sigue elegido con su panel.

### AC-INT-002-05 · Pasos y caminos de un recorrido

- Verification: automatic
- Check: Pruebas del análisis del *Behavior* y de los criterios, en español y en inglés, de la consulta de recorridos y un E2E que abre uno.

Dada una funcionalidad con *Behavior* y criterios, cuando la persona abre su recorrido, entonces ve como pasos los puntos numerados en orden y como caminos sus criterios en forma «If … → …».

### AC-INT-002-06 · Huecos que esperan a la persona

- Verification: automatic
- Check: Una prueba de la consulta con una pregunta abierta en el hilo de origen y un E2E que la ve como hueco.

Dada una funcionalidad que viene de un hilo con preguntas abiertas, cuando la persona abre su recorrido, entonces cada pregunta aparece como «Not defined yet» con «Answer» hacia el hilo, y el resumen cuenta los caminos definidos y los que esperan.

### AC-INT-002-07 · Teclado y accesibilidad

- Verification: automatic
- Check: Los E2E del mapa y de los recorridos eligen con el teclado y pasan axe.

Dados el mapa y los recorridos, cuando la persona los usa solo con el teclado, entonces puede elegir cada elemento y cada recorrido, y las dos pantallas pasan la revisión de accesibilidad sin infracciones.
