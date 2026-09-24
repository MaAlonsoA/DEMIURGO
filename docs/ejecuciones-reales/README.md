# Ejecuciones reales registradas

Cada incremento termina con al menos una ejecución real de un agente, con Claude por CLI y la suscripción de la máquina (ADR-AGE-001). Esta tabla las recoge; los detalles están en los archivos enlazados.

| Incremento | Fecha | Qué | Proveedor y modelo | Resultado | Duración | Tokens (entrada / salida) | Coste declarado | Detalle |
|---|---|---|---|---|---|---|---|---|
| D0 (spike DBOS) | 2026-09-24 | Flujo DBOS de 3 pasos con el proceso muerto durante el paso 2 (sin modelo) | dbos · 4.27.6 | Recuperado: paso1=1, paso2=2, paso3=1 | 8,9 s | — | — | [spike-dbos-2026-09-24.md](spike-dbos-2026-09-24.md) |
| S0 (fixtures) | 2026-09-24 | 3 llamadas directas a la CLI para grabar fixtures del adaptador | claude-cli · haiku | 1 error esperado (modelo inexistente), 2 correctas | 0,7 s · 3,6 s · 17,3 s | 0/0 · 1500/287 · 2278/2143 | 0,0159 USD en total | [fixtures-claude-cli-2026-09-24.md](fixtures-claude-cli-2026-09-24.md) |
| S0 | 2026-09-24 | Acción `eco` a través del bus y del motor durable (`run.request` → flujo DBOS → `run.complete`) | claude-cli · claude-haiku-4-5-20251001 | `completed`, salida válida con el esquema | 3,9 s (4,2 s de flujo) | 1489 / 308 | 0,0030 USD | [s0-eco-2026-09-24.md](s0-eco-2026-09-24.md) |
| S0 (sonda) | 2026-09-24 | Sonda del runner aislado (sin modelo) | docker · node:24.21-alpine | 0 violaciones | 5,4 s | — | — | [sonda-runner-2026-09-24.md](sonda-runner-2026-09-24.md) |
| S1 | 2026-09-24 | Recorrido completo por la API: dos turnos de `exploration_chat`, «Aceptar y aprobar», `design_proposal`, aceptación del paquete, aprobación y cierre de la persona | claude-cli · claude-haiku-4-5-20251001 | «Listo para construir» (FDR-PRO-001 con 6 AC) y bandeja vacía | 59,5 s de agente | 8462 / 6216 | 0,0395 USD | [s1-recorrido-2026-09-24.md](s1-recorrido-2026-09-24.md) |
| S2 | 2026-09-24 | Evaluación del clasificador de referencia sobre la partición de prueba (35 veredictos y 22 ideas) | claude-cli · haiku | Veredictos 62,9 % de exactitud; ideas 81,8 % (línea base simulada: 31,4 % y 50 %) | 186 s (2 llamadas) | no registrado | no registrado | [s2-clasificador-2026-09-24.md](s2-clasificador-2026-09-24.md) |
