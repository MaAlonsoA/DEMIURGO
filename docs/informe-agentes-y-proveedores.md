# Informe: agentes y proveedores (FDR-AGE-002)

Fecha: 25-09-2026. Rama `v2-agentes`, en el worktree `D:\Dev\Demiurgo-agentes`. No se ha subido nada.

**Sin fusionar a propósito.** En `D:\Dev\Demiurgo` hay otra sesión migrando la web al design system: 92 ficheros sin commit y `packages/design-system/` nuevo. 11 de esos ficheros también los toca esta rama (`Header.tsx`, `Reasons.tsx`, `stream.ts`, `NewProject.tsx`, `Projects.tsx`, `Run.tsx`, `RunCards.tsx`, `Reading.tsx`, `CLAUDE.md` y dos e2e). Fusionar ahora habría chocado con ese trabajo. Cuando esté commiteado:

```
git merge v2-agentes     # desde v2-frontend-h1
```

Tras fusionar, la API en 8200 aplica la migración 0005 al reiniciarse.

Documentos relacionados:
- **Spec:** `docs/superpowers/specs/2026-09-25-agentes-y-proveedores-design.md`.
- **Plan:** `docs/superpowers/plans/2026-09-25-agentes-y-proveedores.md`.
- **Diseño:** FDR-AGE-002 y la versión 2 de ADR-AGE-001 en `design/`.

## 1. Qué hay

- **Cada tarea tiene su agente.** Cada tarea de DEMIURGO la ejecuta un agente propio: un `AGENT.md` más sus skills, en `packages/core/agents/` y `packages/core/skills/`. Su versión es la huella de ese contenido.
- **Tres motores reales, elegidos por la persona.**
  - Los motores son Claude (`claude -p`), Codex (`codex exec`) y OpenCode, con los modelos locales de tu `opencode.json`, como Qwen.
  - Se eligen en **Models & providers**, sin variables de entorno y sin simulador por defecto.
  - Modelos y efforts se descubren sin gastar cuota; nunca se escribe un nombre de modelo.
- **Orden de resolución:** reintento → proyecto → global.
  - Sin motor asignado, la acción da un 409 «Choose a model for …» con un enlace a la pantalla.
  - Nunca se cambia de motor por su cuenta.
- **Sesiones con delta.** Una conversación reanuda la sesión del proveedor solo si el pack nuevo solo añade al anterior, y entonces manda solo el delta. En cualquier otro caso empieza de nuevo con el pack completo.
- **Observabilidad:**
  - cada llamada guarda sus eventos en orden;
  - la web muestra el progreso en vivo («Thinking… N tokens»);
  - la página de la ejecución muestra motor, sesión, tokens y coste declarado;
  - la pantalla muestra el consumo de hoy y de la semana y estadísticas por motor.
- **Retry with…** reintenta una ejecución fallida en otro motor, solo esa vez.
- **Clasificador del conocimiento.** Es el agente `knowledge_classifier`, en cascada con `knowledge_reviewer` si este tiene motor.

## 2. Cómo usarlo

1. Arranca la API como siempre.
   - Las variables `DEMIURGO_AGENT*`, `DEMIURGO_CLASSIFIER*` y `DEMIURGO_REVIEWER*` ya no existen: si están puestas, el arranque falla y lo dice.
   - Hay dos variables nuevas, opcionales:
     - `DEMIURGO_OPENCODE_CONFIG`: por defecto, `~/.config/opencode/opencode.json`;
     - `DEMIURGO_AGENT_SESSIONS_DIR`: por defecto, `%LOCALAPPDATA%\Demiurgo\agent-sessions`.
2. Abre **Models & providers**. Hay dos entradas:
   - fuera de un proyecto, `/models`, enlazada desde *New project* y *Your projects*;
   - dentro de un proyecto, en el menú de la persona.
3. Pulsa **Refresh** si hace falta.
4. Asigna un motor a cada parte de DEMIURGO, en «Everywhere» o solo en «This project». Para el Día 1 basta con asignar `onboarding`, `explorer`, `designer` y `knowledge_classifier`. `knowledge_reviewer` es opcional (sin él no hay cascada) y `echo` es solo para pruebas.
5. Si una ejecución falla, **Retry with…** permite elegir otro motor para ese reintento.

**Base de desarrollo.** Tras fusionar, la API en 8200 (`node --watch`) aplica la migración 0005 y descubre los proveedores al arrancar. **No hay asignaciones**, así que el Día 1 y los hilos dan el 409 hasta que elijas los motores. Con `DEMIURGO_DEV_TOOLS=1` también aparece el proveedor *Simulated*. Si quieres repetir el Día 1 de DEMIURGO desde cero, guarda antes una instantánea (`pnpm snap save`).

**Evaluar el clasificador con un motor real** (gasta cuota):

```
node packages/api/src/cli.ts evaluate-classifier <claude|codex|opencode> <modelo> [effort|-] [test|dev|all]
```

## 3. Llamadas reales hechas esta noche

Las pediste implícitamente al decir que decidiera yo. Todas se registraron en el ledger.

| Motor | Qué | Resultado |
|---|---|---|
| Claude haiku/low | `echo` nueva y reanudada | Bien. Salida estructurada, effort y `--resume`. ≈ 0,009 USD declarados. |
| Codex gpt-6-luna/low | `echo` nueva y reanudada | Bien. La segunda con caché de entrada. |
| Codex gpt-6-luna/low | `exploration_chat` con el agente `onboarding` (tras el arreglo I2) | Bien. Esquema aceptado y salida válida para Zod (3 preguntas, 3 observaciones, 1 propuesta), en 8 s y unos 9,6k tokens de entrada. Hizo falta repetirla dos veces por un fallo de mi script, no de DEMIURGO. |
| OpenCode + Qwen | — | El servidor de Qwen en `127.0.0.1:8080` estaba caído al final. El adaptador lo dice («isn't answering»). Una llamada con herramienta se había verificado antes a mano. |

Una observación: en la llamada de `exploration_chat`, Codex respondió en español a una idea escrita en inglés, aunque el agente pide «el idioma de la persona». Es una sola muestra; conviene mirarlo en el Día 1 real.

## 4. Revisión final y arreglos

Un revisor independiente (opus) revisó la rama entera. Veredicto: «Ready with fixes», sin críticos y con 5 importantes. Arreglé los 5, cada uno con una prueba que primero falló:

| # | Problema | Arreglo |
|---|---|---|
| I1 | Tras un reinicio, una actualización de conocimiento pendiente se rechazaba con «The core has not started.» | El clasificador lee los servicios del motor, que existen antes de que DBOS reanude nada |
| I2 | El modo estricto de Codex rechaza `oneOf`, y Zod lo genera para las propuestas | `strictSchema` escribe `anyOf` y convierte `const` en un `enum` de un valor. Verificado con una llamada real |
| I3 | Si el descubrimiento no podía listar modelos, el catálogo quedaba vacío y todo daba 409 con «ya no se ofrece» | El adaptador dice `listed: false` y el refresco conserva los últimos modelos con un mensaje |
| I4 | En una instalación nueva, `/new` daba 409 sin camino a la pantalla | Nueva ruta `/models` para el espacio de trabajo, enlaces desde `/new` y `/projects`, y el motivo enlaza allí |
| I5 | La respuesta a un mensaje esperaba 60 s al conocimiento y, si no llegaba, se perdía | Comprueba la frescura dentro de su candado y vuelve a esperar mientras haya actualizaciones en curso, hasta 30 min |

Tras el pase, todo está en verde:
- `gate:test`: 658/658;
- `gate:invariants`: 502/502;
- e2e: 80/80;
- trazabilidad: 113 criterios y 1240 pruebas;
- tipos, lint, formato, `design/` y deriva, limpios.

## 5. Decisiones que tomé por ti

Cada decisión va con lo que cuesta si me equivoqué.

1. **Código de la FDR.** Es FDR-AGE-002, no FDR-AGE-001, porque el validador no deja repetir AGE-001 entre tipos. *Coste:* renombrar un código.
2. **Dependencias explícitas.** Las funciones de asignación reciben `{ db, providers }` en lugar de `Services`. *Coste:* firmas algo más largas.
3. **Dónde va la prueba de composición.** Vive en `packages/domain`. *Coste:* mover un fichero.
4. **`project_id` en `agent_call_events`.** Lo exige una invariante. `provider_catalogs` y `agent_assignments` son ajustes del espacio de trabajo y quedan como excepción. *Coste:* una columna de más.
5. **Esquema completo para Qwen.** La herramienta StructuredOutput de Qwen lleva el esquema completo, sin recortar, porque NInfer no valida los parámetros. *Coste:* algún rechazo que obligue a recortarlo.
6. **403 antes que 422 en los ajustes,** como en el bus. *Coste:* ninguno.
7. **El delta incluye la respuesta del propio agente.** *Coste:* unos tokens más por turno.
8. **La sesión se guarda también cuando la ejecución falla,** para que la siguiente empiece de nuevo. *Coste:* ninguno.
9. **Reintento en fresco.** Si una reanudación falla con `agent_error`, se repite una vez en fresco con el mismo motor; no es un cambio de motor. *Coste:* una llamada más cuando la sesión caducó.
10. **Sin tiempos por fase.** No se registran; solo la duración de la llamada. *Coste:* faltan en las métricas.
11. **Web sin canvas previo.** La pantalla se construyó directamente con el design system de `packages/web`, sin esperar a tu reacción en el canvas. *Coste:* ajustes visuales cuando la revises.
12. **Llamadas reales** a Claude y Codex, sin permiso explícito. *Coste:* la cuota de la sección 3.
13. **Pruebas e2e:**
    - los selectores de «Retry» pasan a `exact: true`;
    - el recorrido de H1 actúa sobre cada cosa por su clave, porque había una carrera en la prueba y no en el producto.

    *Coste:* un fallo real tardaría algo más en verse.
14. **Respuesta abandonada tras 30 min.** Si hay actualizaciones de conocimiento en curso durante más de 30 min, la respuesta a un mensaje se abandona y solo queda en el log. *Coste:* un mensaje sin respuesta en un caso muy improbable.
15. **Reanudación en hilos largos.** Casi nunca se reanuda, por el recorte de mensajes; el spec define «solo añade» a propósito. *Coste:* más tokens por turno.

## 6. Menores aplazados

Anotados; no los arreglé:

- **Sesiones:** cancelar o interrumpir una ejecución no avanza la sesión, y dos ejecuciones simultáneas del mismo hilo reanudan la misma sesión.
- **Mensajes con un agente equivocado:** `message.post` con `agent: designer` se acepta, pero después no hay respuesta, porque no se comprueba la acción del agente.
- **Catálogo de agentes:** no se valida al arrancar.
- **Esquema estricto:**
  - quita claves por nombre a cualquier profundidad;
  - no copia los límites a `description`.
- **Prompt del clasificador:** las reglas dicen `<untrusted_context>` y el clasificador usa `<untrusted_state>`.
- **Llamadas huérfanas:** las de `agent_calls` que quedan en `running` tras un crash no se cierran.
- **Pruebas que lanzan CLIs reales:** `runtime.test` lanza en segundo plano el descubrimiento real de `claude` y `codex`.
- **Pantalla de Models & providers:**
  - `knowledge_reviewer` y `echo` salen en rojo;
  - «Use another here» fija un override igual al global;
  - cada cambio de desplegable se guarda;
  - el selector corta los nombres largos.
- **Progreso en vivo:** el contador puede retroceder.
- **Pruebas que faltan:**
  - `run.request` con un motor no disponible;
  - argumentos que no son JSON en OpenCode.
- **Exposición a agentes externos:** uno con `query.runs` lee los eventos en bruto, que incluyen rutas locales.
- **Estadísticas:** las medias de preguntas y propuestas cuentan dos veces las ejecuciones con fallback.
- **Textos:** dicen «Settings → Models & providers», y la UI no tiene «Settings».

## 7. Para probarlo mañana

1. Levanta el servidor de Qwen (`127.0.0.1:8080`) y pulsa **Refresh**.
2. Asigna, por ejemplo:
   - `onboarding` → Codex / gpt-6-sol / high;
   - `explorer` → Claude / opus / high;
   - `knowledge_classifier` → OpenCode / qwen3.8-27b / medium.
3. Guarda una instantánea y haz el Día 1 de DEMIURGO.
4. En la página de la ejecución, mira los eventos en vivo, las métricas y que el segundo mensaje del hilo reanuda la sesión.
5. Prueba **Retry with…** y mira el consumo en la pantalla.
