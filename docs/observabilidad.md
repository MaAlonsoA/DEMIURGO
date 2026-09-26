# Observabilidad: la caja negra de DEMIURGO

Guía de operación de la pila de evidencia en esta máquina. El diseño completo está en `docs/superpowers/specs/2026-09-26-motor-observabilidad-design.md`; el glosario, en su §20.

## Qué es, en cinco líneas

DEMIURGO anota todo lo que pasa: lo que hace una persona, cada comando, cada ejecución, cada llamada a un modelo con sus textos exactos y sus tokens, cada aceptación. Las notas salen de la aplicación por OpenTelemetry hacia un **Colector** en Docker, que guarda una copia bruta en ficheros para siempre y las pasa a nuestro **ingestor**, que las convierte en filas de la **base de evidencia**, un Postgres aparte con su propio volumen. Sobre esa base hay vistas y preguntas guardadas que responden cuánto costó una decisión, dónde se fue el tiempo, si se reutilizó la sesión de un modelo o qué motor falla más. **Phoenix** es un visor de trazas que recibe una copia; **Metabase** es el cuadro de mando, con las siete preguntas de negocio en un tablero. DEMIURGO nunca lee nada de esto: solo escribe, y si la pila está apagada sigue funcionando igual.

## Arrancar la pila

Tres cosas, en este orden:

```powershell
pnpm evidence:up            # Postgres de evidencia y Colector, proyecto compose demiurgo-evidence
pnpm evidence migrate       # aplica las migraciones y crea las particiones del mes y del siguiente
pnpm evidence serve         # el ingestor, en su propia terminal; se queda escuchando
```

`serve` migra también, así que `migrate` solo hace falta suelto cuando quieras aplicar una migración nueva sin reiniciar el ingestor. El ingestor escribe una línea JSON por cada lote que confirma (`receipt`) y otra cuando crea particiones.

La primera vez, y cada vez que cambie una pregunta guardada, deja también listo el cuadro de mando: `pnpm evidence metabase-setup` (ver [Metabase](#metabase)). Se puede repetir sin miedo: actualiza, no duplica.

Para parar: cierra la terminal del ingestor (Ctrl+C) y `pnpm evidence:down`. Los volúmenes se quedan; `pnpm evidence:down` no borra nada.

### Puertos

| Puerto | Qué | Dónde |
|---|---|---|
| 55434 | Postgres de evidencia, base `demiurgo_evidence` | contenedor `demiurgo-evidence-postgres-1` |
| 4317 | Colector, OTLP por gRPC | contenedor `demiurgo-evidence-collector-1` |
| 4318 | Colector, OTLP por HTTP (lo que usa DEMIURGO y las CLI) | ídem |
| 13133 | Salud del Colector: `curl -s http://127.0.0.1:13133/` | ídem |
| 4319 | El ingestor (`pnpm evidence serve`) | proceso en el host |
| 6006 | Phoenix, el visor | contenedor `demiurgo-evidence-phoenix-1` |
| 3300 | Metabase, el cuadro de mando | contenedor `demiurgo-evidence-metabase-1` |

Todo escucha solo en 127.0.0.1. La base se abre con `postgres://evidence:evidence-local@127.0.0.1:55434/demiurgo_evidence`; para mirar sin poder tocar existe el rol `evidence_reader` (contraseña `evidence-reader`), que es el que usa Metabase.

## Variables de las instancias 8100 y 8101

El emisor va dentro del API. Se configura con estas variables al lanzar `node --watch packages/api/src/main.ts`:

| Variable | Valores | Por defecto | Para qué |
|---|---|---|---|
| `DEMIURGO_OBSERVE` | `otlp`, `off` | `otlp` | `off` apaga el emisor del todo: no se envía nada ni se escribe `trace_contexts` |
| `DEMIURGO_OTLP_ENDPOINT` | URL | `http://127.0.0.1:4318` | dónde está el Colector |
| `DEMIURGO_ENVIRONMENT` | `real`, `qa`, `dev`, `test` | `dev` | la etiqueta de entorno de cada nota, para separar la instancia real de la de pruebas |
| `DEMIURGO_SERVICE_VERSION` | texto | `unknown` | la versión de DEMIURGO que emitió la nota; usa el commit |

La instancia (`demiurgo.instance`) sale sola de `DEMIURGO_PORT`.

Lo que debe fijar cada lanzador, además de lo que ya lleva (`DEMIURGO_DATABASE_URL`, `DEMIURGO_PORT`, `DEMIURGO_ORIGINS`, `DEMIURGO_DEV_TOOLS`):

```powershell
# 8100, la instancia real
$env:DEMIURGO_ENVIRONMENT = 'real'
$env:DEMIURGO_SERVICE_VERSION = (git rev-parse --short HEAD)

# 8101, la instancia de QA
$env:DEMIURGO_ENVIRONMENT = 'qa'
$env:DEMIURGO_SERVICE_VERSION = (git rev-parse --short HEAD)

# Para no emitir nada (Playwright en 8310, o cuando la pila está apagada y no quieres ni el aviso)
$env:DEMIURGO_OBSERVE = 'off'
```

**Ojo:** hoy el lanzador de la 8100 no fija `DEMIURGO_ENVIRONMENT`, así que sus notas llevan `dev` hasta que se relance con la variable. Las preguntas no filtran por entorno, pero `v_interaction_summary` lo enseña en la columna `environment`; cuando se relance, lo anterior seguirá como `dev` y lo nuevo saldrá como `real`.

Con la pila apagada y `DEMIURGO_OBSERVE=otlp`, DEMIURGO sigue igual: las notas se pierden, el emisor las cuenta y cuando el Colector vuelve emite un aviso `demiurgo.observe.dropped` con cuántas se perdieron, que queda en `unmapped_records` con motivo `dropped-notice`.

## Preguntar

Las preguntas guardadas viven en `packages/evidence/questions/*.sql`, cada una con su pregunta en la cabecera. `pnpm evidence ask` sin nada las lista. Todas piden sus parámetros; donde hay filtro por proyecto o por fecha, `all` lo quita.

```powershell
pnpm evidence ask session-reuse --run <id de ejecución>
pnpm evidence ask decision-effort --project <id de proyecto | all>
pnpm evidence ask interaction-time --project <id | all> --since <AAAA-MM-DD | all>
pnpm evidence ask tokens-by-engine --since <AAAA-MM-DD | all>
pnpm evidence ask engine-acceptance
pnpm evidence ask engine-reliability
pnpm evidence ask interventions --project <id | all>
pnpm evidence ask cache-by-provider --since <AAAA-MM-DD | all>
pnpm evidence ask context-budget --project <id | all>
pnpm evidence ask context-of-run --run <id de ejecución>
pnpm evidence ask context-diff --run_a <id> --run_b <id>
pnpm evidence ask cli-requests --run <id de ejecución>
```

Qué responde cada una:

- **session-reuse:** si una ejecución reanudó la sesión del modelo, desde qué ejecución base, con qué delta y qué parte del contexto vino de caché (`reused`, `partial`, `lost`, `none`).
- **decision-effort:** cuánto costó cada propuesta aceptada: interacciones y intervenciones de la persona, preguntas planteadas y respondidas, segundos desde la primera interacción del hilo hasta aceptar, ejecuciones, tokens por clase y coste declarado. Es acumulado por hilo: la segunda decisión de un hilo cuenta también lo gastado antes de la primera.
- **interaction-time:** por interacción, el total y las fases: API, comandos, pasos del motor, contexto (`run.prepare`), modelo (`invoke_agent`) y aplicar (`run.apply`).
- **tokens-by-engine:** por proveedor, modelo, effort, agente y versión: llamadas, tokens sin caché, leídos y escritos de caché, salida, razonamiento, proporción de caché y coste.
- **engine-acceptance:** qué motor da más propuestas aceptadas sin edición, con edición o rechazadas por cada 1 000 tokens de salida.
- **engine-reliability:** qué falla y en qué motor: llamadas fallidas por tipo (`failures` es un JSON `{tipo: n}`), planes B, ejecuciones reintentadas, sesiones perdidas y cómo valoró la persona lo que salió.
- **interventions:** por hilo, cuántas interacciones y comandos pusieron las personas frente al sistema y los agentes, cuántas preguntas se plantearon, cuántas se respondieron, cuántas siguen abiertas y cuántas propuestas se aceptaron o rechazaron.
- **cache-by-provider:** por proveedor y modelo, qué parte del contexto vino de caché y, de las llamadas que reanudaron una sesión, cuántas la encontraron entera, a medias o perdida.
- **context-budget:** por constructor y sección del context pack, cuánto del presupuesto se llenó y cuántos fragmentos entraron enteros, recortados, resumidos o descartados.
- **context-of-run, context-diff, cli-requests:** el detalle de una ejecución: cada fragmento de su contexto con su origen y su decisión; la diferencia de contexto entre dos ejecuciones; y las peticiones que la CLI hizo a su API bajo cada llamada.

Las vistas de detrás (`v_decision_effort`, `v_interaction_summary`, `v_session_reuse`, `v_tokens_by_engine`, `v_engine_acceptance`, `v_engine_reliability`, `v_interventions`, `v_context_budget`) se pueden consultar a mano con cualquier cliente de Postgres; cada una explica en `packages/evidence/migrations/` de dónde saca sus filas. Un hilo se identifica por su exploración; una pregunta que una persona plantea a mano no lleva hoy la exploración en su registro del diario, así que hasta que el núcleo la añada no cuenta para ningún hilo.

## Cuando el ingestor se cae

El Colector no pierde nada: tiene una cola persistente y reintenta hasta que el ingestor confirma. Además guarda la copia bruta en el archivo en ficheros. Si por lo que sea hay que ponerse al día desde el archivo (una base de evidencia restaurada, una cola que se descartó), se reproduce; es idempotente, así que reproducir dos veces no duplica nada:

```powershell
docker cp demiurgo-evidence-collector-1:/archive .\archive-copia
pnpm evidence replay .\archive-copia\otlp.jsonl        # y los rotados: otlp-2026-09-26T…jsonl
```

Cada línea del archivo es una petición de exportación entera y va en su propia transacción, con su recibo `replay:<fichero>` en `ingest_receipts`.

## Comprobar que no falta nada

Compara las ejecuciones de la base operativa con las que describe la evidencia, sin escribir en ninguna de las dos:

```powershell
pnpm evidence check --operational "$DEMIURGO_DATABASE_URL"   # la misma URL con la que se lanza la instancia (compose.instance.yaml: usuario demiurgo, base demiurgo_v2 en 55433)
```

Lista las que faltan en la evidencia (código de salida 1 si hay alguna) y las que solo están en la evidencia. Lo segundo es normal después de restaurar una instantánea de DEMIURGO: la caja negra recuerda ejecuciones que la base operativa ya no conoce.

## Recalcular las evaluaciones

Las evaluaciones de personas (`human.accepted`, `human.accepted_edited`, `human.rejected`, `human.inference_confirmed`, `human.inference_corrected`, `human.retried`, `human.retried_other_engine`) se derivan de los comandos al ingerir. Si cambia una regla o se reprodujo el archivo en un orden raro:

```powershell
pnpm evidence derive
```

Recorre todos los comandos y añade solo las que falten.

## Retención

Nada se borra por defecto. Solo las tablas crudas (`provider_events`, `journal_payloads`, `cli_requests`, `unmapped_records`) están particionadas por mes para poder soltar un mes entero a propósito:

```powershell
pnpm evidence retention --raw-before 2026-06          # solo lista lo que borraría
pnpm evidence retention --raw-before 2026-06 --yes    # lo borra
```

Nunca toca spans, comandos, ejecuciones, llamadas, textos ni evaluaciones. El archivo en ficheros del Colector no lo borra ningún programa.

## Copia de seguridad

Dos cosas: la base y el archivo en ficheros. Con la pila arrancada, desde PowerShell:

```powershell
# 1. La base de evidencia, con pg_dump desde dentro del contenedor
docker exec demiurgo-evidence-postgres-1 pg_dump -U evidence -Fc demiurgo_evidence > .\evidencia-2026-09-26.dump

# 2. El archivo en ficheros del Colector (volumen demiurgo-evidence_evidence-archive)
docker run --rm -v demiurgo-evidence_evidence-archive:/archive -v "${PWD}:/backup" alpine tar czf /backup/evidencia-archivo-2026-09-26.tgz -C /archive .
```

Para restaurar la base en una pila nueva: `pnpm evidence:up`, y después `docker exec -i demiurgo-evidence-postgres-1 pg_restore -U evidence -d demiurgo_evidence --clean --if-exists < .\evidencia-2026-09-26.dump`. Para el archivo, el mismo `docker run` con `tar xzf` hacia `/archive`. Si solo se tiene el archivo, `pnpm evidence replay` reconstruye la base entera.

`pnpm snap`, `pnpm db:down -v` y los `docker compose down -v` de los otros proyectos no tocan estos volúmenes. `docker compose -f compose.evidence.yaml down -v` sí los borra: no lo uses sin copia.

## Phoenix

En http://127.0.0.1:6006 (usuario `admin@localhost`, contraseña `PHOENIX_ADMIN_PASSWORD` de `packages/evidence/.env`). Enseña cada interacción como una línea de tiempo: la raíz del API, los comandos, los pasos del motor y dentro la llamada al modelo con sus tokens, y colgadas de ella las peticiones que Claude Code o Codex hacen por su cuenta a su API, con sus tokens de caché. Es una copia recortada (sin `usage.raw`, atributos limitados a 64 000 caracteres): sirve para mirar, no para contar. Si un día sobra, se apaga y no se pierde nada.

## Metabase

El cuadro de mando, en http://127.0.0.1:3300. Entra como `evidence@demiurgo.local` con la contraseña `METABASE_ADMIN_PASSWORD` de `packages/evidence/.env` (la genera `pnpm evidence:up`; a un `.env` anterior a esta fase se la añade sola). Metabase pidió un dominio con punto, así que la cuenta no pudo ser `evidence@localhost`.

Lo deja listo, y lo pone al día, un solo comando:

```powershell
pnpm evidence metabase-setup            # METABASE_URL cambia la dirección; por defecto http://127.0.0.1:3300
```

La primera vez crea la cuenta; siempre comprueba que estén, y los actualiza si cambiaron: la conexión «DEMIURGO evidence» a `demiurgo_evidence` como `evidence_reader` (solo lectura), la colección «DEMIURGO», una pregunta nativa por cada pregunta guardada de `packages/evidence/questions/` que usa el cuadro (más `session-reuse`, `context-of-run` y `tokens-by-engine`) y el tablero **«DEMIURGO · primer cuadro»**. Todo se busca por nombre: repetirlo no duplica nada. Al final ejecuta cada pregunta una vez y dice cuántas filas dio; si alguna falla, sale con código 1 y el error. Metabase guarda lo suyo en el volumen `evidence-metabase` (una base H2 propia, nada en `demiurgo_evidence`), sin muestra de datos ni telemetría hacia fuera.

Las siete tarjetas del tablero, en el orden de §15.3 de la spec, y lo que responde cada una:

| Tarjeta | Responde | Pregunta guardada | Vista |
|---|---|---|---|
| ¿Cuánto cuesta una decisión aprobada…? | por propuesta aceptada: intervenciones, preguntas, segundos hasta aceptar, ejecuciones, tokens y coste declarado del hilo | `decision-effort` | `v_decision_effort` |
| ¿Cuánto tarda DEMIURGO en responder y dónde se va el tiempo? | por interacción: total y fases (API, comandos, pasos, contexto, modelo, aplicar) | `interaction-time` | `v_interaction_summary` |
| ¿Qué porcentaje del contexto se reutiliza de caché por proveedor y qué sesiones se pierden? | por proveedor y modelo: proporción de caché y sesiones reanudadas enteras, a medias o perdidas | `cache-by-provider` | `v_session_reuse` |
| ¿Qué motor da más propuestas aceptadas sin edición por token gastado? | por motor: aceptadas, editadas y rechazadas por cada 1 000 tokens de salida | `engine-acceptance` | `v_engine_acceptance` |
| ¿Cuántas intervenciones pide cada decisión y cuántas preguntas quedan sin responder? | por hilo: intervenciones de personas frente al sistema, preguntas planteadas, respondidas y abiertas | `interventions` | `v_interventions` |
| ¿Cuánto presupuesto de contexto se llena y cuánto se descarta por sección? | por constructor y sección: llenado del presupuesto y fragmentos incluidos, recortados y descartados | `context-budget` | `v_context_budget` |
| ¿Qué falla, cuánto y en qué motor? | por motor: fallos por tipo, planes B, reintentos, sesiones perdidas y valoración de las personas | `engine-reliability` | `v_engine_reliability` |

Los filtros de las preguntas (`Project`, `Since`, `Run`) son variables de la consulta con valor por defecto `all` (o una ejecución que no existe, en `Run`): cámbialos en la propia pregunta. El SQL de cada tarjeta es el mismo fichero de `questions/`, con `:param` convertido en `{{param}}`; si cambias un fichero, vuelve a lanzar `metabase-setup`.

## Qué está pendiente

- **Las verificaciones de §18** de la spec: si `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` anula la telemetría de Claude Code, si Codex lee `TRACEPARENT` y admite `-c otel.*`, y dónde deja Claude Code la transcripción.
- **El puente de las evaluaciones del clasificador** (§15.2): los resultados de `classifier_evaluations` y `evals/classifier/` deben emitirse como `gen_ai.evaluation.result` para tenerlos en `evaluations` junto a las de las personas. El ingestor ya las acepta; falta que el núcleo las emita.
- **La exploración de las preguntas planteadas a mano:** el núcleo no la pone en el registro de `question.raise`, así que esas preguntas no cuentan para su hilo.

## Comprobado el 26-09-2026

Con la pila entera arrancada (`pnpm evidence:up` con Metabase `v0.63.18.2` fijada por digest) y el ingestor en marcha, sin ninguna llamada real a Claude ni a Codex:

- `pnpm evidence migrate` aplicó `0002_context_budget` y `0003_cli_telemetry` a la base de evidencia real (`0001` y `0004` ya estaban); el ingestor vació la cola del Colector (9 recibos al arrancar, sin errores).
- `interactions` tenía 58 filas: 47 `system` y 3 `cli` de la instancia 8100 (etiqueta `dev`, porque su lanzador aún no fija `DEMIURGO_ENVIRONMENT`), 1 `cli` de `test` y 7 sin metadatos (comandos `project.create` cuyo span raíz no llegó con su registro de interacción). `spans`: 86, ninguno con padre perdido; los `command run.request` cuelgan del span `interaction create-project` y los comandos anidados de `run.prepare` y `run.apply`. `runs`: 3, `provider_calls`: 3 (todas `simulated`), `commands`: 20.
- `pnpm evidence metabase-setup` creó la cuenta, la conexión, la colección, 10 preguntas y el tablero con 7 tarjetas; repetido, actualizó las 10 y no duplicó nada (`/api/dashboard` sigue con un tablero, 7 tarjetas en rejilla). Las diez consultas ejecutaron sin error (`interaction-time` 58 filas; `cache-by-provider`, `engine-acceptance`, `engine-reliability`, `interventions` y `tokens-by-engine` 1; el resto 0 filas por falta de decisiones aceptadas y de manifiestos).
- `pnpm evidence check --operational` no se pudo comprobar: el Postgres de la instancia 8100 (55433) estaba apagado y ese proyecto compose no se toca desde aquí.

## Glosario

Nota, traza, interacción, Colector, ingestor, manifiesto, huella, sesión de conversación, caché de prompt: §20 de `docs/superpowers/specs/2026-09-26-motor-observabilidad-design.md`.
