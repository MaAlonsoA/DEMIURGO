# Encargo autónomo: v2 lista para H1 (solo back)

> Instrucciones completas para la sesión autónoma del 24-09-2026. El objetivo corto de `/goal` remite a este fichero.

Trabaja de forma autónoma, sin preguntarme nada, hasta dejar la v2 de DEMIURGO lista para el Hito 1 (H1), solo back. Estaré fuera varias horas. No te detengas por dudas: decide con la opción recomendada en los documentos, anótala como decisión pendiente de mi revisión y sigue.

## Contexto (léelo antes de empezar)
- `docs/plan-reimplementacion-2026-09-24.md`: el plan completo. Manda §2 (principios), §4 (modelo e invariantes I1–I10), §5 (D0–S2 y H1 con sus criterios de salida), §6 (arranque) y §7 (motor de contexto y Jev).
- `docs/investigacion-stack-2026-09-24.md`: el stack. TypeScript estricto, monorepo pnpm, PostgreSQL 18, Kysely, DBOS Transact, Fastify, Zod 4 → OpenAPI, Vitest, fast-check y servidor MCP.
- `docs/analisis-vision-mvp-2026-09-24.md`: la auditoría de la v1 (qué no repetir).
- La v1 (FastAPI + sqlite, commit `bf8a9cd`) está descartada. Solo es un catálogo de lecciones. No la arregles ni la reutilices. `CLAUDE.md` y `AGENTS.md` describen la v1: en la rama de la v2 sustitúyelos por versiones para la v2. Se mantienen las reglas de fondo: textos en español, aceptación solo humana y nunca aceptar automáticamente una propuesta de IA.
- Visión original, útil para el motor de contexto: `D:\Dev\Demiurgo-archive-2026-09-23\docs\product`.

## Alcance
1. **D0.** Crear `design/` con formato fijo:
   - frontmatter con código, versión y estado; AC con ID y verificación;
   - validador ejecutable en la CI;
   - ADR de stack y ADR del runner con su spike;
   - ADR de agentes por CLI;
   - ADR del clasificador;
   - FDR con AC verificables para S0, S1, S2 y H1;
   - taxonomía inicial;
   - la matriz de capacidades y las tablas de transiciones como datos.
   Todo queda en estado «propuesto»: la aprobación es mía.
2. **S0.** Esqueleto técnico según §5:
   - comando → capacidad → tabla → evento;
   - diario protegido contra UPDATE y DELETE;
   - migraciones;
   - motor durable (reanudar tras matar el proceso, con el efecto una sola vez);
   - puerto de agentes con simulador determinista y un adaptador real;
   - runner aislado con sonda;
   - 403 y 409 generados desde la matriz;
   - salida inválida → `invalid_output` sin efectos.
   **Sin UI.**
3. **S1.** De la intención a «Listo para construir», con canal de agentes (API con token y servidor MCP: leer, conversar con su nombre, registrar fuentes y proponer). La aceptación humana se hace por la API con la credencial humana (cookie de sesión) en lugar de la UI. Todo comando decisivo con actor no humano → 403.
4. **S2.** Conocimiento y contexto:
   - grafo en Postgres detrás de `KnowledgeGraph`;
   - `Classifier`;
   - paso «Actualizar conocimiento» verificado (§7.3);
   - invalidar en lugar de borrar;
   - gate de frescura;
   - evaluación de ideas;
   - context packs con hash;
   - importador idempotente de `design/`;
   - reconstrucción con la misma huella;
   - conjunto de evaluación del clasificador con precisión y cobertura registradas.
5. **Preparación de H1.** Importar `design/` como lote pendiente, ratificar en un paso (comando humano) y exportar `design/` sin diff. **No ratifiques tú:** la ratificación la hago yo al volver.

Fuera de alcance: frontend (lo decidiremos en Claude Design), S3 en adelante y Jev real.

## Entorno verificado
- Windows 11, PowerShell (`npm.cmd`) y Git Bash. Node 24.21: el stack pedía 26; usa 24 y regístralo en el ADR.
- pnpm no está instalado: usa `corepack` y fija `packageManager`.
- Docker Desktop 29.8 funcionando. Postgres 18 en Docker con un proyecto compose propio (p. ej. `demiurgo-v2-dev`) y un puerto libre (p. ej. 55432). Las pruebas usan bases efímeras, nunca una en uso.
- Prohibido tocar `demiurgo-stable`, `%LOCALAPPDATA%\Demiurgo\stable` y el puerto 8000 de la v1.
- `claude` (2.1.281) y `codex` (0.156.1) están autenticados por suscripción en esta máquina, sin API keys. Los adaptadores reales usan la CLI (`claude -p` con salida JSON o stream-json y schema; `codex exec --json --output-schema`), no el SDK con API key.
- Las acciones de IA de S1 y S2 solo producen propuestas: ejecútalas en un directorio temporal sin herramientas de escritura ni acceso a datos, y documenta la frontera en el ADR del runner.
- **Jev aún no está disponible.** `Classifier` lleva:
  - un simulador determinista para las pruebas;
  - un adaptador de referencia sobre `claude -p` con salida estructurada;
  - un adaptador de Jev vacío, con la interfaz de §7.5 (Choice, Score, Noul, confianza y cascada por umbrales).
- Versiones: las del stack son de septiembre de 2026. Compruébalas en el registro npm antes de fijarlas (versiones exactas). Si una no existe o falla, usa la más cercana estable y anótalo. Si DBOS da problemas serios en el spike, documenta la alternativa y sigue.

## Reglas de trabajo
- Crea la etiqueta local `v1-referencia` sobre `bf8a9cd` y la rama `v2` desde `main`.
- En `v2`, primero haz commit de los tres documentos sin seguimiento de `docs/` (plan, stack y este encargo). Después elimina el código de la v1 de la rama; se consulta con `git show v1-referencia:<ruta>`.
- Haz commits pequeños y coherentes con la skill `commit`. **No hagas push ni fusiones en `main`.**
- TDD: cada AC tiene una prueba cuyo nombre lleva el código del AC. Cada incremento termina con `pnpm gate:all` en verde en local: tipos, lint, pruebas, validador de `design/` e invariantes. Escribe también el workflow de GitHub Actions equivalente, aunque no se ejecute.
- Al cerrar cada incremento, lanza un subagente revisor independiente. Debe intentar refutar cada criterio de salida contra el código y las pruebas. Corrige lo que encuentre antes de pasar al siguiente. Puedes usar workflows y subagentes cuando aporten.
- Ejecuciones reales de agentes: las mínimas para cumplir «una ejecución real registrada» por incremento, con Claude. Codex solo si es imprescindible (consume cuota).
- Nunca envíes mi email a ningún servicio. No guardes secretos en el repo.
- Si algo solo lo puedo decidir yo, anótalo, aplica la recomendación y continúa. Si algo bloquea de verdad, déjalo documentado y avanza en lo que no dependa de ello.

## Condición de fin
Termina cuando se cumpla todo esto, o cuando no puedas avanzar más:
- D0, S0, S1 y S2 cumplen sus criterios de salida de §5, o cada excepción está documentada con su motivo.
- La importación de H1 genera el lote pendiente y la exportación coincide sin diff.
- `pnpm gate:all` está en verde en la rama `v2`.
- Existe `docs/informe-autonomo-v2-h1.md` con:
  - el estado de cada AC (verde, rojo o no implementado);
  - las desviaciones del plan;
  - las decisiones tomadas en mi nombre, pendientes de revisión;
  - las ejecuciones reales y su resultado;
  - cómo arrancar y probar todo;
  - qué necesita el frontend para la sesión con Claude Design: pantallas, estados e invariantes que la UI debe hacer visibles;
  - los siguientes pasos (ratificar H1, conectar Jev).
