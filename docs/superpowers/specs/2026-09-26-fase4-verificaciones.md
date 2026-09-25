# Fase 4 del motor de observabilidad: verificaciones pendientes de §18

Fecha: 2026-09-26. Complementa `2026-09-26-motor-observabilidad-design.md` (§13, §17 fila 4, §18).

Todo lo que sigue necesita **una llamada real** a Claude Code o a Codex, que gasta cuota de la
suscripción. Por eso no lo ha ejecutado ningún agente: queda aquí, paso a paso, para que lo lances tú
cuando quieras. Lo que no necesitaba llamada real (Phoenix, la codificación de las transcripciones,
las vistas) ya está hecho y probado.

Antes de nada, con la pila de evidencia levantada y el ingestor escuchando:

```powershell
pnpm evidence:up            # crea packages/evidence/.env con secretos locales la primera vez
pnpm evidence serve         # en otra terminal: el ingestor en 127.0.0.1:4319
```

El archivo en ficheros del Colector es el volumen `evidence-archive`; para leerlo desde el equipo:

```powershell
docker compose --env-file packages/evidence/.env -f compose.evidence.yaml exec collector cat /archive/otlp.jsonl | Select-String -Pattern "<texto>"
```

(Como la imagen del Colector no tiene shell, si `exec` falla usa
`docker cp demiurgo-evidence-collector-1:/archive/otlp.jsonl $env:TEMP\otlp.jsonl` y busca en el fichero.)

---

## (a) `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` no anula la exportación OTel

**Duda.** DEMIURGO pasa siempre esa variable al hijo (`packages/core/src/env.ts`, `FIXED_VARIABLES`) para
que no haya actualizaciones ni informes. Si también apagara la telemetría OTel, no llegaría nada del
CLI al Colector y `cli_requests` quedaría vacío.

**Qué ejecutar.** Una sola llamada corta, con exactamente el entorno que DEMIURGO construye por llamada
(`claudeTelemetryEnv` en `packages/core/src/providers/claude.ts` más `FIXED_VARIABLES`), apuntando al
Colector local. En PowerShell:

```powershell
$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1"
$env:CLAUDE_CODE_ENABLE_TELEMETRY = "1"
$env:CLAUDE_CODE_ENHANCED_TELEMETRY_BETA = "1"
$env:OTEL_TRACES_EXPORTER = "otlp"
$env:OTEL_LOGS_EXPORTER = "otlp"
$env:OTEL_METRICS_EXPORTER = "none"
$env:OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf"
$env:OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:4318"
$env:OTEL_RESOURCE_ATTRIBUTES = "demiurgo.call.id=verificacion-a,deployment.environment.name=dev"
$env:TRACEPARENT = "00-0199a2130000700080000000000000aa-00f067aa0ba902b7-01"
claude -p "reply ok" --output-format json --model haiku --no-session-persistence
```

Después, limpia las variables (`Remove-Item Env:OTEL_*`, `Remove-Item Env:TRACEPARENT`, etc.) para que
no las herede nada más.

**Qué mirar.** Espera unos 10 s (el Colector agrupa 2 s y el CLI exporta al salir) y busca en el archivo:

```powershell
docker cp demiurgo-evidence-collector-1:/archive/otlp.jsonl $env:TEMP\otlp.jsonl
Select-String -Path $env:TEMP\otlp.jsonl -Pattern "verificacion-a" | Measure-Object
Select-String -Path $env:TEMP\otlp.jsonl -Pattern "claude_code.api_request"
```

- **Pasa** si aparece al menos una línea con `claude_code.api_request` cuyo recurso lleva
  `demiurgo.call.id=verificacion-a` (y, con la beta, spans `claude_code.interaction` o `llm_request`
  con el `traceId` `0199a2130000700080000000000000aa`, es decir, cuelgan del `TRACEPARENT`).
- **Falla** si no aparece nada con `verificacion-a`. Entonces repite la llamada sin
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`; si así sí llega, la variable anula la exportación y hay
  que sustituirla en `FIXED_VARIABLES` por las individuales que apagan lo no esencial sin tocar OTel:
  `DISABLE_AUTOUPDATER=1`, `DISABLE_ERROR_REPORTING=1`, `DISABLE_BUG_COMMAND=1`,
  `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1` (comprueba los nombres en `claude --help` / la documentación de
  la versión instalada: cambian entre versiones). Y cambia la prueba de
  `packages/core/test/providers-claude.test.ts` que hoy espera `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'`.

También puedes verificarlo desde DEMIURGO: con `DEMIURGO_OBSERVE=otlp` en la instancia 8100, un mensaje
en un hilo cuyo agente use Claude debe dejar filas en `cli_requests` (`pnpm evidence ask cli-requests
--run <id de la ejecución>`), y `v_cli_requests_by_call` debe mostrar `delta_uncached` y
`delta_cache_read` a 0 o casi 0 para esa llamada.

## (b) Codex acepta `-c otel=…` en línea

**Duda.** DEMIURGO pasa la telemetría de Codex como una tabla TOML en línea (`codexOtelConfig` en
`packages/core/src/providers/codex.ts`):

```
-c otel={ exporter = { "otlp-http" = { endpoint = "http://127.0.0.1:4318", protocol = "json" } }, log_user_prompt = false, environment = "dev" }
```

No está verificado que `codex exec` acepte tablas anidadas por `-c`, ni que el nombre de la clave del
exportador sea exactamente `otlp-http` con `protocol = "json"` en la versión instalada (0.156.1 al
escribir esto).

**Qué ejecutar.** Una llamada mínima con el mismo `-c` y el mismo recurso, sin sesión:

```powershell
$env:OTEL_RESOURCE_ATTRIBUTES = "demiurgo.call.id=verificacion-b,deployment.environment.name=dev"
$env:TRACEPARENT = "00-0199a2130000700080000000000000bb-00f067aa0ba902b7-01"
codex exec --json --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules -m gpt-5-codex -c 'otel={ exporter = { "otlp-http" = { endpoint = "http://127.0.0.1:4318", protocol = "json" } }, log_user_prompt = false, environment = "dev" }' "reply ok"
```

(Usa el modelo que tengas asignado en *Models & providers*; `-m` no cambia la verificación.)

**Qué mirar.**

- Si Codex rechaza el `-c` lo dirá en stderr al arrancar («invalid config», «unknown field»…):
  esa es la respuesta de esta verificación y hay que pasar al plan alternativo de abajo.
- Si arranca, tras unos 10 s busca en el archivo `codex.api_request` y `verificacion-b`:

  ```powershell
  docker cp demiurgo-evidence-collector-1:/archive/otlp.jsonl $env:TEMP\otlp.jsonl
  Select-String -Path $env:TEMP\otlp.jsonl -Pattern "codex.api_request"
  Select-String -Path $env:TEMP\otlp.jsonl -Pattern "verificacion-b" | Measure-Object
  ```

  **Pasa** si hay eventos `codex.api_request` (y `codex.sse_event` con `input_tokens`, `cached_tokens`,
  `output_tokens`) cuyo recurso lleva `demiurgo.call.id=verificacion-b`. Fíjate en el nombre exacto de
  los eventos y de sus atributos: `packages/evidence/src/ingest/map/cli.ts` espera `codex.api_request`,
  `codex.sse_event`, `attempt`, `duration_ms`, `input_tokens`, `cached_tokens`, `output_tokens`,
  `reasoning_tokens`. Si difieren, se ajusta el mapeador (nada más).

**Plan alternativo (`--profile`), si `-c` con tablas anidadas no vale.** No se ha añadido código: exige
un fichero de configuración, y `codex` solo lee `$CODEX_HOME/config.toml`, que no se toca porque guarda
el login. La alternativa que mantiene eso intacto es un `CODEX_HOME` propio de DEMIURGO con un
`config.toml` mínimo y el `auth.json` enlazado (o copiado) desde el real:

```toml
# <DEMIURGO data>/codex-home/config.toml
[profiles.demiurgo.otel]
log_user_prompt = false
environment = "dev"
[profiles.demiurgo.otel.exporter."otlp-http"]
endpoint = "http://127.0.0.1:4318"
protocol = "json"
```

y en el adaptador `--profile demiurgo` con `CODEX_HOME` apuntando ahí (`allowedEnv(..., fixed)`), en
vez de `codexOtelConfig`. Antes de implementarlo conviene probar a mano que
`codex exec --profile demiurgo "reply ok"` con ese `CODEX_HOME` sigue encontrando la sesión de ChatGPT.
Si tampoco, la opción menor es `-c otel.log_user_prompt=false -c otel.environment="dev"
-c 'otel.exporter."otlp-http".endpoint="http://127.0.0.1:4318"'` (claves con puntos, una por `-c`), que
algunas versiones aceptan aunque no acepten la tabla entera.

## (c) ¿Codex respeta `TRACEPARENT`?

**Duda.** Si Codex leyera `TRACEPARENT`, sus spans colgarían del nuestro y Phoenix los enseñaría dentro
de la llamada, como los de Claude Code. El diseño no depende de ello: el ingestor une por
`demiurgo.call.id` del recurso.

**Qué ejecutar.** La misma llamada de (b) ya lleva `TRACEPARENT` con el id de traza
`0199a2130000700080000000000000bb`.

**Qué mirar.** En el archivo, en las líneas de `resoureSpans` cuyo recurso lleve `verificacion-b`, el
campo `traceId` de sus spans:

```powershell
Select-String -Path $env:TEMP\otlp.jsonl -Pattern "verificacion-b" | Select-String -Pattern "0199a2130000700080000000000000bb"
```

- **Lo respeta** si sus spans llevan ese `traceId`. Entonces, en Phoenix (http://127.0.0.1:6006,
  proyecto `real` o `dev`), sus spans aparecerán dentro de `invoke_agent <agente>` sin más cambios.
- **No lo respeta** (lo esperado) si llevan otro `traceId`. Se queda como está: `spans.source = 'codex'`
  con su `call_id` resuelto por el recurso, y en Phoenix se ven como una traza aparte del mismo
  proyecto. Anótalo en §13 del diseño como verificado.

Si Codex no emite spans (solo logs), esta verificación no aplica: `cli_requests` se une por el recurso
igualmente.

## (d) Dónde dejan las CLI la transcripción

**Lo determinado** (mirando solo los nombres de carpetas y ficheros del equipo, nunca su contenido):

- **Claude Code**: `<CLAUDE_CONFIG_DIR o ~/.claude>/projects/<cwd codificado>/<session_id>.jsonl`. La
  codificación del directorio de trabajo sustituye **cada carácter que no sea letra o dígito por `-`**,
  conservando mayúsculas: `D:\Dev\Demiurgo` → `D--Dev-Demiurgo` (los dos puntos y la barra dan dos
  guiones seguidos); `D:\Dev\Demiurgo\.claude\worktrees\agent-a1…` →
  `D--Dev-Demiurgo--claude-worktrees-agent-a1…`; la carpeta estable de sesiones de DEMIURGO
  `C:\Users\<usuario>\AppData\Local\Demiurgo\agent-sessions\claude\<16 hex>` →
  `C--Users-<usuario>-AppData-Local-Demiurgo-agent-sessions-claude-<16 hex>`. Junto al `.jsonl` puede
  haber una carpeta con el mismo id (resultados de herramientas); no es la transcripción.
- **Codex**: `<CODEX_HOME o ~/.codex>/sessions/YYYY/MM/DD/rollout-YYYY-MM-DDTHH-MM-SS-<thread_id>.jsonl`,
  con `<thread_id>` el `thread_id` de `thread.started`. Además `<CODEX_HOME>/session_index.jsonl`, una
  línea `{ "id", "thread_name", "updated_at" }` por hilo. DEMIURGO busca el fichero por sufijo
  `-<thread_id>.jsonl` del día más reciente hacia atrás; el índice no hace falta.

Está implementado en `packages/core/src/observe/transcripts.ts` (`encodeClaudeProjectDir`,
`claudeTranscriptPath`, `findClaudeTranscript` con rastreo de `projects/` si la carpeta codificada no
existe, `findCodexTranscript`) y los adaptadores rellenan `details.transcriptPath` cuando el fichero
existe tras la llamada. `callProvider` anota `demiurgo.transcript.path`, `.size` y `.hash` en el span y
emite como texto `transcript_chunk` lo añadido desde la última llamada de esa sesión (con
`demiurgo.session.id` y `demiurgo.transcript.offset` en bytes). El desplazamiento vive en memoria del
proceso: tras un reinicio se reemite desde 0 y el ingestor lo deduplica por `(session_id, offset)`.

**Cómo confirmarlo con una llamada real** (desde DEMIURGO, sin comandos a mano): con
`DEMIURGO_OBSERVE=otlp` en 8100, envía un mensaje en un hilo con agente Claude y otro con agente Codex,
y después:

```powershell
pnpm evidence ask session-reuse --run <id de la ejecución>
docker exec demiurgo-evidence-postgres-1 psql -U evidence -d demiurgo_evidence -c "select call_id, transcript_path, transcript_size from provider_calls where transcript_path is not null order by started_at desc limit 5"
docker exec demiurgo-evidence-postgres-1 psql -U evidence -d demiurgo_evidence -c "select session_id, \"offset\", call_id, chars from transcript_chunks order by at desc limit 10"
```

- **Pasa** si `transcript_path` apunta a un fichero existente con la forma de arriba y
  `transcript_chunks` tiene una fila por llamada, con `offset` creciente dentro de la misma sesión y
  `chars` > 0.
- **Falla** si `transcript_path` es null con una sesión activa: mira si `CLAUDE_CONFIG_DIR` o
  `CODEX_HOME` apuntan a otro sitio en el entorno de la instancia (el adaptador lee esas variables y,
  si no están, `USERPROFILE`), o si la codificación cambió en una versión nueva (entonces el rastreo de
  `projects/` por `<session_id>.jsonl` debería seguir encontrándolo; si ni eso, se registra al menos la
  ruta de la carpeta de sesión y su huella, como prevé §18).

## Phoenix (hecho, sin llamada real)

- Imagen `arizephoenix/phoenix:version-20.16.0`, fijada por digest en `compose.evidence.yaml`, sobre
  la base `phoenix` del Postgres de evidencia, en http://127.0.0.1:6006 (gRPC 4317 solo en la red del
  compose).
- Autenticación activada. Los secretos (`PHOENIX_SECRET`, `PHOENIX_SYSTEM_KEY`, `PHOENIX_ADMIN_PASSWORD`)
  los genera `pnpm evidence:up` en `packages/evidence/.env` (ignorado por git; plantilla en
  `.env.example`). Entrada: `admin@localhost` con `PHOENIX_ADMIN_PASSWORD` del `.env`. El Colector
  ingiere con el secreto de administración como *bearer* (`${env:PHOENIX_SYSTEM_KEY}` en
  `collector/config.yaml`): comprobado con una traza de humo, que apareció en el proyecto `dev`.
- Un proyecto por entorno: el procesador `resource/phoenix` copia `deployment.environment.name` en
  `openinference.project.name`.
- Comprobación pendiente con datos reales: en Phoenix, una interacción de 8100 debe mostrar dentro de
  `invoke_agent <agente>` los spans `claude_code.interaction` / `llm_request` (tras pasar (a)).
