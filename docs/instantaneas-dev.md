# Instantáneas del entorno de desarrollo

Herramienta de depuración para guardar el entorno de desarrollo y volver a él sin repetir el onboarding. Una instantánea es una copia de **la base entera**: todos los proyectos, las conversaciones, el contexto, las ejecuciones, el conocimiento y los flujos durables de DBOS. Al restaurarla, toda la base vuelve a ese punto.

Solo funciona con `DEMIURGO_DEV_TOOLS=1`. **Nunca se activa en la instancia `demiurgo-v2`**: restaurar sustituye el diario de eventos entero, algo que el producto no hace jamás.

## Cómo funciona

- **Guardar** crea una base del mismo clúster con `CREATE DATABASE dmg_snap_<fecha>_<etiqueta> TEMPLATE <base>`. La etiqueta, la fecha, la última migración y el nombre y número de eventos de cada proyecto van en `COMMENT ON DATABASE`.
- **Restaurar** sigue estos pasos:
  1. Crea una base temporal a partir de la instantánea.
  2. La migra al esquema actual.
  3. Le copia las personas y las sesiones vivas de la base actual, así sigues dentro.
  4. Cambia la base viva por la temporal.

  Si algo falla antes del cambio, la base viva no se toca. La instantánea se conserva: se puede restaurar tantas veces como haga falta.
- **Reset** hace lo mismo con una base vacía y migrada. Quedan las mismas personas y ningún proyecto, así que el siguiente paso es un Día 1 nuevo.
- Mientras se guarda, se restaura o se hace reset, el API para su núcleo (DBOS incluido), cambia la base y lo vuelve a arrancar sin salir del proceso. Tarda uno o dos segundos, y las peticiones que llegan mientras tanto esperan.

Código: `packages/core/src/dev/snapshots.ts` (SQL), `packages/api/src/runtime.ts` (reinicio del núcleo), `packages/api/src/dev-tools.ts` (rutas `/api/dev/*`), `packages/api/src/snap.ts` (CLI) y `packages/web/src/screens/dev/` (panel).

## Desde la web

Arranca el API de desarrollo con la bandera (el resto, como en `docs/informe-autonomo-v2-frontend-h1.md` §1):

```powershell
$env:DEMIURGO_DATABASE_URL = 'postgres://demiurgo:demiurgo-dev@127.0.0.1:55432/demiurgo_web_dev'
$env:DEMIURGO_PORT = '8200'
$env:DEMIURGO_ORIGINS = 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8200'
$env:DEMIURGO_DEV_TOOLS = '1'
node --watch packages/api/src/main.ts
```

Aparece una pestaña **Dev** en el borde inferior de todas las pantallas. Abre el panel **Snapshots**:
- **Save snapshot:** guarda la base con la etiqueta que escribas, por ejemplo «after day 1». La página se recarga.
- **Restore:** vuelve a esa instantánea y te lleva a la portada.
- **Delete:** borra la instantánea.
- **Reset:** base vacía, con tu persona, y te lleva a **What do you want to build?**.

Restore, Delete y Reset piden confirmación.

## Desde la terminal

```powershell
$env:DEMIURGO_DATABASE_URL = 'postgres://demiurgo:demiurgo-dev@127.0.0.1:55432/demiurgo_web_dev'
$env:DEMIURGO_DEV_TOOLS = '1'
pnpm snap list
pnpm snap save "after day 1"
pnpm snap restore "after day 1"     # por etiqueta (la más reciente) o por nombre dmg_snap_…
pnpm snap drop "after day 1"
pnpm snap reset
```

Con el API conectado, `save`, `restore` y `reset` se niegan y enumeran las conexiones. Tienes tres opciones:
- usar el panel de la web;
- parar el API;
- añadir `--force`, que corta las conexiones. Después hay que reiniciar el API.

## Avisos

- **`pnpm db:down -v` borra todas las instantáneas**: viven en el mismo volumen que las bases de desarrollo.
- El volumen de desarrollo es `demiurgo-v2-dev_datos`. La clave de `compose.dev.yaml` se llama `datos` para que `pnpm db:up` no recree el contenedor sobre un volumen vacío.
- **Guarda en momentos tranquilos.** Parar el núcleo aborta una ejecución del agente en curso. Al restaurar, esa ejecución puede quedar interrumpida o repetirse.
- **Otras pestañas abiertas** dejan de recibir eventos en vivo tras un guardado o una restauración. Hay que recargarlas.
- **Cada instantánea es una copia completa.** El panel muestra el tamaño de cada una; borra las que ya no sirvan.
- Las instantáneas son de una base concreta: las de `demiurgo_web_dev` no aparecen si el API apunta a otra base.
