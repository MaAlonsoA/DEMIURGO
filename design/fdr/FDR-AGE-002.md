---
code: FDR-AGE-002
type: fdr
title: Agentes y proveedores
version: 1
state: proposed
domain: plataforma
links:
  - type: based_on
    target: ADR-AGE-001@2
annexes: []
---

# FDR-AGE-002 · Agentes y proveedores

## Goal

Cada tarea de DEMIURGO la ejecuta un agente propio sobre el motor que la persona elige. Un agente es un AGENT.md más sus skills. El motor puede ser Claude (`claude -p`), Codex (`codex exec`) o los modelos locales configurados en OpenCode, como Qwen.

Todo es determinista salvo la respuesta del modelo:
- cada sección de la web recoge su contexto, compone el prompt con su agente y lo manda al motor asignado;
- la salida tiene un esquema fijo y siempre se valida;
- la ejecución deja eventos, métricas y consumo.

El detalle está en `docs/superpowers/specs/2026-09-25-agentes-y-proveedores-design.md`.

## Scope

- **Agentes y skills:**
  - ficheros del repo con su huella;
  - agentes iniciales: `onboarding`, `explorer`, `designer`, `knowledge_classifier`, `knowledge_reviewer` y `echo`.
- **Proveedores:** Claude, Codex, OpenCode (modelos locales) y el simulado para las pruebas. Cada uno descubre sus modelos y efforts sin gastar cuota.
- **Asignación:**
  - global, con sobrescritura por proyecto;
  - «Retry with…» para un solo reintento.
- **Composición y sesión:**
  - composición pura del prompt con huella;
  - sesión del proveedor con delta determinista.
- **Rastro:**
  - cada llamada a un proveedor guarda sus eventos en orden, con progreso en vivo;
  - métricas normalizadas con su procedencia;
  - estadísticas y consumo de hoy y de la semana.
- **Clasificador:** el clasificador del conocimiento pasa por los mismos agentes y proveedores.
- **Web:** pantalla «Models & providers», página de la ejecución con su rastro y aviso cuando falta motor.

## Out of scope

- Límites automáticos de cuota o coste.
- Exportar a OpenTelemetry.
- Agentes con herramientas o MCP.
- Skills que aprenden de patrones de uso.
- Jev.
- Escalado de perfil por intentos.
- API keys.
- Proveedores en contenedor.

## Behavior

1. **Descubrimiento.**
   - Al arrancar el API y al pulsar **Refresh**, cada proveedor dice si está instalado, su versión, si está listo, y sus modelos con sus efforts.
   - No llama a ningún modelo.
   - El catálogo se guarda con su fecha y el vigente es el último.
2. **Asignación.**
   - Solo una persona asigna o quita el motor de un agente, globalmente o para un proyecto.
   - El proveedor, el modelo y el effort se eligen de lo descubierto: lo que no está en el catálogo se rechaza.
3. **Resolución.**
   - Al pedir una ejecución se usa, en este orden, el override de «Retry with…», la asignación del proyecto y la global.
   - Si no hay ninguna, la ejecución no se crea y el error dice qué agente necesita motor.
   - Si el modelo asignado ya no está en el catálogo, el agente no se ejecuta hasta que la persona elija otro.
   - DEMIURGO nunca cambia de proveedor ni de modelo por su cuenta.
4. **Ejecución.**
   - La composición une el AGENT.md, sus skills en orden y las reglas de DEMIURGO; el contexto va delimitado como dato no confiable.
   - Cada adaptador pide salida estructurada nativa, sin herramientas, sin la configuración de la persona y con el entorno filtrado.
   - Toda salida se valida con el esquema de la acción: si no encaja, `invalid_output` y no se aplica nada.
   - La ejecución registra agente y versión, huella del prompt, proveedor, modelo pedido y observado, effort y modo de sesión.
5. **Sesión.**
   - Con un agente de sesión por hilo, la siguiente ejecución reanuda la sesión del proveedor y envía solo el delta si el pack nuevo solo añade al anterior.
   - En cualquier otro caso, y siempre en un reintento, empieza de nuevo con el pack completo.
6. **Rastro y consumo.**
   - Los eventos de cada llamada se guardan en orden y se emiten en vivo.
   - Las métricas son las mismas para todos los proveedores y dicen de qué campo sale cada cifra.
   - El consumo de hoy y de la semana, por proveedor y por agente, es la suma de las llamadas.
   - Solo se muestra: no hay límites.
7. **Simulado.** El proveedor simulado solo se ofrece con las herramientas de desarrollo activas.

## Acceptance criteria

### AC-AGE-002-01 · Descubrimiento sin cuota

- Verification: automatic
- Check: Se descubre cada proveedor con salidas grabadas de sus órdenes de estado y de modelos, sin lanzar ningún modelo.

Dados los tres proveedores con salidas grabadas, cuando se refresca el catálogo, entonces cada uno queda guardado con su fecha, su estado, sus modelos y los efforts de cada modelo, sin haber llamado a ningún modelo.

### AC-AGE-002-02 · Solo una persona asigna, y solo lo descubierto

- Verification: automatic
- Check: Se asigna con cada tipo de actor y con modelos y efforts fuera del catálogo.

Dado un catálogo descubierto, cuando un actor que no es una persona asigna o quita un motor, entonces se rechaza con 403; y cuando una persona asigna un modelo o un effort que no están en el catálogo, se rechaza con 422, en ambos casos sin cambios.

### AC-AGE-002-03 · Orden de resolución

- Verification: automatic
- Check: Se resuelve con y sin asignación de proyecto, global y override, y se pide una ejecución sin ninguna.

Dadas asignaciones global y de proyecto, cuando se pide una ejecución, entonces se usa el override, después la del proyecto y después la global; sin ninguna, la ejecución no se crea y el error nombra al agente.

### AC-AGE-002-04 · Composición determinista

- Verification: automatic
- Check: Se compone dos veces con los mismos ficheros y se cambia un carácter de un agente o el orden de sus skills.

Dados los mismos ficheros de agente y skills y el mismo pack, cuando se compone el prompt, entonces sale la misma huella; cualquier cambio en los ficheros da otra.

### AC-AGE-002-05 · Registro de la ejecución

- Verification: automatic
- Check: Se pide una ejecución con el proveedor simulado y se lee la fila de la ejecución.

Dada una ejecución terminada, cuando se consulta, entonces registra agente y versión, huella del prompt, proveedor, modelo pedido y observado, effort y modo de sesión.

### AC-AGE-002-06 · Adaptadores aislados con salida estructurada

- Verification: automatic
- Check: Se revisan los argumentos, la carpeta y el entorno con que cada adaptador lanza su CLI o su petición, con un lanzador falso.

Dada una invocación a Claude, Codex u OpenCode, cuando el adaptador la lanza, entonces pide la salida estructurada nativa de ese motor, desactiva sus herramientas, no carga la configuración de la persona y el entorno no lleva credenciales de DEMIURGO, de la base ni API keys.

### AC-AGE-002-07 · Validación común

- Verification: automatic
- Check: Un proveedor devuelve una salida fuera del esquema de la acción.

Dada una salida que no encaja con el esquema de la acción, venga del proveedor que venga, cuando la ejecución termina, entonces queda en `failed` con `invalid_output` y no se aplica nada.

### AC-AGE-002-08 · Modelo que desaparece

- Verification: automatic
- Check: Se asigna un modelo y se refresca un catálogo que ya no lo tiene.

Dado un agente asignado a un modelo que ya no está en el catálogo, cuando se pide su ejecución, entonces no se crea, el error dice que ese modelo ya no se ofrece y la asignación sigue siendo la misma.

### AC-AGE-002-09 · Sesión solo si el pack solo añade

- Verification: automatic
- Check: Se piden varias ejecuciones seguidas en un hilo, cambiando un mensaje, una pregunta y reintentando.

Dada una ejecución anterior terminada en la misma sesión, cuando el pack nuevo solo añade elementos, entonces se reanuda la sesión y se envía solo el delta; si cambia o desaparece algún elemento, o es un reintento, empieza de nuevo con el pack completo.

### AC-AGE-002-10 · Eventos en orden y en vivo

- Verification: automatic
- Check: Se ejecuta con un proveedor que emite eventos y se leen la tabla, el SSE y las métricas.

Dada una llamada en curso, cuando el proveedor emite eventos, entonces se guardan en orden, el SSE del proyecto emite el progreso y las métricas finales llevan su procedencia.

### AC-AGE-002-11 · Retry with…

- Verification: automatic
- Check: Se reintenta una ejecución fallida con otro motor.

Dada una ejecución fallida, cuando la persona la reintenta con otro proveedor, modelo y effort, entonces se crea una ejecución con el mismo context pack y ese motor, y un motor fuera del catálogo se rechaza con 422.

### AC-AGE-002-12 · Consumo

- Verification: automatic
- Check: Se siembran llamadas de hoy, de esta semana y anteriores y se compara el consumo con su suma.

Dadas llamadas de varios días, cuando se consulta el consumo, entonces el de hoy y el de la semana, por proveedor y por agente, coinciden con la suma de sus llamadas.

### AC-AGE-002-13 · Simulado solo en desarrollo

- Verification: automatic
- Check: Se consultan los proveedores con y sin herramientas de desarrollo.

Dado el API sin herramientas de desarrollo, cuando la persona consulta los proveedores, entonces el simulado no aparece; con ellas, sí.
