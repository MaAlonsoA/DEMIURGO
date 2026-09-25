# DEMIURGO v2: reglas para agentes

DEMIURGO guía el desarrollo con IA de principio a fin con dos pilares: diseñar (de la intención a «Listo para construir») y construir de forma gobernada. El plan está en `docs/plan-reimplementacion-2026-09-24.md` y el stack en `docs/investigacion-stack-2026-09-24.md`.

## Reglas de fondo

- **El modelo propone, el sistema dispone y la persona decide.** Ninguna salida de IA cambia un estado de autoridad. Nunca aceptes automáticamente una propuesta de IA ni conviertas una hipótesis en algo aprobado.
- **El actor lo fija el servidor** según la credencial o el canal: `human:<persona>` (cookie de sesión), `agent:<nombre>:<sesión>` (token de agente), `agent:run:<id>` (ejecuciones) y `system:<componente>@<versión>`. El cliente nunca declara su actor.
- **Todo cambio de estado sale de las tablas de datos** (`design/data/`): lo que no está en la matriz de capacidades da 403 y lo que no está en la tabla de transiciones da 409, en ambos casos sin efectos.
- **El diario (`events`) solo admite INSERT.** Cada mutación deja su evento en la misma transacción.
- **Idioma.** El código va **en inglés**: identificadores, comentarios, pruebas, API, textos de producto, mensajes de error y prompts de los agentes. La documentación (`docs/`, `AGENTS.md`, `CLAUDE.md`), la prosa de los documentos de `design/`, los commits y la conversación van **en español**.

## Entorno

- La v1 está descartada. Solo se consulta como catálogo de lecciones con `git show v1-referencia:<ruta>`. No la arregles ni la reutilices.
- **Prohibido tocar** el proyecto compose `demiurgo-stable`, `%LOCALAPPDATA%\Demiurgo\stable` y el puerto 8000 (son de la v1).
- Postgres de desarrollo: proyecto compose `demiurgo-v2-dev`, puerto 55432. Las pruebas crean bases efímeras; nunca apuntes una prueba a una base en uso.
- **Desde el 25-09-2026, D0 queda fuera y H1 no muda ficheros:** los documentos de `design/` son referencia histórica de lo construido en S0–S2 (no se aceptan, no se importan y no se exportan encima). DEMIURGO se diseña a mano, paso a paso, dentro de la propia aplicación. H1 no se cierra hasta que todos sus documentos se han creado uno a uno dentro de la aplicación y la FDR de S3 nace y se aprueba allí. `design/data/` (tablas como datos) sigue siendo fuente del código.

## Cómo trabajar

- TDD: cada AC automático de `design/` tiene al menos una prueba que pasa y cuyo título empieza por su código (`AC-ESQ-001-01 …`). `pnpm gate:traceability` lo comprueba con los informes JUnit.
- Cierra cada cambio con `pnpm gate:all` en verde.
- Commits pequeños con la skill `commit`. No hagas push ni merge en `main`.
