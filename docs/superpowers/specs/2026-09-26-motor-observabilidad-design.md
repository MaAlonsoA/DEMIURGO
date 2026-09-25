# Motor de observabilidad: spec de diseño

Fecha: 26-09-2026. Estado: **propuesto**, pendiente de revisión por la persona.

## Decisiones que ya tomó la persona

Antes de esta spec, en la sesión de brainstorming del 25-09-2026 y 26-09-2026, la persona decidió:

1. **El motor de contexto y el motor de observabilidad son dos cosas distintas y aisladas.** La observabilidad sirve internamente para negocio y desarrollo. Cómo se ofrece al cliente como funcionalidad se verá más adelante.
2. **Todo lo de observabilidad vive fuera de la aplicación:** base de datos, cuadros de mando y cualquier pantalla. La lógica de DEMIURGO nunca lee esa información.
3. **La traza cubre toda la interacción, personas incluidas:** nace en lo que hace una persona y llega hasta los efectos.
4. **El archivo es nuestro y el visor es una copia reemplazable:** una base de datos diseñada por nosotros guarda todo y es la verdad; Phoenix recibe una copia para mirar las trazas cómodamente.
5. **DEMIURGO fija el id de cada conversación con el modelo** siempre que la CLI lo permita, para poder recuperarla siempre.

El resto de decisiones de esta spec las tomó Claude por delegación explícita de la persona («termina tú de decidir, prefiero que te pases de complejo a que te quedes corto»). Están marcadas donde importa, con su motivo.

## Documentos relacionados

- **Plan de reimplementación:** `docs/plan-reimplementacion-2026-09-24.md`, motor «Observabilidad y mejora continua» (§3) y evaluación del contexto (§7.9). Esta spec lo desarrolla.
- **Stack:** `docs/investigacion-stack-2026-09-24.md` §8, «Diseño de observabilidad». Esta spec **cambia** una de sus decisiones: OpenTelemetry pasa de «apoyo de depuración» a transporte y vocabulario. El registro propio sigue siendo la fuente de verdad.
- **Agentes y proveedores:** `docs/superpowers/specs/2026-09-25-agentes-y-proveedores-design.md` y FDR-AGE-002. Esta spec **saca de Later** la exportación a OpenTelemetry.
- **Diseño de la UX:** `docs/ux-rebuild/DESIGN.md` §3.4 (Activity y la página de la ejecución). No cambia: la página de la ejecución sigue leyendo la base operativa.
- **Investigación externa** (25-09-2026): convenciones GenAI de OpenTelemetry, OpenInference, OpenLLMetry, Langfuse, Phoenix, telemetría nativa de Claude Code y Codex, contabilidad de caché, PROV, Postgres frente a ClickHouse. Sus conclusiones están incorporadas aquí; lo no verificado está en §18.

---

## 1. Resumen para leer en cinco minutos

**Qué es.** Una caja negra para DEMIURGO. Cada vez que pasa algo, una persona escribe, arranca una ejecución, se monta el contexto, se llama al modelo, vuelve la respuesta, alguien acepta una propuesta, DEMIURGO manda una nota hacia fuera y sigue con lo suyo. Las notas se guardan enteras, para siempre, en un archivo propio que no depende de la aplicación. Con ellas se puede reconstruir cualquier interacción de principio a fin, medir cuánto costó, comparar motores y demostrar con datos si el contexto se reutilizó o dónde se perdió.

**Por qué ahora.** Hoy DEMIURGO guarda bastante, pero repartido en tres sitios, sin un id que una las piezas, sin el texto exacto que recibió cada modelo, sin el origen de cada fragmento del contexto, y todo dentro de la base operativa, que una instantánea borra. No se puede afirmar con evidencia si un hilo reanudó la sesión anterior de Claude o de Codex.

**Cómo funciona, en seis piezas.**

```
 DENTRO DE DEMIURGO                     FUERA DE LA APLICACIÓN
 ┌──────────────────────┐   notas       ┌──────────────┐──▶ Ficheros: copia bruta de todo, para siempre
 │ Emisor               │ ────────────▶ │  Colector    │──▶ Ingestor nuestro ──▶ Base de evidencia
 │ (habla OpenTelemetry) │               │  (reparte)   │──▶ Phoenix, el visor           (Postgres aparte)
 └──────────────────────┘          ┌───▶└──────────────┘                                      │
 claude -p / codex exec ───────────┘ su propia telemetría          Cuadros de mando ◀─────────┘
```

1. **El emisor** va dentro de DEMIURGO. Es la única pieza dentro, como la grabadora va dentro del avión. Habla el estándar OpenTelemetry con nuestro vocabulario. Nunca espera a nadie: si lo de fuera está apagado, DEMIURGO funciona igual.
2. **El Colector** es un programa estándar de OpenTelemetry en un contenedor. Recibe las notas de DEMIURGO y las que Claude Code y Codex emiten por su cuenta. Guarda una copia bruta en ficheros y reparte.
3. **El ingestor** es nuestro. Convierte las notas en filas del archivo. Si se cae, se relanza y se pone al día desde los ficheros sin duplicar nada.
4. **La base de evidencia** es una base de datos Postgres en su propio contenedor, con su propio volumen. Ni las instantáneas ni un reset de DEMIURGO la tocan.
5. **Phoenix** es el visor: líneas de tiempo de cada interacción, tokens, duraciones, evaluaciones. Recibe una copia. Si un día sobra, se apaga y no se pierde nada.
6. **Los cuadros de mando** son una herramienta de gráficos sobre Postgres, Metabase, para las preguntas de negocio. Llegan en la última fase.

**Qué cambia dentro de DEMIURGO.** Poco y acotado: un id de interacción que nace con cada acción de una persona y viaja por todo lo que provoca; el emisor conectado en cuatro puntos, el API, el bus de comandos, el motor de ejecuciones y la llamada al proveedor; los constructores de context pack, que ya saben qué incluyen, dicen además por qué y qué dejaron fuera; y los adaptadores de Claude y Codex, que pasan a la CLI nuestro id y recogen lo que hoy tiran.

**Qué se verá primero.** La pregunta con la que empezó todo: para cualquier ejecución, si reanudó la sesión anterior, qué delta envió y qué porcentaje del contexto previo vino de caché. Sale de una consulta guardada sobre la base de evidencia y se ve en Phoenix como una línea de tiempo.

**Qué no hace.** No cambia el comportamiento de DEMIURGO. No decide nada. No limita el gasto. No aprende sola: las mejoras salen de mirar la evidencia y entran como propuestas. No enseña nada al cliente dentro de la aplicación.

---

## 2. Un ejemplo de punta a punta

La persona escribe en un hilo «Los invitados no necesitan cuenta». Esto es lo que queda anotado y cómo se lee después.

1. **El API recibe el comando `message.post`.** Nace el id de interacción `0199…a3f1`, generado por DEMIURGO. Es a la vez el id de traza de OpenTelemetry. Se abre la nota raíz: quién, `human:marcos`, qué, `message.post`, en qué proyecto, desde qué canal, con qué versión de DEMIURGO y en qué entorno, `real`.
2. **El bus ejecuta el comando.** Deja una nota hija: comando, entidad, estado antes y después, número del evento en el diario. El diario guarda la misma correlación, `0199…a3f1`. El mensaje queda esperando respuesta y arranca el flujo durable de la respuesta, que hereda el id.
3. **El flujo pide la ejecución.** `run.request` deja su nota, con el agente `explorer@3f9c…`, el motor, `claude · opus · high`, y de dónde salió el motor, del grupo *Deep thinking*. Se construye el context pack: su nota lleva el **manifiesto**: cuarenta y dos fragmentos, de qué mensaje, decisión, fuente o nodo de conocimiento salió cada uno, con qué versión, cuántos caracteres, si entró entero, recortado o se quedó fuera por presupuesto, y con qué motivo. La fila de la ejecución guarda el contexto de traza para sobrevivir a un reinicio.
4. **El motor decide reanudar.** La conversación ya tenía sesión: `s-7b2e…`, que DEMIURGO le dio a Claude al abrirla. La ejecución base es `R-41`, su pack `h:ab12…`, el delta añade dos mensajes y una pregunta cerrada. La nota de la llamada lleva todo eso más las huellas del system prompt, de la entrada y del esquema enviados, y los textos completos van aparte, una sola vez cada uno.
5. **Claude corre con `--resume s-7b2e…`.** DEMIURGO le pasa por el entorno nuestro id de traza y la dirección del Colector. Claude Code, por su cuenta, emite sus notas colgadas de la nuestra: cada petición a la API con tokens sin caché, de escritura y de lectura de caché, tiempo al primer token, motivo de parada. Cada línea que Claude escribe en su salida llega también como nota cruda, en orden y con su hora.
6. **Llega la respuesta y se aplica.** Notas del paso `apply` y de cada efecto: el mensaje de DEMIURGO, dos preguntas nuevas, un lote de propuestas. Todos con el mismo id.
7. **Al día siguiente la persona acepta una propuesta del lote.** Es otra interacción, con su propio id, pero la nota de la aceptación apunta al lote y el lote a la ejecución. El ingestor lo convierte en una evaluación sobre la ejecución `R-42`: `human.accepted`.

Lo que se lee después, en una consulta o en Phoenix:

- Interacción `0199…a3f1`: de tu mensaje a la respuesta, 48 s. Contexto 0,3 s, modelo 44 s, aplicar 0,2 s.
- Ejecución `R-42`: reanudó `s-7b2e…` desde `R-41`. Delta de 1 340 caracteres. Tokens: 910 sin caché, 38 200 leídos de caché, 1 200 escritos, 2 100 de salida. **El 95 % del contexto previo vino de caché: la sesión se reutilizó.**
- Si un día la lectura de caché cae a cero con modo `resumed`, la sesión se perdió entre `R-41` y `R-42`, y las notas de Claude Code dicen si fue la CLI o la API.

---

## 3. Alcance y principios

### En alcance

- Trazabilidad de extremo a extremo de toda interacción: acciones de personas y de agentes externos por token, comandos del bus, flujos durables, construcción de contexto, llamadas a proveedores con sus eventos, efectos, actualizaciones de conocimiento y del clasificador.
- Evidencia completa para reconstruir: textos exactos enviados y recibidos, eventos crudos, transcripciones de las CLI, manifiesto del contexto con el origen de cada fragmento.
- Contabilidad de tokens normalizada entre proveedores, con caché, y latencias por fase.
- Historial de sesiones de conversación con cada proveedor, con la pareja de ids nuestro y suyo.
- Evaluaciones: las derivadas de lo que hacen las personas desde el primer día; jueces automáticos después, por la misma puerta.
- Almacén propio con ciclo de vida independiente, visor, cuadros de mando y consultas guardadas.

### Fuera de alcance

- Cualquier pantalla dentro de la web de DEMIURGO. La página de la ejecución sigue como está.
- Que DEMIURGO lea la evidencia para decidir algo: motor de contexto, enrutado de modelos, límites de gasto.
- Aprendizaje automático o mejora automática.
- Observabilidad de la aplicación entregada (Pilar 2) y de contenedores del runner. El modelo los admite; no se instrumentan ahora.
- Multiinquilino, telemetría remota de instalaciones de clientes, borrado por privacidad. Se deja preparado en el modelo (etiquetas de entorno y de instancia) y se decide cuando llegue.

### Principios

1. **La aplicación solo escribe.** Ninguna consulta, pantalla ni decisión de DEMIURGO lee la evidencia. Lo único que la aplicación guarda de esto son ids, no evidencia.
2. **Nunca bloquea.** Emitir es asíncrono, con colas acotadas. Si lo de fuera falla, DEMIURGO sigue; se cuenta lo perdido y se ve.
3. **Todo, literal, para siempre.** Textos completos, eventos crudos, transcripciones. Nada se borra por defecto. Lo grande se guarda por meses para poder soltarlo un día a propósito.
4. **Ocurrencia y contenido son identidades distintas.** Lo que pasa lleva un id de ocurrencia único y ordenado en el tiempo. Lo que se envía lleva huellas de contenido. Un reintento con el mismo pack es otra ocurrencia con la misma huella.
5. **Estándar donde está resuelto, propio donde no.** OpenTelemetry como transporte y vocabulario base, con versión fijada. El linaje del contexto, la evidencia de sesión entre CLI y el archivo, propios.
6. **Un vocabulario con versión.** Cada nota dice con qué versión del vocabulario se escribió. Una nota vieja siempre se puede leer.
7. **Observación no es causa.** El archivo guarda hechos. Las conclusiones las sacan personas mirando consultas, y entran como propuestas.

---

## 4. Arquitectura

### 4.1 Piezas y responsabilidades

| Pieza | Dónde corre | Código | Responsabilidad |
|---|---|---|---|
| Emisor | Dentro del proceso del API de DEMIURGO | `packages/core/src/observe/` | Abrir y cerrar notas con nuestro vocabulario, adjuntar textos por huella, propagar el id de traza a los procesos hijos, exportar por OTLP sin bloquear |
| Vocabulario | Compartido | `packages/domain/src/observe.ts` | Nombres de atributos, tipos de nota, versión del vocabulario, normalización de tokens. Puro, sin E/S |
| Colector | Contenedor `collector` del proyecto compose `demiurgo-evidence` | `packages/evidence/collector/config.yaml` | Recibir OTLP de DEMIURGO y de las CLI, archivar en ficheros, reintentar con cola persistente, repartir |
| Ingestor | Proceso en el equipo, `pnpm evidence serve` | `packages/evidence/src/` | Recibir OTLP/JSON del Colector, mapear a las tablas, garantizar idempotencia, reproducir desde ficheros |
| Base de evidencia | Contenedor `postgres` del mismo proyecto compose, puerto 55434 | `packages/evidence/migrations/` | Guardar el archivo con particiones mensuales y vistas |
| Phoenix | Contenedor `phoenix` del mismo proyecto compose, puerto 6006 | imagen `arizephoenix/phoenix` fijada por digest | Ver trazas; evaluaciones y experimentos cuando se quiera |
| Cuadros de mando | Contenedor `metabase` del mismo proyecto compose, fase 5 | imagen fijada por digest | Preguntas de negocio sobre la base de evidencia |

Decisión (Claude): el ingestor corre en el equipo, no en contenedor, en la primera versión. Motivo: el monorepo ya ejecuta TypeScript con Node 24 sin build y el API corre igual en el equipo; un Dockerfile del monorepo es trabajo sin valor ahora. El Colector le llega por `host.docker.internal:4319`. Se puede meter en contenedor más adelante sin cambiar nada más.

Decisión (Claude): la base de evidencia tiene **su propio servidor Postgres**, no otra base en el servidor de la instancia. Motivo: independencia total del ciclo de vida. `pnpm snap`, `docker compose down -v` del proyecto `demiurgo-v2` o cambiar de servidor de la instancia no pueden afectarla. Cuesta un contenedor ligero.

### 4.2 Despliegue

Un fichero `compose.evidence.yaml` en la raíz, proyecto compose `demiurgo-evidence`, con volúmenes propios:

| Servicio | Puerto en el equipo | Volúmenes | Notas |
|---|---|---|---|
| `postgres` | `127.0.0.1:55434` | `evidence-data` | Postgres 18 (misma imagen fijada que la instancia). Crea las bases `demiurgo_evidence` y `phoenix` con un script de inicialización |
| `collector` | `127.0.0.1:4317` (gRPC) y `127.0.0.1:4318` (HTTP) | `evidence-archive` (ficheros), `evidence-queue` (cola persistente) | `otel/opentelemetry-collector-contrib`, fijada por digest. Configuración montada desde el repo |
| `phoenix` | `127.0.0.1:6006` | ninguno (usa la base `phoenix`) | Recibe solo trazas, por OTLP gRPC desde el Colector |
| `metabase` | `127.0.0.1:3300` | `evidence-metabase` | Fase 5 |

Scripts en `package.json`: `evidence:up` y `evidence:down` (compose), `evidence` (`node packages/evidence/src/cli.ts`).

Los puertos 8000 y todo lo de `demiurgo-stable` siguen prohibidos. Nada de esto toca la instancia 8100 más allá de las variables de entorno del emisor.

### 4.3 Entornos

Toda nota lleva `deployment.environment.name`, con uno de estos valores: `real` (instancia 8100), `qa` (instancia 8101), `dev` (desarrollo en 55432) y `test` (pruebas). Todos escriben en la misma base de evidencia del equipo, separados por esa etiqueta. Las pruebas automáticas emiten a un exportador en memoria o a nada, nunca al Colector.

Decisión (Claude): una sola base de evidencia por equipo. Motivo: las preguntas de negocio y las comparaciones entre motores quieren ver todo junto; la etiqueta separa lo que haga falta.

---

## 5. Identidad y propagación

### 5.1 El id de interacción

- **Qué es.** Un UUID versión 7, ordenado en el tiempo, generado por DEMIURGO cuando un comando entra por una raíz: el API (personas por cookie y agentes por token, incluido lo que llega desde el servidor MCP), la CLI de operación (`pnpm cli`) y las raíces del sistema (conciliación al arrancar, trabajos diferidos sin causa).
- **Es el id de traza de OpenTelemetry.** Sus 32 caracteres hexadecimales sin guiones son el `trace_id`. Así el mismo id aparece en las notas de DEMIURGO, en las de Claude Code, que lee `TRACEPARENT` del entorno, y en el archivo. Se consigue con un `IdGenerator` propio del SDK que toma el id pendiente de un `AsyncLocalStorage` cuando se abre la nota raíz.
- **Es la correlación del diario.** `Cause.correlation` deja de ser un UUID nuevo por transacción y pasa a ser el id de interacción activo. `executeCommand` e `inTransaction` lo toman del contexto de observación si la petición no trae uno. Los comandos anidados ya lo heredan. Esto cumple AC-NUC-001-05 de forma general, no solo dentro de una transacción.
- **Qué hereda el id.** Todo lo que la interacción provoca: el flujo durable de la respuesta a un mensaje, la ejecución, su pack, sus llamadas, sus efectos, las actualizaciones de conocimiento que dispara una decisión de autoridad y las evaluaciones de ideas de un lote. Una interacción puede durar minutos; no tiene fin explícito. El ingestor calcula `last_seen_at`.
- **Qué no hereda.** Un reintento pedido por una persona es una interacción nueva. Su ejecución lleva un **enlace** a la ejecución original (`retry_of`), que en OpenTelemetry es un span link.

### 5.2 Sobrevivir a reinicios y a los flujos durables

Los flujos de DBOS se reanudan tras un reinicio en otro proceso, sin contexto en memoria. Para que cada paso siga colgado de la interacción que lo pidió:

- **Tabla nueva en la base operativa**, migración `0013_trace_contexts.sql`:

  ```sql
  create table trace_contexts (
    entity_type text not null,
    entity_id uuid not null,
    project_id uuid not null references projects (id),
    trace_parent text not null,          -- W3C: 00-<trace_id>-<span_id>-01
    created_at timestamptz not null default now(),
    primary key (entity_type, entity_id)
  );
  -- append-only: rechaza UPDATE y DELETE con el disparador append_only()
  ```

- **Quién escribe.** El bus, en la misma transacción, para todo comando de creación (`isCreation`) que cree de verdad la entidad: la entidad recién creada queda unida a la nota del comando que la creó. Cubre `ai_run`, `knowledge_update`, `batch`, `message`, `context_pack` y las demás. Una creación idempotente que devuelve una entidad existente (`noChanges`, como un pack ya construido) no escribe nada. Los manejadores no se enteran.
- **Quién lee.** El motor, al entrar en cada paso de un flujo (`prepare`, `invoke`, `apply`, `freshness`, `request`, `classify`…): toma el `trace_parent` de la entidad del flujo y abre la nota del paso como hija de ese padre. Es lo único de observación que lee la aplicación, y es un id, no evidencia.
- `project_id` va en la tabla para cumplir AC-ESQ-001-17. La tabla no es de dominio: no está en `design/data/` ni tiene comandos.

### 5.3 Las notas no viven abiertas

Un span de OpenTelemetry se abre y se cierra en el mismo proceso. Una ejecución cruza transacciones, pasos y a veces reinicios. Por eso **no hay un span «ejecución»**: cada paso es su propio span, hijo del comando que pidió la ejecución, con el atributo `demiurgo.run.id`. El ingestor materializa la fila de la ejecución juntando sus pasos. Lo mismo con las interacciones: la raíz del API se cierra al responder la petición HTTP; los hijos siguen llegando después y cuelgan de ella por id.

### 5.4 Sesiones de conversación

- **Id nuestro.** El motor genera un UUID versión 4 al abrir una sesión nueva y lo entrega en `SessionRequest` (`{ mode: 'fresh', directory, id }`). Claude lo usa tal cual con `--session-id`, como hoy pero decidido por el motor y no por el adaptador. Codex no admite fijar el id: genera el suyo y lo emite en `thread.started`; el adaptador lo devuelve y la nota de la llamada lleva los dos. OpenCode no tiene sesión.
- **Nombre visible.** Claude Code admite `--name`; se le pone `demiurgo <agente> <hilo corto>` para que la sesión se reconozca en su propio listado. Codex no lo admite al crear.
- **Historial.** La base operativa sigue con `agent_sessions` como hoy, una fila por clave con la sesión vigente. La base de evidencia guarda **cada uso**: sesión, ejecución, modo, ejecución base, delta. Así se reconstruye la cadena completa aunque la fila operativa se sobrescriba.
- **Transcripciones.** Las dos CLI dejan la conversación en disco, fuera de la base: Claude en la carpeta de proyectos de `CLAUDE_CONFIG_DIR` o `~/.claude`, por directorio de trabajo y `session_id`; Codex en `$CODEX_HOME/sessions`. Tras cada llamada, el adaptador localiza el fichero, anota ruta, tamaño y huella, y emite como texto **lo añadido desde la última llamada de esa sesión**. Es lo más cercano a lo que el modelo vio de verdad. El detalle de cómo localizarlas se verifica en la fase 4 (§18).
- **La clave de sesión** sigue igual: ámbito, agente con versión, proveedor y modelo, sin effort. La evidencia guarda su huella (`key_hash`) y sus ingredientes por separado.

### 5.5 Huellas de contenido

Todo texto que sale o entra lleva huella SHA-256 completa (64 hexadecimales) sobre el texto tal cual. Los textos se guardan una sola vez por huella. Huellas por ejecución y llamada:

| Huella | De qué | Hoy |
|---|---|---|
| `prompt_hash` | System prompt enviado, completo, reglas de la primitiva incluidas | Existe; en el clasificador no coincide con lo enviado (se corrige) |
| `input_hash` | Texto de entrada por stdin, completo | No existe |
| `schema_hash` | JSON Schema realmente enviado, ya estrechado y adaptado al proveedor | No existe; solo la versión del esquema base |
| `pack_hash` | Context pack | Existe |
| `delta_hash` | Lo añadido en una reanudación | Existe; el contenido del delta no se guarda (pasa a guardarse como texto) |
| `output_hash` | Salida cruda tal cual llegó, antes de validar | No existe |
| `stderr_hash` | stderr completo | No existe |
| `transcript_hash` | Fichero de transcripción tras la llamada | No existe |

### 5.6 Etiquetas de toda nota

`service.name` = `demiurgo`, `service.version` = commit (`DEMIURGO_SERVICE_VERSION`, que pone quien lanza el proceso), `deployment.environment.name`, `demiurgo.instance` (puerto o nombre de la instancia), `demiurgo.schema_version` (versión del vocabulario, empieza en 1), `demiurgo.workflows_version` (`WORKFLOWS_VERSION` de DBOS).

---

## 6. Vocabulario de las notas

Dos tipos de nota de OpenTelemetry: **spans** (algo con principio y fin) y **log records** (un hecho o un texto). No se usan métricas de OpenTelemetry: todas las métricas se derivan del archivo, una sola fuente.

### 6.1 Spans

| Span | Nombre | Padre | Atributos propios |
|---|---|---|---|
| Interacción | `interaction <command>` | ninguno | `demiurgo.interaction.id`, `demiurgo.channel` (`api`, `mcp`, `cli`, `system`), `demiurgo.actor`, `demiurgo.actor.type`, `demiurgo.project.id`, `demiurgo.command`, `demiurgo.entity.type`, `demiurgo.entity.id`, `http.route` cuando aplica |
| Comando del bus | `command <command>` | la interacción, o el comando que lo anida | `demiurgo.command`, `demiurgo.actor`, `demiurgo.actor.type`, `demiurgo.project.id`, `demiurgo.entity.type`, `demiurgo.entity.id`, `demiurgo.entity.version`, `demiurgo.state.before`, `demiurgo.state.after`, `demiurgo.event.seq` (o `demiurgo.event.none=true` si no hubo cambios), `demiurgo.outcome` (`ok`, `forbidden`, `validation`, `not_found`, `invalid_transition`, `guard`, `rollback`, `error`), `demiurgo.reasons` (lista), `demiurgo.cause.run`, `demiurgo.cause.batch`, `demiurgo.cause.proposal`, `demiurgo.payload.before.hash`, `demiurgo.payload.after.hash` |
| Paso del motor | `run.prepare`, `run.invoke`, `run.apply`, `run.fail`, `response.freshness`, `response.request`, `knowledge.classify`, `knowledge.apply`, `ideas.assess` | el comando que creó la entidad del flujo, vía `trace_contexts` | `demiurgo.run.id`, `demiurgo.update.id`, `demiurgo.batch.id`, `demiurgo.workflow.id`, `demiurgo.step.attempt` (DBOS puede repetir un paso), `demiurgo.step.result` |
| Llamada al proveedor | `invoke_agent <agent>` | el paso `run.invoke` o `knowledge.classify` | ver §6.2 |
| Notas de las CLI | las que emitan Claude Code y Codex | la llamada al proveedor (Claude) o ninguno (Codex, se une por etiqueta) | las suyas, sin tocar |

Estados: `ok` o `error` con `error.type` (el tipo de `DomainError` o `failure_kind`) y `error.message`.

### 6.2 La llamada al proveedor

Convenciones GenAI de OpenTelemetry, fijadas a los nombres del repositorio `semantic-conventions-genai` a 09-2026, más las nuestras. Todo está en estado *Development* en el estándar; por eso los nombres viven en un solo sitio, `packages/domain/src/observe.ts`, y un cambio de nombre es un cambio de versión del vocabulario.

| Atributo | Valor |
|---|---|
| `gen_ai.operation.name` | `invoke_agent` |
| `gen_ai.provider.name` | `anthropic` (claude), `openai` (codex), la clave del proveedor de OpenCode (`qwen-local`…), `demiurgo_simulated` |
| `demiurgo.provider.id` | `claude`, `codex`, `opencode`, `simulated` |
| `gen_ai.agent.name`, `gen_ai.agent.version` | agente y su versión |
| `gen_ai.request.model`, `gen_ai.response.model` | pedido y observado. En Codex, observado = pedido con `demiurgo.model.observed_provenance=not_reported` |
| `demiurgo.effort` | effort |
| `demiurgo.engine.source` | `override`, `agent`, `group` |
| `gen_ai.conversation.id` | id de sesión del proveedor, cuando la hay |
| `demiurgo.session.id`, `demiurgo.session.mode`, `demiurgo.session.key_hash`, `demiurgo.session.base_run`, `demiurgo.session.base_pack_hash`, `demiurgo.delta.hash` | la sesión vista por DEMIURGO |
| `demiurgo.call.id`, `demiurgo.call.attempt` | fila de `agent_calls` y 1 o 2 (plan B tras perder la sesión) |
| `demiurgo.run.id`, `demiurgo.update.id` | quién la pidió |
| `demiurgo.prompt.hash`, `demiurgo.input.hash`, `demiurgo.schema.hash`, `demiurgo.schema.version`, `demiurgo.output.hash` | huellas |
| `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_write.input_tokens`, `gen_ai.usage.reasoning.output_tokens` | uso normalizado (§8). `input_tokens` incluye la caché, como manda el estándar |
| `demiurgo.usage.uncached_input_tokens`, `demiurgo.usage.declared_cost_usd`, `demiurgo.usage.turns`, `demiurgo.usage.provenance` (JSON), `demiurgo.usage.raw` (JSON tal cual del proveedor) | uso propio |
| `demiurgo.call.duration_reported_ms`, `demiurgo.call.duration_api_ms`, `demiurgo.call.ttft_ms` | tiempos que reporte el proveedor, si los reporta |
| `demiurgo.cli.version`, `demiurgo.cli.command` (argv, sin entorno), `demiurgo.cli.cwd`, `demiurgo.cli.exit_code`, `demiurgo.cli.stderr_hash`, `demiurgo.cli.stop_reason` | lo que hoy se tira |
| `demiurgo.transcript.path`, `demiurgo.transcript.size`, `demiurgo.transcript.hash` | la transcripción de la CLI |
| `gen_ai.system_instructions`, `gen_ai.input.messages` | copia del system y de la entrada, recortada a 64 000 caracteres, **solo para que Phoenix la enseñe**. El ingestor la ignora: tiene los textos enteros aparte |
| `demiurgo.failure_kind`, `error.type`, `error.message` | fallo |

### 6.3 Log records

| Nota | Atributos | Cuerpo |
|---|---|---|
| `demiurgo.text` | `demiurgo.text.hash`, `demiurgo.text.kind` (`system_prompt`, `input`, `schema`, `output_raw`, `stderr`, `transcript_chunk`, `pack_content`, `delta`), `demiurgo.text.chars`, y para `transcript_chunk` `demiurgo.session.id` y `demiurgo.transcript.offset` | el texto entero. Se emite una vez por huella y proceso (caché de huellas emitidas, 10 000 entradas) |
| `demiurgo.provider.event` | `demiurgo.event.id` (UUID v7, para idempotencia), `demiurgo.call.id`, `demiurgo.event.seq`, `demiurgo.event.kind`, `demiurgo.event.tokens`, `demiurgo.event.received_at` | la línea cruda entera, sin recorte |
| `demiurgo.context.manifest` | `demiurgo.pack.hash`, `demiurgo.pack.id`, `demiurgo.pack.builder`, `demiurgo.pack.role`, `demiurgo.graph.version`, `demiurgo.pack.budget` (JSON), `demiurgo.pack.reused=true` cuando el pack ya existía y no se reconstruyó | el manifiesto en JSON (§9) |
| `demiurgo.journal` | `demiurgo.event.seq`, `demiurgo.command`, `demiurgo.entity.type`, `demiurgo.entity.id` | `{ before, after }` del evento del diario |
| `gen_ai.evaluation.result` | `gen_ai.evaluation.name`, `gen_ai.evaluation.score.value`, `gen_ai.evaluation.score.label`, `gen_ai.evaluation.explanation`, `demiurgo.evaluation.target.type`, `demiurgo.evaluation.target.id`, `demiurgo.evaluation.by`, `demiurgo.evaluation.source` (`human`, `judge`, `rule`) | vacío. Las de personas las deriva el ingestor; las de jueces se emitirán por aquí |
| `demiurgo.observe.dropped` | `demiurgo.observe.dropped.spans`, `demiurgo.observe.dropped.logs`, `demiurgo.observe.since` | vacío. Se emite cuando la tubería vuelve tras haber perdido notas |

### 6.4 Qué nunca va en una nota

- El `result` de un comando. `agent_token.create` devuelve el secreto una sola vez ahí. Las notas llevan `before` y `after`, como el diario, y el diario ya nunca lleva secretos.
- El entorno del proceso hijo. Solo el argv.
- Contraseñas de personas: el login no es un comando del bus.
- Nada sale del equipo: los exportadores del Colector apuntan a `localhost`. Si algún día se exporta fuera, el Colector es el único sitio donde poner redacción (§14.5).

---

## 7. Puntos de emisión dentro de DEMIURGO

### 7.1 El puerto `Observer` en `Services`

```ts
export type Observer = {
  /** Abre una interacción: genera el id, lo fija como id de traza y ejecuta `fn` dentro. */
  interaction<T>(root: InteractionRoot, fn: (ctx: InteractionContext) => Promise<T>): Promise<T>;
  /** Un span hijo del contexto activo (o de `parent`, un traceparent de trace_contexts). */
  span<T>(name: string, attrs: Attributes, fn: (s: SpanHandle) => Promise<T>, parent?: string): Promise<T>;
  /** El id de la interacción activa (la correlación del diario), o null fuera de una. */
  currentInteractionId(): string | null;
  /** El traceparent del span activo, para trace_contexts y para el entorno de las CLI. */
  currentTraceParent(): string | null;
  /** Textos por huella, eventos crudos, manifiesto, diario, evaluaciones. */
  text(kind: TextKind, body: string, attrs?: Attributes): string; // devuelve la huella
  event(name: LogName, attrs: Attributes, body?: unknown): void;
  /** Cierra colas y exporta lo pendiente, con límite de tiempo. */
  flush(timeoutMs: number): Promise<void>;
};
```

Tres implementaciones: `otlpObserver` (SDK de OpenTelemetry, exporta a `DEMIURGO_OTLP_ENDPOINT`), `memoryObserver` (para pruebas: guarda spans y logs en memoria) y `noopObserver` (`DEMIURGO_OBSERVE=off`). Ningún método lanza excepciones: todo error interno se traga y se cuenta.

Configuración nueva en `config.ts`: `DEMIURGO_OBSERVE` (`otlp` por defecto, `off`), `DEMIURGO_OTLP_ENDPOINT` (`http://127.0.0.1:4318`), `DEMIURGO_ENVIRONMENT` (`dev` por defecto; `real` y `qa` los ponen los lanzadores de cada instancia), `DEMIURGO_SERVICE_VERSION` (`unknown` por defecto). `DEMIURGO_INSTANCE` se deriva del puerto.

Dependencias nuevas en `packages/core`: `@opentelemetry/api`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/sdk-logs`, `@opentelemetry/resources`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/exporter-logs-otlp-http`, `@opentelemetry/context-async-hooks`. No se usa `sdk-node` ni autoinstrumentaciones: nada de spans por consulta SQL ni por petición HTTP, que serían ruido; se instrumenta a mano en cuatro puntos.

### 7.2 El API (`packages/api/src/server.ts`)

- La ruta `POST /api/projects/:projectId/commands/:command` y `POST /api/projects` envuelven `executeCommand` en `observer.interaction({ channel, actor, command, projectId, entityId })`. El canal es `mcp` cuando la petición trae la cabecera `x-demiurgo-channel: mcp`, que el cliente fino del servidor MCP (`packages/mcp`) pasa a enviar; sin cabecera, `api`.
- Las rutas de consulta y el SSE no emiten nada.
- `pnpm cli` envuelve cada orden que ejecute comandos en una interacción con canal `cli`.
- Las raíces del sistema: `reconcileRuns`, `reconcileResponses`, los reconciliadores de conocimiento y `dispatchDeferred` sin contexto abren una interacción con canal `system` y actor `system:<componente>`.

### 7.3 El bus (`packages/core/src/bus/bus.ts`)

- `executeInTransaction` abre `command <name>` alrededor de capacidad, validación, carga, transición, guardas, `apply` y `registerEvent`. Registra el desenlace y, en éxito, el `seq` del evento y la nota `demiurgo.journal` con `before` y `after`.
- La correlación: `request.cause?.correlation ?? observer.currentInteractionId() ?? randomUUID()`. En `inTransaction`, igual.
- Para todo comando de creación con éxito, inserta en `trace_contexts` `(entity, entityId, projectId, observer.currentTraceParent())` en la misma transacción. Si el observer es `noop`, no inserta nada.
- Los spans de los comandos se cierran dentro de la transacción, antes de saber si confirma. Si la transacción se revierte (fallo en un comando anidado posterior o en el commit), `executeCommand` o `inTransaction` emiten la nota `demiurgo.transaction.rollback` con los ids de los spans de comandos que contenía. El ingestor marca esas filas de `commands` con `outcome=rollback` y descarta sus `journal_payloads`: el diario no llegó a tener esos eventos.

### 7.4 El motor (`packages/core/src/engine/engine.ts` y los flujos de conocimiento)

- Cada paso (`prepare`, `invoke`, `apply`, `fail`, `freshness`, `request`, `abandon`, y `classify`, `apply`, `assess` de conocimiento) se ejecuta dentro de `observer.span(step, attrs, fn, traceParentDe(entidad))`, donde el padre sale de `trace_contexts` para la entidad del flujo (`ai_run`, `message`, `knowledge_update`, `batch`). `demiurgo.step.attempt` cuenta las repeticiones del mismo paso en el mismo flujo (el motor lleva un contador por `workflow_id` y paso en memoria; tras un reinicio empieza en 1 otra vez y el ingestor lo ve por la fecha).
- `invoke` genera el id de sesión nuestro para el modo `fresh`, y calcula y emite como textos el system prompt, la entrada, el delta y el esquema realmente enviado, con sus huellas.
- `invoke` pasa a `callProvider` la fuente del motor (`override`, `agent` o `group`), que hoy no se guarda en ninguna columna. `run.request` y `run.retry` pasan a incluirla en `events.after` (`engine_source`), y `invoke` la lee del evento de petición de la ejecución (consulta al diario por `entity_id` y comando). Decisión (Claude): sin columna nueva en `ai_runs`; el diario ya es la fuente de ese dato.
- Tras `invoke`, el motor localiza la transcripción de la CLI y emite ruta, tamaño, huella y el trozo nuevo (§5.4).
- `apply` emite `demiurgo.output.hash` y el texto `output_raw` antes de validar, para que una salida `invalid_output` quede entera aunque `ai_runs.output` no la guarde.

### 7.5 La llamada al proveedor (`packages/core/src/assignments/calls.ts`)

`callProvider` es el único cuello por el que pasan ejecuciones y clasificador. Ahí:

- Se abre el span `invoke_agent <agent>` con los atributos de §6.2. `CallMeta` gana `updateId` (clasificador), `engineSource`, `session` (id nuestro, modo, base, delta) y `attempt`.
- Cada `ProviderEvent` se emite como `demiurgo.provider.event` con la línea entera. La escritura en `agent_call_events` sigue igual, recortada, porque alimenta el progreso en vivo del producto.
- Al terminar, se rellenan uso normalizado, modelo observado, fallo, `details` del adaptador (§7.6) y el `traceparent` que se le dio a la CLI.

### 7.6 Los adaptadores (`packages/core/src/providers/`)

`AgentResult` gana un campo opcional `details`, con lo que cada adaptador sepa: `cliVersion`, `cliCommand` (argv), `exitCode`, `stderr` (entero; el span lleva solo la huella y el texto va aparte), `durationApiMs`, `ttftMs`, `stopReason`, `rawUsage` (el objeto de uso tal cual), `transcriptPath`. Ningún campo es obligatorio y ninguno cambia el comportamiento de la ejecución.

**Claude.** Usa el id de sesión que le da el motor (`--session-id`) y `--name`. Devuelve en `details` lo del `result` y del `init` que hoy se tira: `cache_creation_input_tokens` por separado, `cache_creation.ephemeral_5m_input_tokens` y `ephemeral_1h_input_tokens`, `duration_api_ms`, `ttft_ms`, `stop_reason`, `modelUsage` entero, `claude_code_version`, `cwd`, `permission_denials`. Pasa al proceso hijo, calculadas por llamada y no heredadas del entorno: `TRACEPARENT`, `OTEL_RESOURCE_ATTRIBUTES` (`demiurgo.interaction.id`, `demiurgo.call.id`, `demiurgo.run.id`, `deployment.environment.name`), `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_TRACES_EXPORTER=otlp`, `OTEL_LOGS_EXPORTER=otlp`, `OTEL_METRICS_EXPORTER=none`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, `OTEL_EXPORTER_OTLP_ENDPOINT` (el Colector), `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`. `allowedEnv` gana un tercer parámetro, `fixed`, con estas variables por llamada; las `OTEL_*` del entorno del padre siguen sin pasar. Se mantiene `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`; en la fase 4 se verifica que no anule la exportación OTel propia (§18).

**Codex.** Devuelve en `details` la salida cruda del fichero `-o` tal cual (hoy solo se conserva si pasa la validación) y `cache_write_input_tokens` si llega. Pasa `-c otel.exporter=…` apuntando al Colector por OTLP/HTTP, `-c otel.log_user_prompt=false`, `-c 'otel.environment="<entorno>"'` y `OTEL_RESOURCE_ATTRIBUTES` con las mismas etiquetas que Claude. Codex no lee `TRACEPARENT` (no verificado, §18): sus notas llegan con otro id de traza y el ingestor las une por `demiurgo.call.id` de los atributos de recurso. El modelo observado sigue siendo el pedido, marcado como `not_reported`.

**OpenCode.** Devuelve `rawUsage`, `finish_reason`, `system_fingerprint` y `chunk.id`, y `details.attempts` con la lista de intentos y sus motivos. No hay sesión ni telemetría propia.

**Simulado.** Emite lo mismo que los reales, con `gen_ai.provider.name=demiurgo_simulated`, y `rawUsage` con sus cifras en caracteres, para que las pruebas ejerciten el circuito entero.

### 7.7 Los constructores de context pack

Ver §9. El cambio es que cada constructor devuelve `{ pack, manifest }`; `run.request` manda `pack` al comando `context_pack.build` como hoy y emite `manifest` en la nota `demiurgo.context.manifest` dentro del span de ese comando. El manifiesto no entra en la huella del pack ni en la base operativa.

### 7.8 El clasificador (`packages/core/src/assignments/classifiers.ts`)

- `CallMeta.updateId`: las llamadas del clasificador y del revisor llevan el id de la actualización de conocimiento que las causó. Hoy no hay ningún enlace.
- **Corrección de producto:** `promptHash` se calcula con las reglas de la primitiva incluidas, igual que el system que se envía. Hoy no coinciden (`classifiers.ts:41` frente a `:51`).
- El clasificador simulado y los aciertos de `verdict_cache` no llaman a ningún proveedor; el paso `knowledge.classify` lo anota (`demiurgo.classify.source=cache|simulated|provider`).
- `pnpm cli evaluate-classifier` pasa por `callProvider` en vez de llamar a `provider.run` directamente, para que las evaluaciones dejen rastro.

### 7.9 Lo que no cambia dentro

`agent_calls`, `agent_call_events`, `agent_sessions`, `ai_run_logs`, `context_packs` y la página de la ejecución siguen igual. `ai_run_logs` queda como copia de seguridad del producto; retirarla es una limpieza posterior, no parte de esto.

---

## 8. Contabilidad de tokens normalizada

Cada proveedor cuenta distinto. Anthropic **excluye** la caché de `input_tokens`; OpenAI la **incluye**; los modelos locales a veces no la reportan. El modelo canónico tiene cinco cifras, todas en tokens, y una procedencia por cifra:

| Cifra | Claude (`result.usage`) | Codex (`turn.completed.usage`) | OpenCode (`usage`) |
|---|---|---|---|
| `uncached_input` | `input_tokens` | `input_tokens - cached_input_tokens` | `prompt_tokens - prompt_tokens_details.cached_tokens` |
| `cache_read` | `cache_read_input_tokens` | `cached_input_tokens` | `prompt_tokens_details.cached_tokens` (si falta, `not_reported`, no cero) |
| `cache_write` | `cache_creation_input_tokens` (y por TTL: `ephemeral_5m`, `ephemeral_1h` en `raw`) | `cache_write_input_tokens` si aparece | `not_reported` |
| `output` | `output_tokens` | `output_tokens` | `completion_tokens` |
| `reasoning` | `output_tokens_details.thinking_tokens` | `reasoning_output_tokens` | `completion_tokens_details.reasoning_tokens` |

Derivadas: `input_total = uncached_input + cache_read + cache_write` (lo que OpenTelemetry llama `gen_ai.usage.input_tokens`), `cache_ratio = cache_read / input_total`. El coste declarado solo lo da Claude, y es acumulado por sesión en `stream-json` (trampa conocida): se guarda tal cual con procedencia `claude:result.total_cost_usd:cumulative`, y el coste por llamada se deriva restando el de la llamada anterior de la misma sesión. El uso crudo del proveedor se guarda siempre entero, al lado del normalizado.

La normalización vive en `packages/domain/src/observe.ts` (`normalizeUsage(provider, raw)`), pura y probada con los fixtures reales de `packages/core/test/fixtures/`. El tipo `Usage` actual del dominio se mantiene para el producto; `agent_calls.usage` no cambia.

---

## 9. Manifiesto y linaje del contexto

Es la parte que nadie del mercado resuelve y la que más vale para el motor de contexto. El vocabulario es el de W3C PROV: cada fragmento es una **entidad** que **deriva de** una entidad de autoridad (mensaje, versión de registro, fuente, nodo de conocimiento) y que **generó una actividad** del constructor (seleccionar, recortar, resumir, descartar), **atribuida** a un constructor con versión.

### 9.1 El manifiesto

```ts
type Manifest = {
  builder: string;              // 'exploration_chat@2'
  graphVersion: number;
  budget: Record<string, number>;
  fragments: Fragment[];
  candidates: number;           // cuántos se consideraron
};
type Fragment = {
  seq: number;                  // orden de consideración
  section: string;              // 'messages', 'confirmed_decisions', 'untrusted_sources', 'knowledge', 'questions', 'purpose', 'design_stage'
  source: { type: string; id: string; version: number | null; eventSeq: number | null };
  textHash: string;             // del texto tal como entró (o habría entrado)
  chars: number;                // tamaño final
  originalChars: number;        // tamaño antes de recortar
  decision: 'included' | 'truncated' | 'summarized' | 'dropped';
  reason: string;               // 'budget:messages', 'limit:60', 'excerpt:2000', 'relevance:0.31', 'below_threshold', 'state:discarded'…
  score: number | null;         // relevancia cuando la hay
  position: number | null;      // posición en el pack si entró
};
```

### 9.2 Cambios en los constructores

- `Builder` devuelve `Promise<{ pack: PackData; manifest: Manifest }>`. `buildContext` lo propaga. `echo` devuelve un manifiesto de un fragmento.
- `exploration_chat`: los mensajes se consultan con `created_at` y se anota el `seq` del evento `message.post` de cada uno (consulta al diario por entidad); los que caen por el límite de 60 o por presupuesto se anotan como `dropped`; las decisiones recortadas a 400 caracteres, como `truncated`; las fuentes, con `limit:5` y `excerpt:2000`; los nodos de conocimiento con su puntuación.
- `selectForContext` en el dominio devuelve `{ chosen, considered }`, donde `considered` lista todos los candidatos con su similitud y el motivo de quedar fuera (`budget` o `below_threshold`). Es un cambio puro y pequeño.
- `design_proposal` y cualquier constructor futuro cumplen el mismo contrato. Una prueba de invariante comprueba que todo constructor registrado devuelve manifiesto y que `sum(chars de included) <= presupuesto por sección`.
- El constructor sube de versión (`exploration_chat@2`) porque cambia lo que registra, aunque el contenido del pack no cambie.

### 9.3 Qué se puede responder con esto

- Qué recibió exactamente el agente y de dónde procedía cada fragmento, con versión y evento.
- Qué se quedó fuera y por qué, y cuánto presupuesto se llenó por sección.
- Cómo cambió el contexto entre dos ejecuciones del mismo hilo: diferencia de manifiestos, no solo el delta enviado.
- Con el tiempo, la métrica «¿faltó contexto?» de S5: una pregunta que el agente plantea sobre algo que estaba en un fragmento `dropped` es una señal medible.

---

## 10. La base de evidencia

Base `demiurgo_evidence` en el Postgres de evidencia. Identificadores en inglés. Migraciones SQL planas con el mismo migrador con checksum del núcleo, copiado a `packages/evidence/src/db/`. Las tablas grandes van particionadas por mes; el ingestor crea la partición del mes siguiente por adelantado.

| Tabla | Clave | Columnas principales | Partición |
|---|---|---|---|
| `interactions` | `id uuid` | `environment, instance, service_version, project_id, channel, actor, actor_type, root_command, root_entity_type, root_entity_id, started_at, last_seen_at, span_count, error_count` | no |
| `spans` | `(trace_id, span_id)` | `parent_span_id, source (demiurgo, claude_code, codex, other), kind, name, started_at, ended_at, duration_ms, status, error_type, error_message, project_id, run_id, call_id, update_id, batch_id, entity_type, entity_id, attributes jsonb, links jsonb` | mensual por `started_at` |
| `commands` | `(trace_id, span_id)` | `project_id, actor, actor_type, command, entity_type, entity_id, entity_version, state_before, state_after, event_seq, outcome, reasons jsonb, cause_run, cause_batch, cause_proposal, before_hash, after_hash, started_at, ended_at` | mensual |
| `runs` | `run_id` | `trace_id, project_id, action, agent, agent_version, provider, requested_model, observed_model, effort, engine_source, pack_hash, schema_version, prompt_hash, session_id, session_mode, provider_session_id, base_run_id, base_pack_hash, delta_hash, retry_of, answers_message_id, requested_at, started_at, finished_at, state, failure_kind, error, usage jsonb, output_hash` | no |
| `provider_calls` | `call_id` | `trace_id, span_id, run_id, update_id, project_id, agent, agent_version, provider, provider_name, requested_model, observed_model, effort, engine_source, attempt, session_id, session_mode, provider_session_id, base_run_id, base_pack_hash, delta_hash, prompt_hash, input_hash, schema_hash, schema_version, output_hash, cli_version, cli_command, cli_cwd, exit_code, stderr_hash, stop_reason, state, failure_kind, error, started_at, finished_at, duration_ms, duration_reported_ms, duration_api_ms, ttft_ms, tokens_uncached_input, tokens_cache_read, tokens_cache_write, tokens_output, tokens_reasoning, tokens_provenance jsonb, usage_raw jsonb, declared_cost_usd, derived_cost_usd, turns, transcript_path, transcript_size, transcript_hash` | no |
| `provider_events` | `event_id` | `call_id, seq, kind, tokens, received_at, raw text` | mensual por `received_at` |
| `cli_requests` | `id` | `trace_id, call_id, source, request_id, attempt, model, at, duration_ms, ttft_ms, stop_reason, tokens_uncached_input, tokens_cache_read, tokens_cache_write, tokens_output, tokens_reasoning, cost_usd, error_status, attributes jsonb` | mensual |
| `sessions` | `session_id` | `provider, provider_session_id, key_hash, project_id, scope jsonb, agent, agent_version, model, created_trace_id, created_call_id, created_at, name, transcript_path` | no |
| `session_uses` | `call_id` | `session_id, run_id, mode, base_run_id, delta_hash, tokens_cache_read, tokens_uncached_input, at` | no |
| `transcript_chunks` | `(session_id, offset)` | `call_id, chars, text_hash, at` | no |
| `context_manifests` | `pack_hash` | `pack_id, project_id, builder, role, graph_version, budget jsonb, candidates, fragments, included_chars, dropped_count, built_trace_id, built_at` | no |
| `context_fragments` | `(pack_hash, seq)` | `section, source_type, source_id, source_version, source_event_seq, text_hash, chars, original_chars, decision, reason, score, position` | no |
| `texts` | `hash` | `kind, chars, body text, first_seen_at` | no |
| `journal_payloads` | `(trace_id, span_id)` | `event_seq, before jsonb, after jsonb` | mensual |
| `batches` | `batch_id` | `run_id, trace_id, project_id, proposals, submitted_at` | no |
| `evaluations` | `id` | `trace_id, target_type, target_id, name, score, label, explanation, by_actor, source, at` | no |
| `unmapped_records` | `id` | `received_at, kind (span, log), reason, record jsonb` | mensual |
| `ingest_receipts` | `id` | `received_at, origin (collector, replay:<file>), spans, logs, upserted, unmapped, ms` | no |

Índices: por `trace_id` en todas las particionadas; `runs(project_id, requested_at)`, `provider_calls(run_id)`, `provider_calls(session_id, started_at)`, `provider_events(call_id, seq)`, `cli_requests(call_id)`, `context_fragments(source_type, source_id)`, `evaluations(target_type, target_id)`, `texts(kind)`.

Vistas, en `packages/evidence/migrations/` y con prueba: `v_interaction_summary` (tiempos por fase), `v_session_reuse` (por llamada: modo, base, delta, `cache_ratio`, veredicto `reused | partial | lost | none`), `v_tokens_by_engine` (por proveedor, modelo, effort, agente y versión), `v_decision_effort` (por decisión: interacciones, preguntas, tiempo hasta aceptar, ejecuciones, tokens), `v_context_budget` (por pack: llenado por sección, descartes), `v_engine_reliability` (fallos por tipo, reintentos, aceptaciones sin edición).

Consultas guardadas en `packages/evidence/questions/*.sql`, cada una con su pregunta en la cabecera. La primera: `session-reuse.sql`. `pnpm evidence ask session-reuse --run <id>` la ejecuta y pinta una tabla.

---

## 11. El ingestor

- **Protocolo.** Servidor HTTP en `127.0.0.1:4319` (`node:http`, sin framework) con `POST /v1/traces` y `POST /v1/logs` en OTLP/JSON, que es lo que el Colector envía con `encoding: json`. `POST /v1/metrics` responde 200 y descarta. Devuelve 200 **solo después de confirmar la transacción**: si falla, 503 y el Colector reintenta desde su cola persistente. Al menos una vez más idempotencia da efecto de exactamente una vez.
- **Idempotencia.** Spans por `(trace_id, span_id)`; logs por `demiurgo.event.id` cuando lo llevan y, si no, por huella del registro; textos por huella; todo con `on conflict do nothing` o `do update` según la tabla.
- **Mapeo.** Un módulo por tipo de nota, con el vocabulario importado de `@demiurgo/domain`. Lo que no se sabe mapear va a `unmapped_records` con el motivo, nunca se pierde. Las notas de Claude Code y Codex se reconocen por `service.name` y por los nombres de sus eventos (`claude_code.api_request`, `codex.api_request`, `codex.sse_event`), se unen a la llamada por el id de traza o por `demiurgo.call.id` de los atributos de recurso, y sus spans se guardan en `spans` con `source`.
- **Materialización.** `runs`, `sessions`, `session_uses`, `batches` e `interactions` se rellenan por upsert a medida que llegan los spans que las describen, sin importar el orden.
- **Evaluaciones derivadas.** Reglas puras sobre `commands`: `proposal.accept` sin edición → `human.accepted` (1) sobre la ejecución del lote; con edición → `human.accepted_edited` (0,5); `proposal.reject` → `human.rejected` (0); `question.confirm` sobre una pregunta inferida → `human.inference_confirmed` (1) o corregida (0) sobre la ejecución que la infirió; `run.retry` → `human.retried` (0) sobre la original, con `override` → `human.retried_other_engine`. Se calculan al ingerir y se pueden recalcular con `pnpm evidence derive`.
- **CLI.** `migrate`, `serve`, `replay <ficheros del archivo>`, `derive`, `retention --raw-before YYYY-MM` (solo `provider_events`, `journal_payloads`, `cli_requests` y `unmapped_records`; nunca lo demás; pide confirmación), `check --operational <url>` (compara ejecuciones de la base operativa con `runs` de evidencia y lista las que faltan), `ask <pregunta> [--param valor]`.
- **Particiones.** Al arrancar y cada hora, crea la partición del mes en curso y del siguiente para cada tabla particionada.

---

## 12. Colector, archivo en ficheros, Phoenix y cuadros de mando

Configuración en `packages/evidence/collector/config.yaml`:

- **Receptores:** `otlp` en gRPC 4317 y HTTP 4318, con `max_request_body_size` de 64 MiB para las notas con texto largo.
- **Procesadores:** `memory_limiter`, `batch` (2 s o 512 notas). Para la tubería de Phoenix, `attributes/phoenix` borra `demiurgo.usage.raw` y `transform/phoenix` recorta todo atributo a 64 000 caracteres; los log records no van a Phoenix.
- **Exportadores:** `otlphttp/evidence` (`http://host.docker.internal:4319`, `encoding: json`, cola persistente en `evidence-queue` con `file_storage`, reintentos sin límite de tiempo); `otlp/phoenix` (`phoenix:4317`, solo trazas); `file/archive` (`/archive/otlp-%Y-%m-%d.jsonl`, rotación diaria, gzip, sin borrado). Todo apunta a `localhost` o a la red del compose: nada sale del equipo.
- **Tuberías:** trazas → evidencia, Phoenix, archivo; logs → evidencia, archivo; métricas → archivo (por si alguna CLI las envía).
- **Extensiones:** `file_storage`, `health_check` en 13133.

**Phoenix:** un contenedor con `PHOENIX_SQL_DATABASE_URL` a la base `phoenix` del Postgres de evidencia, autenticación local activada, proyecto por entorno (`real`, `qa`, `dev`). Muestra cada interacción como línea de tiempo con los spans de DEMIURGO y los de Claude Code dentro. Para que enseñe los prompts, el span de la llamada lleva `gen_ai.system_instructions` y `gen_ai.input.messages` recortados (§6.2). Sus evaluaciones y experimentos quedan disponibles para más adelante; no se depende de ellos.

**Metabase (fase 5):** contenedor con su propio volumen, conectado a `demiurgo_evidence` en solo lectura (usuario `evidence_reader`). Un primer cuadro con las preguntas de §15.3. Se elige Metabase y no Grafana porque las preguntas son de negocio y tablas, no series temporales de sistemas; ambas son AGPL y ambas leen Postgres, así que cambiar es barato.

---

## 13. Telemetría nativa de Claude Code y Codex

Lo que las CLI saben contar y nosotros no podemos ver desde fuera: cada petición a la API que hay debajo de una llamada, con sus reintentos, sus tokens de caché exactos y sus tiempos.

| | Claude Code 2.1.283 | Codex CLI 0.156.1 |
|---|---|---|
| Activación | Variables de entorno por llamada (§7.6) | `-c otel.*` por llamada y `OTEL_RESOURCE_ATTRIBUTES` |
| Correlación | Lee `TRACEPARENT`: sus spans cuelgan del nuestro (`parent.source=env`, desde 2.1.268) | No lee `TRACEPARENT` (no verificado): se une por `demiurgo.call.id` en los atributos de recurso |
| Qué llega | Eventos `claude_code.api_request` (`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `cost_usd`, `duration_ms`, `request_id`, `attempt`, `stop_reason`, modelo), `api_error`, `api_retry`; spans `claude_code.interaction` > `llm_request` con `ttft_ms` (beta) | Eventos `codex.api_request` (`attempt`, estado, `duration_ms`), `codex.sse_event` (`input_tokens`, `output_tokens`, `cached_tokens`, `reasoning_tokens`), `codex.conversation_starts`; trazas y logs, no métricas en `exec` |
| Contenido | `user_prompt` sin texto (no se activa `OTEL_LOG_USER_PROMPTS`); ya tenemos la entrada | `log_user_prompt=false`; ya tenemos la entrada |
| Transcripción | `<config>/projects/<cwd codificado>/<session_id>.jsonl` | `$CODEX_HOME/sessions/…/<thread_id>.jsonl` y `session_index.jsonl` |

El ingestor convierte esos eventos en `cli_requests`. Con ellos, `v_session_reuse` deja de estimar: por petición se sabe cuánto vino de caché.

Se mantiene la regla de ADR-AGE-001: **el uso oficial sale de la salida de cada motor, no de su telemetría.** La telemetría nativa se guarda al lado, con su fuente, y se compara. Si difieren, se ve.

---

## 14. Fallos, rendimiento, ciclo de vida, retención, privacidad y versionado

### 14.1 Fallos

- El emisor usa procesadores por lotes con colas acotadas: 4 096 spans y 8 192 logs en memoria, exportación cada 2 s o 512 notas, 10 s de espera por exportación, reintentos del SDK acotados. Si la cola se llena, se descarta y se cuenta; al recuperarse, se emite `demiurgo.observe.dropped` y el logger del API escribe una línea por minuto mientras dure.
- El Colector corre siempre que corre DEMIURGO (mismo equipo, contenedor con `restart: unless-stopped`). Su cola persistente absorbe las caídas del ingestor sin pérdida. El archivo en ficheros es la copia bruta permanente y se puede reproducir con `pnpm evidence replay`.
- El ingestor es idempotente, así que reintentos y reproducciones no duplican.
- `pnpm evidence check` compara la base operativa con la evidencia y lista huecos. Es un script externo: DEMIURGO no lo ejecuta ni lo lee.
- Al parar el API, `observer.flush(5000)` exporta lo pendiente antes de salir.

### 14.2 Rendimiento

- Coste dentro de DEMIURGO: abrir y cerrar spans y encolar logs, del orden de microsegundos por nota; los textos largos se copian una vez a la cola. Las notas más grandes son los eventos crudos y las transcripciones: van en log records, que el SDK trata sin límite de tamaño, y el Colector acepta 64 MiB por petición.
- Volumen estimado con el uso de hoy: cientos de ejecuciones al mes, decenas de miles de notas, menos de 1 GB al año en Postgres con las particiones mensuales. Postgres 18 sobra; ClickHouse queda para cientos de millones de filas (investigación §11).

### 14.3 Ciclo de vida

- La base de evidencia y el archivo viven en el proyecto compose `demiurgo-evidence`, con volúmenes propios. `pnpm snap`, `pnpm db:down -v` y `docker compose down -v` de los otros proyectos no la tocan.
- Tras restaurar una instantánea de DEMIURGO, la evidencia describe ejecuciones que la base operativa ya no conoce. Es lo esperado de una caja negra; `check` las lista como «solo en evidencia».
- Copia de seguridad: `pg_dump` de `demiurgo_evidence` y copia de la carpeta del archivo. Documentado en `docs/observabilidad.md` (fase 5).

### 14.4 Retención

Nada se borra por defecto. Lo grande está particionado por mes para poder soltarlo un día, solo con `pnpm evidence retention`, que solo toca las tablas crudas y pide confirmación. El archivo en ficheros no se borra nunca por programa.

### 14.5 Privacidad

- Todo queda en el equipo. Ningún exportador sale de `localhost` ni de la red del compose.
- Se guarda contenido literal: prompts, contexto, transcripciones. Es el diseño de la persona, en su equipo. Cuando haya otras personas o equipos, la etiqueta de instancia y de proyecto ya está en cada nota; la política de retención y de acceso por inquilino se decidirá entonces, y el Colector es el único punto donde añadir redacción antes de cualquier exportación externa.
- Secretos: el entorno de las CLI ya está filtrado; las notas nunca llevan `result` de comandos ni entorno; los tokens de agente solo aparecen por su id.

### 14.6 Versionado

- `demiurgo.schema_version` empieza en 1 y sube cuando cambia el significado de un atributo o el nombre de una nota. El ingestor acepta todas las versiones pasadas: cada versión tiene su mapeo.
- Los nombres `gen_ai.*` se fijan a la versión del repositorio de convenciones a 09-2026 y se listan en `observe.ts`. Un cambio del estándar se adopta subiendo la versión del vocabulario, nunca a medias.
- Las migraciones de evidencia llevan checksum y nunca se editan, como las del núcleo.

---

## 15. Métricas, evaluación y comparación

### 15.1 Todas las métricas salen del archivo

No hay tubería de métricas aparte. Cada métrica es una vista o una consulta guardada, así siempre se puede explicar de qué filas salió. Phoenix tiene sus propias métricas de trazas para depurar, pero las de negocio son las nuestras.

### 15.2 Evaluaciones

- **De personas, desde el primer día** y sin pedirles nada: aceptar, aceptar con edición, rechazar, confirmar o corregir una inferencia, reintentar, reintentar con otro motor. Las deriva el ingestor de los comandos (§11).
- **De jueces automáticos, después:** cualquier proceso externo puede emitir `gen_ai.evaluation.result` sobre una ejecución o una llamada, con nombre, nota y explicación. Un juez LLM que lea la evidencia y opine es un proceso fuera de la aplicación, con su propio consumo registrado.
- **Del clasificador:** `classifier_evaluations` y `evals/classifier/` siguen donde están; sus resultados se emiten también como evaluaciones para tenerlos en el mismo sitio.

### 15.3 Preguntas de negocio del primer cuadro

| Pregunta | De dónde sale |
|---|---|
| ¿Cuánto cuesta una decisión aprobada, en tokens, en dinero declarado, en tiempo de persona y en ejecuciones? | `v_decision_effort` |
| ¿Cuánto tarda DEMIURGO en responder y dónde se va el tiempo? | `v_interaction_summary` |
| ¿Qué porcentaje del contexto se reutiliza de caché por proveedor y qué sesiones se pierden? | `v_session_reuse` |
| ¿Qué motor da más propuestas aceptadas sin edición por token gastado? | `v_tokens_by_engine` con `evaluations` |
| ¿Cuántas intervenciones pide cada decisión y cuántas preguntas quedan sin responder? | `commands` y `v_decision_effort` |
| ¿Cuánto presupuesto de contexto se llena y cuánto se descarta por sección? | `v_context_budget` |
| ¿Qué falla, cuánto y en qué motor? | `v_engine_reliability` |

### 15.4 Comparación entre motores

Misma pregunta, varios motores: la evidencia permite comparar ejecuciones con el mismo `pack_hash` y distinto motor, que es justo lo que produce «Retry with…». Un banco de repeticiones (relanzar packs guardados en varios motores) es un proceso externo futuro; el modelo ya lo admite porque cada ejecución lleva su pack y su motor.

---

## 16. Pruebas

- **Dominio (unit):** vocabulario estable (una prueba congela los nombres por versión); `normalizeUsage` con los fixtures reales de Claude, Codex y OpenCode, incluidas las ausencias (`not_reported` no es cero); `selectForContext` con `considered`; construcción del manifiesto a partir de candidatos.
- **Núcleo (integration, con `memoryObserver`):**
  - un mensaje de una persona produce una sola traza con la raíz del API, los comandos, los pasos del flujo de respuesta y de la ejecución, la llamada al proveedor simulado, sus eventos, los textos y el manifiesto, todos con el mismo `trace_id`, y `events.cause.correlation` igual a ese id;
  - una ejecución reanudada lleva sesión nuestra, base, delta y textos del delta; el plan B deja dos llamadas con `attempt` 1 y 2;
  - un reintento es otra interacción con enlace a la original;
  - una aceptación dispara una actualización de conocimiento que hereda la interacción de la aceptación;
  - `trace_contexts` recibe una fila por entidad creada; un paso reanudado tras reinicio (prueba de durabilidad existente) cuelga del mismo padre;
  - `DEMIURGO_OBSERVE=off` no emite nada y no escribe `trace_contexts`;
  - el entorno del hijo de Claude lleva `TRACEPARENT` y las `OTEL_*` por llamada y ninguna del entorno del padre; Codex recibe `-c otel.*`;
  - el hash del prompt del clasificador coincide con el system enviado;
  - `evaluate-classifier` deja llamadas.
- **Evidencia (integration, base efímera `dmg_t_*` en el Postgres de pruebas):** ingestión de fixtures OTLP/JSON grabados con `memoryObserver` (serializados con el mismo transformador que usa el exportador) y de fixtures reales de Claude Code y Codex; idempotencia al reproducir dos veces; `unmapped_records` con una nota desconocida; materialización de `runs`, `sessions`, `session_uses`; evaluaciones derivadas; creación de particiones; `retention` no toca tablas no crudas; `check` contra una base operativa efímera; las vistas devuelven lo esperado con un juego de datos conocido.
- **Invariantes:** todo constructor devuelve manifiesto y respeta presupuestos; `trace_contexts` es append-only y lleva `project_id`; ningún span lleva `result`.
- **Extremo a extremo:** Playwright no cambia (`DEMIURGO_OBSERVE=off` en la instancia 8310). Comprobación manual en 8100: `pnpm evidence:up`, un mensaje en un hilo, la traza en Phoenix, y `pnpm evidence ask session-reuse`.

Cada AC que salga de esta spec necesita su prueba con el código al principio del título, según `AGENTS.md`. Los códigos se asignan al escribir cada plan.

---

## 17. Fases

Cada fase tiene su plan de implementación (skill `writing-plans`) y se cierra con `pnpm gate:all` en verde. El orden da valor desde la primera.

| Fase | Qué entrega | Hecho cuando |
|---|---|---|
| **1. Identidad y emisor** | Vocabulario en dominio; `Observer` con las tres implementaciones; interacción en el API, la CLI y las raíces del sistema; spans de comandos y correlación heredada; `0013_trace_contexts.sql`; spans de los pasos del motor; span de la llamada con eventos y textos; `details` de los adaptadores; id de sesión decidido por el motor; normalización de tokens; correcciones del clasificador; configuración; `compose.evidence.yaml` con solo el Colector y el archivo en ficheros | Con `DEMIURGO_OBSERVE=otlp` y `pnpm evidence:up`, un mensaje en 8100 deja una traza completa en el archivo en ficheros, y `events.cause.correlation` es el id de la traza |
| **2. Almacén e ingestor** | `packages/evidence`: migraciones, ingestor, CLI (`migrate`, `serve`, `replay`, `check`, `ask`); Postgres de evidencia en el compose; exportador del Colector al ingestor con cola persistente; vistas `v_interaction_summary`, `v_session_reuse`, `v_tokens_by_engine`; `questions/session-reuse.sql` | `pnpm evidence ask session-reuse --run <id>` responde con datos reales de 8100 si la ejecución reanudó, desde qué base, con qué delta y qué proporción de caché |
| **3. Manifiesto y linaje** | Constructores con manifiesto; `selectForContext` con `considered`; nota `demiurgo.context.manifest`; tablas `context_manifests` y `context_fragments`; `v_context_budget`; `questions/context-of-run.sql` y `context-diff.sql` | Para cualquier ejecución se lista cada fragmento con su origen y su decisión, y lo descartado por presupuesto |
| **4. Telemetría de las CLI y visor** | Entorno OTel para Claude Code y `-c otel.*` para Codex; `cli_requests`; captura de transcripciones; Phoenix en el compose con atributos de contenido; verificaciones de §18 resueltas | En Phoenix, una interacción muestra dentro de la llamada las peticiones a la API de Claude con sus tokens de caché; `v_session_reuse` usa cifras por petición |
| **5. Explotación** | Evaluaciones derivadas; `v_decision_effort`, `v_engine_reliability`; Metabase con el primer cuadro (§15.3); `pnpm evidence derive`, `retention`; `docs/observabilidad.md` (cómo arrancar, cómo preguntar, cómo copiar) | El cuadro responde las siete preguntas de §15.3 con los datos de 8100 |

Dependencias: 2 necesita 1; 3 y 4 necesitan 2 y son independientes entre sí; 5 necesita 3 y 4.

---

## 18. Riesgos y verificaciones pendientes

| Riesgo o duda | Qué se hace |
|---|---|
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` podría anular la exportación OTel configurada por nosotros | Verificar en la fase 4 con una llamada real, mirando el Colector. Si la anula, sustituirla por las variables individuales que desactivan actualizaciones y reportes sin tocar OTel |
| Codex no lee `TRACEPARENT` (no verificado) | El diseño no depende de ello: se une por `demiurgo.call.id`. Verificar en la fase 4; si lo lee, mejor |
| Codex podría no admitir `-c otel.exporter` con tablas anidadas desde la línea de órdenes | `-c` acepta TOML en línea: `-c 'otel={ exporter = { "otlp-http" = { endpoint = "…" } } }'`. Si tampoco, un perfil `--profile` en un fichero de configuración adicional; `CODEX_HOME` no se toca porque guarda el login. Verificar en la fase 4 |
| Las convenciones GenAI de OpenTelemetry siguen en *Development* y cambian nombres | Nombres en un solo sitio con versión propia; Phoenix y Langfuse aceptan los nombres de 2025 y 2026 |
| Localizar la transcripción de Claude Code depende de cómo codifica el directorio de trabajo | Verificar en la fase 4; si no es estable, se registra al menos ruta y huella del directorio de sesión |
| Phoenix es Elastic License 2.0, no OSI | Es una copia reemplazable: apagarla no pierde nada. Jaeger es la alternativa si la licencia importa |
| DBOS puede repetir el paso `invoke` tras un reinicio, con una llamada más al proveedor | Ya pasa hoy; ahora queda anotado con `demiurgo.step.attempt` y dos llamadas |
| Coste declarado de Claude acumulado por sesión | Se guarda tal cual con esa procedencia y se deriva el coste por llamada por diferencia |
| `otlphttp` con `encoding: json` en la versión fijada del Colector | Comprobar al fijar el digest en la fase 2; si no existe, el ingestor acepta protobuf con `@opentelemetry/otlp-transformer` |
| Notas muy grandes (transcripciones de megabytes) | Log records sin límite en el SDK, 64 MiB en el Colector; trozos por llamada, no la transcripción entera cada vez |

---

## 19. Relación con el diseño anterior

- **Sustituye** la decisión del stack §8 «OTel como apoyo de depuración, no como evidencia» por «OTel como transporte y vocabulario; el archivo propio es la evidencia».
- **Saca de Later** la exportación a OpenTelemetry de FDR-AGE-002 y del spec de agentes §14.
- **Mantiene** ADR-AGE-001: el uso oficial sale de la salida del motor; la telemetría nativa se guarda al lado.
- **Mantiene** el diario como registro de autoridad y de transiciones: la evidencia lo copia, no lo reemplaza.
- **No toca** `design/`, que es referencia histórica. La FDR de este motor, si la persona la quiere, nace dentro de la aplicación, como el resto del rediseño.
- **Resuelve** dos contradicciones señaladas en la exploración: la telemetría del clasificador (hoy llamadas sin enlace) y el hash de prompt del clasificador.
- **Deja escrito** lo que la exploración encontró y esta spec no arregla: `ai_run_logs` sin lector, `agent_sessions` sin historial (la evidencia lo cubre), WebSearch activo frente a «sin herramientas» de AC-AGE-002-06, dev tools activas en la instancia real contra `docs/instantaneas-dev.md`.

---

## 20. Glosario

- **Nota:** cualquier cosa que el emisor manda hacia fuera. En OpenTelemetry, un *span* si tiene principio y fin, o un *log record* si es un hecho o un texto.
- **Traza:** todas las notas de una interacción, unidas por el mismo id.
- **Interacción:** lo que hace una persona, o un agente por token, y todo lo que provoca.
- **OpenTelemetry (OTel):** el estándar de la industria para contar qué pasó, cuándo, cuánto tardó y cuánto costó. OTLP es su formato de envío.
- **Colector:** programa estándar que recibe notas OTLP y las reparte.
- **Ingestor:** nuestro programa que convierte notas en filas del archivo.
- **Base de evidencia:** nuestro archivo, en Postgres, fuera de la aplicación.
- **Phoenix:** visor de trazas de código abierto para aplicaciones con modelos de lenguaje.
- **Manifiesto del contexto:** la lista de fragmentos que un constructor consideró para un context pack, con el origen y la decisión de cada uno.
- **Huella:** el SHA-256 de un texto; identifica contenido, no ocurrencias.
- **Sesión de conversación:** el hilo que una CLI mantiene con su modelo entre llamadas; la reanudación envía solo lo nuevo.
- **Caché de prompt:** el proveedor recuerda el principio de la conversación y cobra mucho menos por releerlo; la lectura de caché es la mejor prueba de que el contexto previo se reutilizó.
