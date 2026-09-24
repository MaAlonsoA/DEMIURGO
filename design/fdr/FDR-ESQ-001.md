---
codigo: FDR-ESQ-001
tipo: fdr
titulo: Esqueleto técnico
version: 1
estado: propuesto
dominio: nucleo
incremento: S0
enlaces:
  - tipo: based_on
    destino: DEC-PLN-001@1
anexos: []
---

# FDR-ESQ-001 · Esqueleto técnico

## Objetivo

Pasar por todas las piezas del núcleo con contenido trivial y dejar probadas las invariantes que nunca se recortan:

- el actor lo fija el servidor;
- todo cambio de estado sale de las tablas;
- el diario solo admite INSERT;
- el trabajo largo es durable y su efecto ocurre una vez;
- las salidas de IA se validan antes de tener efectos;
- el runner no ve datos ni credenciales.

## Alcance

- Núcleo puro en `packages/domain`: comando → capacidad → transición → guardas → evento, con las tablas de ADR-NUC-001.
- Ejecución en `packages/core`: una transacción por comando con su evento, y el diario `events` protegido por triggers contra UPDATE, DELETE y TRUNCATE.
- Migraciones SQL planas con un migrador propio que guarda el hash de cada migración aplicada.
- Configuración inyectada: un solo módulo lee el entorno. Las pruebas crean bases efímeras con el prefijo `dmg_t_`.
- Motor durable con DBOS: una ejecución interrumpida se reanuda al arrancar y su efecto ocurre una vez.
- Puerto de agentes con simulador determinista y adaptador real de Claude por CLI (ADR-AGE-001), con validación común en Zod.
- Runner aislado con broker, `JobSpec` cerrado y sonda (ADR-RUN-001).
- API HTTP mínima con el actor fijado por la credencial, y flujo SSE del diario con `Last-Event-ID`.
- CI de 4 etapas: tipos y lint, unitarias, integración con Postgres e invariantes.

## Fuera de alcance

- La UI: se decidirá en una sesión con Claude Design. Mientras tanto, la aceptación humana se hace por la API con la cookie de sesión.
- La funcionalidad del Pilar 1 (S1) y del conocimiento (S2).
- El proxy de egress y la pasarela de modelo (S4).
- Codex como proveedor.

## Comportamiento

1. Un cliente envía un comando con nombre. El servidor fija el actor según la credencial (cookie de sesión humana o token) e ignora cualquier actor que declare el cliente.
2. Si la matriz no permite el comando a ese tipo de actor, responde 403 «prohibido», sin efectos.
3. Si no hay transición para el comando desde el estado actual, responde 409 «transición inválida», sin efectos.
4. Si falla una guarda, responde 409 con el motivo en lenguaje de producto, sin efectos.
5. Si todo pasa, en una sola transacción se escribe el cambio y exactamente un evento con número de secuencia por proyecto, actor, comando, entidad@versión, estado antes → después y causa.
6. El flujo SSE entrega los eventos del diario. Con `Last-Event-ID`, entrega solo los posteriores.
7. Una ejecución de agente se pide con un comando, se encola y la procesa un workflow durable: construye el context pack, llama al puerto de agentes, valida la salida y registra el resultado. Si el proceso muere, el workflow se reanuda al arrancar.
8. Una salida fuera del esquema termina la ejecución en `failed` con `failure_kind` `invalid_output`, sin mensajes, propuestas ni otros efectos.

## Criterios de aceptación

### AC-ESQ-001-01 · Comando → capacidad → tabla → evento

- Verificación: automática
- Comprobación: Se ejecuta un comando permitido y se leen la entidad y el diario.

Dado un actor con permiso y una entidad en un estado con transición para el comando, cuando ejecuta el comando, entonces el estado cambia y queda exactamente un evento con actor, comando, entidad@versión, antes → después y causa, escrito en la misma transacción que el cambio.

### AC-ESQ-001-02 · 403 generado desde la matriz

- Verificación: automática
- Comprobación: Pruebas generadas desde la matriz recorren cada comando con cada tipo de actor no permitido.

Dado cada comando y cada tipo de actor que la matriz no permite, cuando ese actor ejecuta el comando, entonces se rechaza como prohibido (403 por HTTP) sin eventos ni cambios.

### AC-ESQ-001-03 · 409 generado desde las tablas

- Verificación: automática
- Comprobación: Pruebas generadas desde las tablas recorren cada estado de cada entidad implementada con cada comando sin transición.

Dada cada entidad implementada, cada uno de sus estados y cada comando sin transición desde ese estado, cuando se ejecuta el comando, entonces se rechaza como transición inválida (409) sin eventos ni cambios.

### AC-ESQ-001-04 · Diario protegido

- Verificación: automática
- Comprobación: Se intenta modificar el diario directamente en la base.

Dado un diario con eventos, cuando se intenta un UPDATE, un DELETE o un TRUNCATE sobre él, entonces la base lo rechaza y el diario queda igual.

### AC-ESQ-001-05 · Migraciones

- Verificación: automática
- Comprobación: Se arranca sobre una base vacía, se arranca otra vez y se arranca con una migración aplicada modificada.

Dada una base vacía, cuando arranca el sistema, entonces la base queda en la última versión; aplicar las migraciones de nuevo no cambia nada; y si una migración ya aplicada se modifica, el sistema no arranca.

### AC-ESQ-001-06 · Configuración inyectada

- Verificación: automática
- Comprobación: Se buscan lecturas del entorno fuera del módulo de configuración y se revisan las bases que crean las pruebas.

Dado el código del sistema, cuando se revisa, entonces solo el módulo de configuración lee variables de entorno; y cuando se ejecutan las pruebas, usan bases efímeras con el prefijo `dmg_t_`.

### AC-ESQ-001-07 · Motor durable

- Verificación: automática
- Comprobación: Se mata el proceso con una ejecución en curso y se relanza.

Dada una ejecución en curso, cuando se mata el proceso y se arranca de nuevo, entonces la ejecución se reanuda y su efecto ocurre una sola vez.

### AC-ESQ-001-08 · Salida inválida sin efectos

- Verificación: automática
- Comprobación: El simulador devuelve una salida fuera del esquema.

Dada una ejecución cuyo agente devuelve una salida fuera del esquema, cuando termina, entonces queda en `failed` con `failure_kind` `invalid_output`, sin mensajes, propuestas ni otros efectos.

### AC-ESQ-001-09 · Simulador determinista

- Verificación: automática
- Comprobación: Se ejecuta dos veces el simulador con la misma acción y el mismo context pack.

Dada la misma acción con el mismo context pack, cuando el simulador se ejecuta dos veces, entonces da la misma salida.

### AC-ESQ-001-10 · Adaptador real

- Verificación: automática
- Comprobación: Se normaliza una salida grabada de la CLI y se compara el esquema enviado con el de validación.

Dado el adaptador de Claude por CLI, cuando normaliza una salida grabada, entonces devuelve el resultado del puerto, y el esquema que recibe la CLI es el mismo con el que el sistema valida la salida.

### AC-ESQ-001-11 · Sonda del runner

- Verificación: automática
- Comprobación: La sonda se ejecuta dentro del runner y devuelve su informe.

Dada la sonda dentro del runner, cuando se ejecuta, entonces no ve variables de credenciales, no encuentra ficheros de credenciales ni de datos, no puede abrir la base ni salir a la red y no es root.

### AC-ESQ-001-12 · JobSpec cerrado

- Verificación: automática
- Comprobación: Se envían al runner trabajos con imágenes, montajes y opciones no permitidos.

Dado un `JobSpec` con una imagen sin digest o fuera de la lista permitida, un montaje o una opción no declarada, cuando se envía al runner, entonces lo rechaza sin lanzar ningún contenedor.

### AC-ESQ-001-13 · Actor fijado por el servidor

- Verificación: automática
- Comprobación: Se envían peticiones con una credencial y otro actor declarado en el cuerpo o en las cabeceras.

Dada una petición con una credencial (cookie de sesión o token) que declara otro actor, cuando el servidor la procesa, entonces el actor del evento sale de la credencial y el declarado se ignora.

### AC-ESQ-001-14 · SSE incremental

- Verificación: automática
- Comprobación: Un cliente se reconecta al flujo de eventos con `Last-Event-ID`.

Dado un cliente que se reconecta al flujo de eventos con `Last-Event-ID`, cuando se conecta, entonces recibe solo los eventos posteriores a ese identificador.

### AC-ESQ-001-15 · CI de 4 etapas

- Verificación: automática
- Comprobación: Se revisa el workflow de GitHub Actions.

Dado el workflow de la CI, cuando se lee, entonces tiene las etapas de tipos y lint, unitarias, integración con Postgres e invariantes.

### AC-ESQ-001-16 · Ejecución real registrada

- Verificación: manual
- Comprobación: La persona revisa la ejecución real registrada y su resultado.

Dado el esqueleto terminado, cuando se revisa el registro de ejecuciones, entonces hay al menos una ejecución real con Claude registrada con su resultado.
