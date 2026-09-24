# S1 · Recorrido real de la intención a «Listo para construir»

Fecha: 2026-09-24, 13:40 UTC. Cumple AC-DIS-001-17 (manual): ejecución real registrada de S1. Salida completa en [s1-recorrido-2026-09-24.json](s1-recorrido-2026-09-24.json).

## Cómo se lanzó

Servidor de la v2 en `127.0.0.1:8100` con el agente real (`DEMIURGO_AGENTE=claude`, modelo `haiku`) sobre la base dedicada `demiurgo_v2_ejecuciones_reales`, y el script reproducible `packages/api/src/herramientas/recorrido-s1.ts`, que actúa como la persona por la API (cookie de sesión + CSRF):

```powershell
node packages/api/src/cli.ts crear-persona operador        # clave por la entrada estándar
node packages/api/src/main.ts                              # en otra consola
Get-Content clave.txt | node packages/api/src/herramientas/recorrido-s1.ts http://127.0.0.1:8100 operador `
  "Una app para que una asociación gestione a sus socios" `
  "Quiero que cada socio pueda darse de alta él mismo con su nombre, su correo y la fecha de alta, y que la junta vea la lista de socios activos." `
  "Decidimos: el alta es inmediata, sin validación previa de la junta; la baja la puede hacer el propio socio o la junta; por ahora no se envían correos. Regístralo como decisión."
```

## Qué pasó

| Paso | Actor | Resultado |
|---|---|---|
| 1. Mensaje con la intención | persona | `exploration_chat` real: respuesta con 3 preguntas de alto impacto (validación del alta, qué es «activo», tamaño) y 2 propuestas de exploración. **No propuso una decisión**: la persona aún no había elegido |
| 2. Mensaje con la elección | persona | `exploration_chat` real: propuesta de decisión «Flujo de registro y baja de socios» más dos exploraciones |
| 3. «Aceptar y aprobar» la decisión | persona | DEC-PRO-001 v1 aprobada |
| 4. `design_proposal` | persona pide; agente propone | Paquete con la FDR «Flujo de registro y baja de socios sin validación previa» y **6 criterios** Dado/cuando/entonces (3 automáticos, 3 manuales) |
| 5. Aceptar el paquete y aprobar la FDR | persona | FDR-PRO-001 v1 aprobada. Readiness: **no lista**: «Hay 5 pregunta(s) pendiente(s) en la exploración de origen» |
| 6. Cierre | persona | Descarta las 6 preguntas («Resuelta por la decisión DEC-PRO-001») y rechaza las 2 exploraciones sobrantes |
| 7. Readiness | — | **Listo para construir**, bandeja vacía |

## Consumo

| Ejecución | Duración | Tokens (entrada / salida) | Coste declarado |
|---|---|---|---|
| exploration_chat 1 | 11,6 s | 2579 / 1265 | 0,0089 USD |
| exploration_chat 2 | 22,4 s | 3632 / 2231 | 0,0148 USD |
| design_proposal | 25,5 s | 2251 / 2720 | 0,0159 USD |
| **Total** | 59,5 s | 8462 / 6216 | **0,0395 USD** (suscripción) |

Todas las salidas cumplieron el esquema a la primera (ningún `invalid_output`). Hubo dos ensayos previos del mismo recorrido (a las 13:34 y a las 13:37) con el mismo resultado de fondo; en el primero, el script no preveía un segundo mensaje y se detuvo tras el primer turno.

## Observaciones

- El gate de readiness hizo su trabajo: con la FDR aprobada seguía «no lista» mientras quedaban preguntas abiertas en la exploración de origen. Solo una acción explícita de la persona la dejó lista.
- El agente real es prudente: pregunta antes de proponer una decisión y propone exploraciones para las líneas nuevas. Eso llena la bandeja; en S6 el tope de preguntas y la política de atención lo limitarán.
- La latencia del agente (12–25 s por turno con Haiku) está dominada por el razonamiento del modelo, no por el arranque de la CLI.
