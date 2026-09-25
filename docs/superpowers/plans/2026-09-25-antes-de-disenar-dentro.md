# Plan: lo que falta antes de diseñar DEMIURGO dentro de la aplicación

> **Para quien lo ejecute:** se trabaja en la rama `v2`, en `D:\Dev\Demiurgo` y sin worktrees. Cada tarea lleva su prueba primero: se ve fallar y después pasar. Se hace un commit por tarea, con pathspec. Antes de dar el plan por terminado, `pnpm gate:all` tiene que estar en verde.

**Objetivo:** que se pueda reconstruir DEMIURGO a mano, paso a paso, dentro de la aplicación, sin tropezar con huecos conocidos. Cerrar H1 exige crear allí uno a uno todos sus documentos: la decisión del plan, la taxonomía, 7 ADR y 7 FDR. Después, la FDR de S3 tiene que nacer y aprobarse dentro.

**En qué se basa:**
- `docs/pendientes-y-decisiones-2026-09-25.html`;
- `docs/informe-autonomo-v2-frontend-h1.md` §7;
- `docs/informe-agentes-y-proveedores.md` §6;
- `docs/informe-autonomo-v2-h1.md` §6 (decisión 4).

**Restricciones globales:**
- **Idioma:** el código, las pruebas y los textos de producto van en inglés. Este documento y los commits van en español.
- **Reglas de fondo** (`AGENTS.md`), que se mantienen:
  - toda escritura pasa por un comando del bus;
  - cualquier comando nuevo se declara en `design/data/` y después se ejecuta `pnpm gen`;
  - el actor lo fija el servidor;
  - lo decisivo solo lo hace una persona.
- **`design/` es referencia desde que D0 quedó fuera.** Estas tareas no añaden códigos AC nuevos a `design/`: sus pruebas llevan un título descriptivo. No se rompe ninguna prueba de un AC existente. Si un cambio contradice uno, se anota como decisión (ver la tarea 2).
- **Web:** solo componentes y clases del design system. `design-system.test.ts` lo vigila.
- **Cuota:** ninguna prueba llama a un motor real. La prueba de humo (tarea 12) usa Qwen en local, que es gratis.

**Qué vigilar en la revisión:**
- respuestas duplicadas cuando el conocimiento va lento;
- un registro o un enlace creado a mano que se salta una guarda del bus;
- la clave de un agente visible más de una vez;
- un proyecto renombrado que deja nombres viejos en la web por la caché;
- la búsqueda en inglés y en español con el mismo texto.

---

## Bloque A · Huecos que impiden diseñar dentro

### Tarea 1 · Respuesta pendiente visible (M, ½ día)

**Problema.** El back espera al conocimiento hasta 30 min antes de lanzar la respuesta (`packages/core/src/engine/engine.ts`, `RESPONSE_PATIENCE_MS`). La web lo adivina con un margen de 2 min (`packages/web/src/screens/onboarding/day.ts`, `ANSWER_GRACE_MS`) y después ofrece «Ask DEMIURGO» otra vez, con lo que llegan dos respuestas.

**Cambio:**
- **Back:**
  - el mensaje guarda `respond` y el estado de su respuesta: `waiting_knowledge`, `requested`, `abandoned` o `none`;
  - la respuesta durable emite un evento al empezar a esperar, otro al pedir la ejecución y otro al abandonar;
  - la ejecución guarda el mensaje al que responde (`answers_message`);
  - hace falta una migración `0006` con una columna en `messages` y otra en `ai_runs`.
- **Web:**
  - `readingOf` usa ese estado en lugar del margen de tiempo;
  - mientras espera, la tarjeta dice «DEMIURGO is catching up on what you just decided…»;
  - «Ask DEMIURGO» solo aparece si la respuesta se abandonó;
  - el comentario «up to a minute» desaparece junto con `ANSWER_GRACE_MS`.

**Pruebas:**
- **Integración:** con el conocimiento ocupado, el mensaje queda en `waiting_knowledge` y hay una sola ejecución al liberarse.
- **Unitaria:** `readingOf` recorre sus cuatro estados.
- **E2E:** el Día 1 con la marca `[slow-knowledge]` muestra «catching up» y nunca ofrece repetir la petición.

### Tarea 2 · Preguntas inferidas en la readiness (S, 2–3 h) · **pendiente de tu decisión**

**Problema.** Una respuesta que supuso DEMIURGO y nadie confirmó no bloquea «Ready to build».

**Cambio.** En `readiness` (`packages/domain/src/records.ts`), las preguntas `inferred` del hilo de origen pasan a ser un motivo: «N answers DEMIURGO assumed are not confirmed yet: …». En la web, el aviso ◐ pasa a ser un motivo que bloquea.

**Pruebas.** Una unitaria: una inferida bloquea y al confirmarla desbloquea. El e2e de H1 tiene que confirmar las inferidas antes de «Ready to build».

**Decisión:** contradice el punto 4 de FDR-DIS-001. Como `design/` ya es solo referencia, se anota aquí y no se versiona la FDR.

### Tarea 3 · Crear un registro a mano (M, 1 día)

**Problema.** `record.create` existe para personas, pero la web no lo ofrece. Sin esto no se pueden crear ADR ni bugs, y cerrar H1 exige los 7 ADR.

**Cambio.**
- Hay un botón **New record** en la portada y en la barra *Blueprint*, con los tipos Decision, Feature (FDR), Technical decision (ADR) y Bug.
- El formulario:
  - pide título y dominio;
  - muestra las secciones de la plantilla del tipo (las mismas que valida el back);
  - permite añadir checks con su verificación.

  Crea la versión 1 en borrador y abre la página del registro, donde ya se aprueba.
- Reutiliza el editor de secciones y de checks de «New version» (`screens/new-version/`).

**Pruebas:**
- **E2E:** crear un ADR a mano, aprobarlo y verlo en Map.
- **E2E:** un 422 de plantilla conserva lo escrito.
- **Accesibilidad:** axe y teclado.

### Tarea 4 · Enlazar registros a mano (S–M, ½ día)

**Problema.** `link.create` existe, pero la web no lo ofrece. Sin enlaces, Map, Origins y el impacto se quedan pobres.

**Cambio.** En «What it touches» de un registro, **Add a link** permite elegir tipo (`based_on`, `design_of`, `covers`, `conflicts_with`…) y destino con buscador, y se crea desde la versión mostrada. Los tipos y las guardas salen de las tablas.

**Pruebas.**
- **E2E:** enlazar una FDR con un ADR, verlo en «What it touches», en el destino (entrantes) y en Map.
- **E2E:** un enlace inválido da un 409 con sus motivos.

### Tarea 5 · Claves de agente para MCP (S, 2–4 h)

**Problema.** `agent_token.issue` y `agent_token.revoke` no tienen pantalla ni orden de CLI.

**Cambio.**
- Una pantalla **Agent keys** en el menú del proyecto:
  - la lista de claves, con nombre, cuándo se creó y si está revocada;
  - **New key**, que muestra el secreto una sola vez con «Copy» y la línea de configuración de MCP lista para pegar;
  - **Revoke**.
- Una orden `pnpm cli issue-agent-token <projectId> <name>` para usarla sin web.

**Pruebas.**
- **E2E:** emitir una clave; el secreto no se puede volver a ver. Revocarla; después la API responde 401.
- **Unitaria:** la orden de la CLI.

## Bloque B · Menores que se arreglan antes (decidido el 25-09)

### Tarea 6 · Taxonomía de un proyecto nuevo (S, 2–3 h)

**Problema.** Un proyecto nace sin taxonomía y el conocimiento no se agrupa por áreas.

**Cambio.**
- Al crear un proyecto, la web ofrece «Set up how DEMIURGO groups knowledge», con una taxonomía inicial editable (ejes *Area* y *Quality*, cada uno con «other»).
- Proponerla es `taxonomy.propose` y aprobarla sigue siendo un gesto humano (`taxonomy.approve`).
- En *Knowledge*, mientras no haya ninguna aprobada, un aviso lleva a ese paso.

**Pruebas.** E2E: proyecto nuevo, proponer y aprobar la taxonomía, y ver el grafo agrupado.

### Tarea 7 · Renombrar un proyecto (S, 2–3 h)

**Cambio:**
- comando nuevo `project.rename`, solo humano y no decisivo, declarado en `design/data/` y con `pnpm gen`;
- manejador en `commands/projects.ts` con su evento;
- en la web, «Rename» en el menú del proyecto, que invalida la lista de proyectos y la cabecera;
- desaparece el aviso «You can't rename it yet.» del Día 1.

**Pruebas:**
- **Invariantes:** las generadas (403 para un agente).
- **E2E:** renombrar y ver el nombre nuevo en la cabecera y en la lista sin recargar.

### Tarea 8 · La readiness nombra las preguntas pendientes (S, 1–2 h)

**Cambio.** El motivo pasa de «There are 2 pending question(s)…» a nombrar cada pregunta, recortada, con un enlace a su hilo en la web.

**Pruebas.** Una unitaria de `readiness`. Hay que actualizar las pruebas que comparan el texto literal.

### Tarea 9 · Búsqueda: idioma e ideas (M, ½ día)

**Problema.**
- La búsqueda usa la configuración de texto `spanish`, aunque los productos nuevos se escriben en inglés.
- No encuentra ideas.

**Cambio:**
- migración que cambia la columna generada a `simple` con `unaccent`, que sirve para los dos idiomas sin raíces equivocadas;
- `graph-pg.ts` usa la misma configuración;
- se indexan también los hilos y las ideas aparcadas (propósito y título), y el buscador los muestra con su tipo.

**Pruebas:**
- **Integración:** el mismo texto en inglés y en español se encuentra.
- **Integración:** una idea aparcada aparece en los resultados.

**Nota:** hay que comprobar que la huella de la reconstrucción del grafo no cambia. La búsqueda no forma parte de ella.

### Tarea 10 · Menores de agentes (S–M, ½ día)

1. **El contador de progreso retrocede.** `api/progress.ts` guarda el máximo visto por llamada. Prueba unitaria.
2. **Llamadas que quedan en «running» tras una caída.** Al arrancar, las filas de `agent_calls` en `running` de ejecuciones ya terminadas o recuperadas se cierran como `interrupted`, con su evento. Prueba de integración.
3. **«Settings →».** Los textos pasan a «Models & providers» en `assignments.ts`, `config.ts` y la web, y se actualizan las pruebas que los comparan.
4. **Rutas locales en los eventos en bruto.** Con una credencial de agente, la consulta de eventos devuelve los eventos normalizados sin `raw` (y sin rutas). Una persona sigue viendo el bruto. Prueba de integración con un token de agente.

## Bloque C · Comprobación

### Tarea 11 · `pnpm gate:all` y revisión (S)

Hay que pasar el gate completo y lanzar una revisión independiente de la rama con los puntos de «Qué vigilar en la revisión».

### Tarea 12 · Prueba de humo con un motor real (S, 1 h, con tu permiso)

Con Qwen en local, que no gasta cuota, en una base de pruebas y no en tu instancia:
1. Día 1 de una idea pequeña.
2. Preguntas y decisiones.
3. Draft it.
4. Aprobar hasta «Ready to build».

Se registra en `docs/ejecuciones-reales/`.

---

## Orden y tamaño

| Orden | Tareas | Tamaño |
|---|---|---|
| 1 | 1 · Respuesta pendiente visible | ½ día |
| 2 | 3 y 4 · Registros y enlaces a mano | 1½ días |
| 3 | 5 · Claves de agente | ½ día |
| 4 | 6, 7, 8, 9 y 10 · Menores | 1½ días |
| 5 | 2 · Preguntas inferidas (si dices que sí) | 2–3 h |
| 6 | 11 y 12 · Gate, revisión y humo | ½ día |

**Total:** unos 4–5 días de trabajo. Al terminar, tu instancia (8100) se reinicia con el código nuevo y aplica la migración. Después empieza el diseño dentro, que sigue siendo tu decisión.

## Lo que no entra (después, antes de construir S3)

- **Puente del diseño dentro de la app a la construcción.** La trazabilidad lee `design/`. Hay que decidir si lee de la app o de una exportación sin colisión de códigos.
- **Formato del paquete de construcción** que Claude Code leerá por MCP.
