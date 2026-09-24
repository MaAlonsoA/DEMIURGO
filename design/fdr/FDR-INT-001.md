---
code: FDR-INT-001
type: fdr
title: Diseñar dentro de la v2 desde el navegador
version: 1
state: proposed
domain: interfaz
links:
  - type: based_on
    target: DEC-PLN-001@1
annexes: []
---

# FDR-INT-001 · Diseñar dentro de la v2 desde el navegador

## Goal

La persona diseña dentro de la v2 desde el navegador, sin usar la API a mano:
- toma el diseño importado y lo ratifica;
- aprueba lo que da por bueno;
- explora con DEMIURGO y le pide borradores;
- acepta esos borradores y deja una FDR «Ready to build».

Es lo que H1 necesita para que la FDR de S3 nazca y se apruebe en la v2 con la persona en la UI.

El detalle de pantallas está en `docs/superpowers/specs/2026-09-24-interfaz-h1-design.md` y el lenguaje visual, en `docs/diseno-ux-2026-09-24.md`.

## Scope

- **Sesión:** entrar y salir.
- **Paquete importado:** su contenido, los recuentos frente al origen y la ratificación en un paso.
- **Estado del producto:** la portada del proyecto, con la lente «What changed» y el resumen «While you were away».
- **Orígenes:** de dónde viene cada registro.
- **Página de un registro** (decisión, ADR, FDR y bug):
  - secciones, criterios, enlaces y versiones;
  - aprobar una versión, crear una versión nueva con nota y arrastre de criterios, y descartar un borrador;
  - la readiness, con sus motivos y avisos.
- **Hilos (exploraciones):**
  - mensajes y observaciones;
  - preguntas con su ciclo de vida, e hilos hijos;
  - concluir, apartar y reanudar;
  - pedir a DEMIURGO una conversación o un borrador.
- **Ejecuciones:** estado, motivo del fallo, reintento con el mismo context pack, cancelación y procedencia.
- **Needs you:** todos los tipos de la bandeja, y ponerse al día de uno en uno.
- **Errores** 403, 404, 409 y 422 con sus motivos.
- **Conocimiento:**
  - versión del grafo y frescura, y búsqueda;
  - evaluaciones de ideas con su cita;
  - taxonomía (proponer y aprobar) y huella de reconstrucción.
- **Fuentes:** lista y registro.
- **Lenguaje visual común:** puntos, barras, color y quién, más la leyenda de marcas.

## Out of scope

- Elegir proveedor, modelo y razonamiento por tipo de tarea («Models & providers»). Necesita su propia FDR.
- Pantallas para el canal de agentes y para sus claves. El canal es para pruebas y las claves se emiten por la CLI.
- El mapa por áreas, los recorridos de uso (Journeys) y los carriles por persona en la descripción de una funcionalidad.
- Convertir una idea entera en funcionalidades (S6), el impacto de un cambio (S7) y construir (Pilar 2).
- Móvil.

## Behavior

1. **Sesión.**
   - Sin sesión, cualquier ruta lleva a «Sign in»; al entrar, la persona vuelve a donde iba.
   - «Sign out» cierra la sesión en el servidor.
   - Con más de un proyecto, la persona elige uno. Con uno solo, entra en él.
2. **Estado epistémico y autoría.**
   - Cada elemento lleva la marca de su estado epistémico, según la correspondencia de FDR-DIS-001: Confirmed, Proposed, Open o Unknown.
   - Una pregunta inferida se muestra como Assumed, que es un caso de Proposed.
   - Lo propuesto por un agente nunca lleva la marca de Confirmed.
   - Quién hizo cada cosa (You, DEMIURGO, Agent o Automatic) se ve al señalar su marca.
3. **Paquete importado.**
   - Muestra sus recuentos junto a los del origen y la lista de documentos con su contenido.
   - «Ratify» pide confirmación y acepta el paquete entero; «Reject» lo rechaza entero.
   - Antes de ratificar, nada aparece como aprobado.
4. **Portada del producto.**
   - Lista las decisiones, ADR y FDR con su versión vigente y su última versión, su marca, su readiness y «not built».
   - Muestra las funcionalidades listas para construir, los hilos con preguntas abiertas y el contador de «Needs you».
5. **Lente «What changed».**
   - Al volver, la portada resalta lo que tiene eventos desde la última visita de la persona en ese navegador.
   - «While you were away» lo cuenta con una línea por cosa.
   - Un clic apaga la lente.
6. **Aprobar y versionar.**
   - Aprobar no crea versión. La vigente es la última aprobada.
   - Un borrador anterior a la vigente solo ofrece «Discard».
   - «New version» exige una nota de cambio y una elección por cada criterio: «Keep», «Change» o «Drop».
   - Al guardar un criterio vago aparece el aviso de verificabilidad, que no bloquea.
7. **Readiness.**
   - «Ready to build» aparece solo sin motivos. Si los hay, se muestran tal como los da el servidor, y los avisos aparte.
   - Las preguntas inferidas sin confirmar de la exploración de origen se muestran como aviso.
   - La primera barra se llena solo con la readiness verdadera. Se pone en óxido cuando una versión aprobada deja de estar lista.
8. **Hilos.**
   - Se puede escribir, responder y abrir hilos hijos, y confirmar, posponer, descartar y reabrir preguntas.
   - Un hilo se concluye con su conclusión, se aparta y se reanuda.
   - «Ask DEMIURGO» lanza `exploration_chat` y «Draft it» lanza `design_proposal`.
   - Mientras una ejecución está en curso, el hilo la muestra en ámbar y se puede cancelar.
   - Si falla, muestra el motivo en palabras de producto y ofrece reintentar con el mismo context pack.
9. **Needs you.**
   - Reúne todo lo que espera a la persona, con un contador:
     - propuestas por lote;
     - preguntas inferidas, pendientes y pospuestas;
     - versiones en borrador;
     - enlaces por revisar;
     - clasificaciones por revisar;
     - actualizaciones de conocimiento rechazadas.
   - Cada cosa se resuelve en el sitio:
     - los lotes de un agente, propuesta a propuesta, con su autor visible y sin «aceptar todo»;
     - los paquetes del sistema, enteros;
     - «Accept and approve» es una sola acción con sus dos efectos a la vista.
   - Lo obsoleto se muestra como «Out of date», con qué registro cambió y de qué versión partía, y sin acciones de aceptar.
10. **Ponerse al día.**
    - «Catch up» recorre «Needs you» de uno en uno, en este orden:
      1. conflictos con algo aprobado;
      2. preguntas que bloquean una readiness;
      3. propuestas;
      4. versiones por aprobar;
      5. enlaces y clasificaciones;
      6. lo demás.
    - Se puede dejar en cualquier momento, y lo saltado sigue en «Needs you».
11. **Errores.**
    - Un 409 o un 422 muestra sus motivos junto a la acción y conserva lo que la persona escribió.
    - Un 403 explica que la acción es de una persona o que no está permitida, y un 404 dice qué no se encontró.
    - Nunca aparece un «Error» genérico.
12. **Conocimiento.**
    - La cabecera muestra la versión del grafo y su frescura. Si una acción se rechaza porque el conocimiento no está al día, lo dice.
    - La página de conocimiento muestra:
      - los nodos por área de la taxonomía, con sus relaciones, y la búsqueda;
      - las evaluaciones de ideas con la cita del nodo (duplica, contradice o relaciona);
      - la taxonomía, para proponerla y aprobarla;
      - la huella de la última reconstrucción.
13. **Fuentes.** Se listan con quién las registró, y la persona registra una nueva.
14. **Refresco.** Toda pantalla abierta se actualiza con el flujo de eventos, sin recargar.
15. **Leyenda.** Aparece abajo a la izquierda con solo las marcas de la pantalla, se pliega en un ⓘ y avisa de las marcas nuevas.

## Acceptance criteria

### AC-INT-001-01 · Recorrido de H1 en el navegador

- Verification: automatic
- Check: Un E2E con Playwright y el simulador recorre el camino entero desde un proyecto con `design/` importado.

Dado `design/` importado como lote pendiente, cuando la persona entra, ratifica, abre un hilo, pide un borrador, acepta el paquete y aprueba la FDR desde la UI, entonces la FDR aparece como «Ready to build» y «Needs you» queda vacío.

### AC-INT-001-02 · Sesión

- Verification: automatic
- Check: Un E2E abre una ruta interna sin sesión, entra y después sale.

Dada una ruta interna sin sesión, cuando la persona la abre, entonces ve «Sign in»; al entrar vuelve a esa ruta, y tras «Sign out» la siguiente petición a la API responde 401.

### AC-INT-001-03 · Ratificación

- Verification: automatic
- Check: Un E2E abre el paquete importado, compara sus recuentos con los de `design/` y lo ratifica.

Dado el paquete importado, cuando la persona lo abre, entonces ve sus recuentos junto a los del origen y nada aprobado; tras «Ratify», los registros existen y el actor de cada evento es la persona.

### AC-INT-001-04 · Estado epistémico visible

- Verification: automatic
- Check: Un E2E recorre la portada, un hilo, un lote y un registro, y compara cada marca con la correspondencia de FDR-DIS-001.

Dados elementos en cada estado, cuando aparecen en la UI, entonces cada uno lleva la marca de su estado epistémico, y un elemento propuesto por un agente nunca lleva la de Confirmed.

### AC-INT-001-05 · Aprobar no crea versión

- Verification: automatic
- Check: Un E2E aprueba un borrador y abre un borrador anterior a la vigente.

Dado un registro con un borrador, cuando la persona lo aprueba, entonces pasa a vigente sin que aparezca una versión nueva; y un borrador anterior a la vigente solo ofrece «Discard».

### AC-INT-001-06 · Versión nueva con arrastre

- Verification: automatic
- Check: Un E2E intenta guardar una versión nueva sin nota y sin elegir un criterio, y después la completa.

Dado un registro aprobado con criterios, cuando la persona crea una versión nueva, entonces la UI no la guarda sin nota de cambio ni sin una elección por cada criterio, y la versión guardada refleja cada elección.

### AC-INT-001-07 · Aviso de verificabilidad

- Verification: automatic
- Check: Un E2E guarda un criterio con un término vago.

Dado un criterio con un término vago, cuando la persona lo guarda, entonces aparece el aviso de verificabilidad y el criterio se guarda igualmente.

### AC-INT-001-08 · Readiness con sus motivos

- Verification: automatic
- Check: Un E2E prepara una FDR con cada motivo de readiness y otra sin ninguno.

Dada una versión con un motivo de readiness, cuando la persona abre el registro, entonces ve el motivo tal como lo da el servidor y no ve «Ready to build»; sin motivos, lo ve y la primera barra está llena.

### AC-INT-001-09 · Hilo y preguntas

- Verification: automatic
- Check: Un E2E confirma, pospone, descarta y reabre preguntas, y concluye el hilo.

Dado un hilo con preguntas, cuando la persona las confirma, pospone, descarta o reabre, entonces la marca de cada pregunta cambia en el acto; y al concluir el hilo con su conclusión, queda concluido.

### AC-INT-001-10 · Ejecuciones

- Verification: automatic
- Check: Un E2E con el simulador provoca una ejecución en curso, otra fallida y su reintento.

Dada una ejecución en curso, cuando la persona la mira, entonces la ve en ámbar y puede cancelarla; si una ejecución falla, ve el motivo y, al reintentar, el hash del context pack es el mismo.

### AC-INT-001-11 · Needs you completo

- Verification: automatic
- Check: Un E2E prepara un elemento de cada tipo de la bandeja y los resuelve desde la UI.

Dado un elemento de cada tipo de la bandeja, cuando la persona abre «Needs you», entonces aparecen todos y cada uno se resuelve en el sitio, y el contador baja con cada resolución.

### AC-INT-001-12 · Lotes de agente y paquetes

- Verification: automatic
- Check: Un E2E recibe un lote de un agente por la API y un paquete del sistema.

Dado un lote de un agente, cuando la persona lo abre, entonces lo resuelve propuesta a propuesta con el autor visible y no hay «aceptar todo»; y un paquete del sistema solo se acepta o se rechaza entero.

### AC-INT-001-13 · Obsolescencia visible

- Verification: automatic
- Check: Un E2E aprueba una versión nueva de un registro del que depende una propuesta pendiente.

Dada una propuesta que depende de una versión, cuando se aprueba una versión nueva de ese registro, entonces la propuesta aparece como «Out of date» con el registro y la versión de los que partía, y sin acción de aceptar.

### AC-INT-001-14 · Errores accionables

- Verification: automatic
- Check: Un E2E provoca un 409, un 422 y un 403 desde la UI.

Dada una acción que el servidor rechaza, cuando la respuesta es 409 o 422, entonces la UI muestra sus motivos junto a la acción y conserva lo escrito; cuando es 403, explica por qué; y en ningún caso muestra un «Error» genérico.

### AC-INT-001-15 · Refresco incremental

- Verification: automatic
- Check: Un E2E tiene abierta una pantalla mientras un agente de prueba propone por la API.

Dada una pantalla abierta, cuando otro actor cambia algo que se ve en ella, entonces el cambio aparece sin recargar la página.

### AC-INT-001-16 · Lo que cambió y ponerse al día

- Verification: automatic
- Check: Un E2E registra una visita, hace cambios con otro actor, vuelve y recorre «Catch up».

Dada una visita anterior, cuando la persona vuelve tras cambios de otro actor, entonces la portada resalta solo lo que cambió y «While you were away» cuenta una línea por cosa; y «Catch up» recorre «Needs you» de uno en uno en el orden definido y se puede dejar en cualquier momento.

### AC-INT-001-17 · Conocimiento y fuentes

- Verification: automatic
- Check: Un E2E con el clasificador simulado revisa la cabecera, una evaluación de idea, la taxonomía y las fuentes.

Dado un proyecto con conocimiento, cuando la persona usa la UI, entonces ve la versión del grafo y su frescura, ve la cita de una evaluación de idea, aprueba una taxonomía propuesta y registra una fuente que aparece en la lista.

### AC-INT-001-18 · Experiencia validada por la persona

- Verification: manual
- Check: La persona recorre H1 en el navegador con el contenido real de DEMIURGO.

Dada la interfaz desplegada en la instancia de la v2, cuando la persona hace el recorrido de H1, entonces da por buena la experiencia o deja sus cambios como propuestas.
