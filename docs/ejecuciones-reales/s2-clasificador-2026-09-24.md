# S2 · Evaluación real del clasificador de referencia

Fecha: 2026-09-24, 14:06 UTC. Cumple AC-CON-001-16 (manual): ejecución real de S2 registrada. Resultado completo (respuestas, matrices de confusión y curvas) en [`evals/clasificador/resultados/referencia-claude_1-prueba-2026-09-24-14-08-56.json`](../../evals/clasificador/resultados/referencia-claude_1-prueba-2026-09-24-14-08-56.json); las métricas también quedaron en la tabla `classifier_evaluations` de la base `demiurgo_v2_ejecuciones_reales`.

## Cómo se lanzó

```powershell
$env:DEMIURGO_DATABASE_URL = 'postgres://demiurgo:demiurgo-dev@127.0.0.1:55432/demiurgo_v2_ejecuciones_reales'
$env:DEMIURGO_CLASIFICADOR = 'referencia'; $env:DEMIURGO_MODELO_CLASIFICADOR = 'haiku'
node packages/api/src/cli.ts evaluar-clasificador prueba
```

Clasificador `referencia-claude@1` (Claude Haiku por `claude -p` con `--json-schema`, sin herramientas ni MCP), partición **prueba** del conjunto `evals/clasificador/v1` (35 pares cambio–candidato y 22 pares idea–nodo). Dos llamadas a la CLI (una por tarea) en 186 s en total.

## Resultados frente a la línea base

| Tarea | Clasificador | Exactitud | Precisión macro | Cobertura macro | F1 macro |
|---|---|---|---|---|---|
| Veredictos (6 clases) | referencia-claude@1 | **62,9 %** (22/35) | 51,9 % | 55,5 % | 52,6 % |
| Veredictos | simulado@1 (reglas léxicas) | 31,4 % (11/35) | — | — | — |
| Hallazgos de ideas (5 clases) | referencia-claude@1 | **81,8 %** (18/22) | 69,2 % | 80,0 % | 73,6 % |
| Hallazgos de ideas | simulado@1 | 50,0 % (11/22) | — | — | — |

Por clase (referencia, veredictos): `invalidate` 78 % de precisión y 100 % de cobertura; `keep` 67 % / 86 %; `update` 50 % / 50 %; `relate` 50 % / 57 %; `add` 67 % / 40 %; `other` 0 % / 0 %. En ideas: `duplicates` y `none` 100 % / 100 %, `conflicts` 83 % / 100 %, `relates` 63 % / 100 % e `inconsistent` 0 % / 0 %.

Curva de la cascada (veredictos): con confianza ≥ 0,8 (umbral «aplicar»), el 83 % de los casos (29/35) y 69 % de exactitud; con ≥ 0,9, el 51 % y 78 %. En ideas, con ≥ 0,8, el 68 % de los casos y 93 % de exactitud.

## Lectura

- El error caro del §8 del stack (invalidar cuando tocaba mantener) no aparece: todos los `invalidate` esperados se detectan y los falsos `invalidate` son de casos `other`. De todos modos, un `invalidate` sobre algo con autoridad nunca se aplica: sale como propuesta para la persona.
- Las clases difusas (`add` frente a `update`, `other`, `inconsistent`) son las peores; coinciden con las etiquetas dudosas que el propio conjunto señala. Con 3 a 7 casos por clase y partición, las cifras tienen mucha varianza.
- El umbral «aplicar» de 0,8 no garantiza la exactitud en veredictos: hay que calibrarlo con datos reales antes de aplicar relaciones con confianza alta sin revisión (hoy solo `relate` se aplica solo; el resto va a la persona).
- El ejecutor aún no registra tokens ni coste del adaptador de referencia (pendiente); la duración sí.
