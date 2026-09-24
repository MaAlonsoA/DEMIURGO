# DEMIURGO mínimo

Aplicación local para explorar productos por proyectos. Cada proyecto empieza con una sección **Exploración inicial**, que conserva su propia conversación y preguntas. Codex CLI usa `gpt-6-sol` con esfuerzo `high` para la visión inicial, las respuestas dentro de preguntas, el análisis de fuentes y el cierre de rondas; la conversación general posterior usa `gpt-6-luna` con esfuerzo `medium`.

## Arranque

Desde la raíz del repositorio:

```powershell
python -m pip install -r requirements.txt
cd frontend
npm.cmd install
npm.cmd run build
cd ..
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Abrir <http://127.0.0.1:8000>. El backend aplica las migraciones de Alembic al iniciar y sirve la interfaz compilada. La base de datos se guarda en `demiurgo.db`; `DEMIURGO_DB` permite elegir otra ruta antes de arrancar.

La integración usa la autenticación ya configurada en `codex` CLI. Si el CLI no está disponible, siguen funcionando la conversación guardada, la edición manual, la revisión de propuestas de importación y el resto del espacio. Las ejecuciones de Codex tienen un límite de 240 segundos para análisis estratégicos y 120 segundos para las demás, con estado visible, cancelación y reintento. Codex trabaja desde un directorio temporal con sandbox de solo lectura y produce JSON validado antes de crear propuestas; no aplica cambios aceptados ni recibe la ruta de SQLite. El backend es quien escribe la base de datos.

## Recorrido actual

1. Crea un proyecto con un nombre reconocible. DEMIURGO crea dentro de él una sección **Exploración inicial**.
2. Describe la idea general en la conversación. El mensaje se guarda antes del análisis; si Codex no responde, puedes reintentar sin perderlo.
3. Añade preguntas para mantener visibles las dudas importantes. Conversaciones y preguntas pertenecen a la exploración del proyecto seleccionado.

Las respuestas de una pregunta pueden proponer líneas de exploración. Al cerrar una ronda, DEMIURGO revisa sus respuestas y propone líneas justificadas. La persona acepta o descarta cada propuesta desde la bandeja lateral; las líneas aceptadas aparecen bajo el proyecto.

Al abrir una exploración o pregunta, la interfaz muestra su procedencia, el motivo y las conclusiones confirmadas relacionadas. Las propuestas de nuevas líneas enseñan la ronda y las respuestas de las que nacen antes de aceptarlas. La revisión de ronda comprueba que las líneas cubran la capacidad principal confirmada y señala cambios o ambigüedades de alcance sin convertirlos en acuerdos.
Las rondas analizadas con un método anterior pueden revisarse otra vez desde su tarjeta de ronda; las líneas aceptadas y las propuestas aún pendientes se pasan como contexto para evitar duplicados. Cualquier propuesta nueva sigue pendiente de aceptación humana.

## Ejecuciones de IA

Cada análisis de chat, tarjeta, ronda o fuente tiene un `run_id` y una traza OpenTelemetry local. El botón **Ejecuciones** de cada proyecto y los enlaces junto a mensajes y rondas muestran el prompt enviado, resultado, eventos de Codex, uso reportado y tiempos medidos. La API ofrece `GET /api/projects/{id}/runs`, `GET /api/sources/{id}/runs`, `GET /api/runs/{id}` y `GET /api/runs/{id}/events`; las listas son paginadas y `/api/state` conserva solo resúmenes.

`input_tokens` incluye `cached_input_tokens`; `output_tokens` incluye `reasoning_output_tokens`. El número de llamadas internas al modelo queda en `null` si Codex no lo informa. Los registros anteriores a esta migración muestran prompt y métricas como no disponibles. Las trazas y eventos permanecen en la base activa hasta borrar su proyecto o la fuente huérfana; las copias de seguridad anteriores conservan su contenido.

## Copias y exportación

**Crear copia** produce un archivo `demiurgo-backup-*.db` mediante la API de copia consistente de SQLite. Para restaurarlo, detener el servidor y ejecutar:

```powershell
python -m app.restore .\demiurgo-backup-FECHA.db
```

Se puede indicar `--target` para restaurar en otra ruta. El comando comprueba la integridad de la copia antes de escribir el destino.

**Exportar todo** descarga JSON con historiales, mensajes, propuestas, relaciones, trabajo y evidencias. **Exportar Markdown** genera una lectura completa del espacio. **Exportar contexto** descarga conocimiento reutilizable con fuentes, conversaciones, revisiones y relaciones; al importarlo en otro espacio no se crean tareas, Change Sets ni evidencias, y las revisiones de diseño importadas empiezan como borradores. `VISION.md` no se modifica al importar ni exportar.

## Comprobación

```powershell
python -m pytest -q
cd frontend
npm.cmd run build
npm.cmd run test:e2e
```

La prueba E2E usa Chrome local en modo sin interfaz, una base temporal y un backend separado. Si Chrome está en otra ruta, definir `CHROME_PATH`. Para comprobar además la integración real con la autenticación local de Codex CLI, ejecutar `npm.cmd run test:e2e:codex`; esa prueba llama al servicio de Codex.

`npm.cmd run test:e2e:source` comprueba el análisis real de `VISION.md` en otra base temporal. Las dos pruebas con Codex requieren acceso a su autenticación local y pueden consumir uso del servicio.

Las pruebas cubren importación idempotente, revisión de propuestas, versiones y trazabilidad, reglas de cobertura, evidencia para verificar un resultado, fallo de Codex con mensajes persistentes, copia y restauración, transferencia de contexto sin trabajo heredado y un recorrido completo de navegador.

La jerarquía de trabajo es **Proyecto → Exploraciones → Decisiones → Diseños (ADR y FDR) → Implementación → Revisión**. Un proyecto contiene varias exploraciones; una exploración contiene sus decisiones y diseños. Los ADR y FDR se vinculan a la decisión que justifican. Desde una respuesta o un artefacto se puede abrir una nueva exploración. Esta etapa permite diseñar el MVP hasta los artefactos de Diseño; Implementación y Revisión aparecen en el ciclo, pero todavía no ejecutan trabajo.

## Docker y releases

La operación de la instancia estable se describe en [la guía de despliegue](docs/development-and-releases.md). La app se publica solo en `127.0.0.1:8000` y guarda datos y autenticación fuera del repositorio.
