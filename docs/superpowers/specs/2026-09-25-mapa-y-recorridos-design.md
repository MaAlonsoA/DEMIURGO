# Mapa y recorridos: spec de diseño

Fecha: 25-09-2026. Estado: **decidido por Claude durante la noche**, pendiente de revisión por la persona.

La persona pidió implementar las «slices pendientes, tanto front como back, como los mapas, árboles, etc.» y decidir sola lo que surgiera («Si te surgen dudas, toma tú la decisión que consideres»).

## Documentos relacionados

- **Diseño de la UX:** `docs/diseno-ux-2026-09-24.md` §3 (paso 2, vistas del producto). Canvas «DEMIURGO · UX», tableros S2A-Map, S3D-Map, S3H-Map-Peek y S2C-Journeys.
- **Interfaz de H1:** `docs/superpowers/specs/2026-09-24-interfaz-h1-design.md`. Dejaba fuera el mapa (§4.10).
- **Informe del frontend de H1:** `docs/informe-autonomo-v2-frontend-h1.md` §7. Recoge lo que espera a S6: propósito, quién lo usa, reglas.

## 1. Qué falta de las vistas del producto

En el paso 2 del canvas se acordaron cuatro vistas bajo «Product»: **Overview**, **Map**, **Origins** y **Journeys**. Overview y Origins están hechas. Faltan dos:
- **Map:** un canvas por áreas con las relaciones *needs*, *affects* y *conflicts*;
- **Journeys:** los recorridos de uso de la app diseñada, con los huecos sin definir dentro del flujo.

## 2. Un ejemplo de punta a punta

La persona abre **Product → Map** en el proyecto DEMIURGO:
1. Ve una columna por área, tomada del dominio de cada registro: *plataforma*, *interfaz*, *diseño*…
2. En cada columna:
   - las funcionalidades (FDR) son tarjetas, con su marca y sus barras, como en la portada;
   - debajo de cada una, las decisiones y decisiones técnicas en que se basa, como nodos: «Rules it follows».
3. Las líneas unen lo relacionado:
   - una FDR que se basa en otra, *needs*;
   - un enlace `conflicts_with`, *conflicts*, en óxido;
   - un registro derivado de otro, *affects*.
4. Al señalar una tarjeta se iluminan sus conexiones y se atenúa el resto. Al hacer clic, el panel derecho muestra:
   - de dónde viene (su hilo);
   - de qué depende;
   - qué espera a la persona (las preguntas abiertas de su hilo, con **Answer**);
   - sus checks.
5. Con **−**, **100 %**, **+** y **Fit** se acerca o se ve entero.
6. Abajo, las ideas aparcadas (hilos apartados), como nodos discontinuos.

Luego abre **Journeys**. A la izquierda, un recorrido por cada funcionalidad con comportamiento escrito, por ejemplo *FDR-INT-001 · Diseñar dentro de la v2 desde el navegador*. En el centro:
- **los pasos:** cada punto numerado de su *Behavior*, en orden;
- **los caminos:** cada criterio de aceptación («Dado…, cuando…, entonces…»), como «If …» → «Then …», con la marca del criterio;
- **los huecos:** las preguntas abiertas del hilo del que viene. Salen en azul discontinuo, «Not defined yet», con **Answer**;
- **abajo:** «N paths · M defined · K waiting on you».

## 3. Decisiones (tomadas por Claude)

| Tema | Decisión | Por qué |
|---|---|---|
| Áreas del mapa | El `domain` de cada registro, que siempre existe | La clasificación por la taxonomía solo existe si se aprobó y el clasificador corrió. El dominio es dato real y determinista |
| Relaciones | Tipadas por el enlace: `based_on` y `design_of` a una FDR, *needs*; a una decisión o ADR, *rule it follows*; `conflicts_with`, *conflicts*; `derived_from`, *affects* | Solo lo que el back guarda; nada inferido |
| Recorridos | Derivados de forma determinista de cada FDR (vigente, o la última): pasos del *Behavior*, caminos de sus criterios y huecos de las preguntas abiertas de su hilo | No inventar contenido. Un agente que proponga recorridos queda para S6 |
| Propósito, quién lo usa y reglas del producto | Siguen como «Later» | Son entidades de S6 que el back aún no tiene |
| Datos | Una consulta nueva por vista (`/map` y `/journeys`), para no hacer una llamada por registro | Origins hace N llamadas; con el mapa entero serían demasiadas |

## 4. Piezas

**Back:**
- `productMap(db, projectId)` en `packages/core/src/queries/views.ts`. Devuelve:
  - `areas`;
  - `records`, las filas de la portada;
  - `relations` (`from`, `to`, `kind`);
  - `questions`: abiertas, con los registros que afectan;
  - `ideas`: hilos apartados.
- `productJourneys(db, projectId)`. Devuelve un recorrido por FDR, con `steps`, `paths` y `gaps`.
- Rutas `GET /api/projects/:projectId/map` y `…/journeys`, con la consulta `query.records`.
- El análisis del texto es puro y va en `packages/domain/src/views.ts`:
  - `behaviorSteps(markdown)`;
  - `criterionPath(statement)`: Dado/cuando/entonces y Given/when/then;
  - `relationOf(linkType, fromType, toType)`.

**Web:**
- `screens/map/Map.tsx`:
  - lienzo con columnas por área;
  - líneas SVG medidas sobre los elementos;
  - zoom, selección y panel.
- `screens/journeys/Journeys.tsx`: lista de recorridos y el recorrido elegido, con pasos, caminos y huecos.
- Las pestañas de «Product» pasan a ser Overview · Map · Origins · Journeys.

## 5. Comportamientos que serán AC

Van en una FDR nueva, **FDR-INT-002 «Vistas del producto: mapa y recorridos»**, sin `increment` hasta tener pruebas.

1. El mapa agrupa cada registro en la columna de su dominio y muestra funcionalidades como tarjetas y decisiones como nodos.
2. Cada relación del mapa corresponde a un enlace real y lleva su tipo (*needs*, *rule it follows*, *conflicts*, *affects*); no hay relaciones inventadas.
3. Seleccionar un elemento ilumina sus conexiones y muestra en el panel su origen, sus dependencias, las preguntas abiertas de su hilo y sus checks.
4. El zoom (−, +, Fit) cambia la escala sin perder la selección.
5. Cada FDR con *Behavior* tiene un recorrido: sus pasos son los puntos numerados en orden y sus caminos, sus criterios.
6. Las preguntas abiertas del hilo de una FDR aparecen en su recorrido como huecos «Not defined yet» con **Answer**, y el resumen cuenta caminos definidos y huecos.
7. Mapa y recorridos se usan solo con teclado y pasan axe.
