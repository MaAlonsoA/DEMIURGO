# Sonda del runner aislado: ejecución real del 2026-09-24

Ejecución real de la sonda del runner (invariante I9, AC-ESQ-001-11) para completar la sección Spike de `ADR-RUN-001`. El informe no contiene secretos: la sonda solo registra nombres de variables, nunca sus valores.

## Entorno

| Elemento | Valor |
|---|---|
| Fecha | 2026-09-24 |
| Host | Windows 11 Enterprise LTSC 2024 (10.0.26200), Node 24.21.0 |
| Docker | Docker Desktop, motor 29.8.0 |
| Kernel de la VM de Docker | `6.18.33.2-microsoft-standard-WSL2`: el backend es **WSL2**, no Hyper-V |
| Imagen | `node:24.21-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1` (única de `IMAGENES_PERMITIDAS`) |
| Código | `packages/core/src/runner/` (`jobspec.ts`, `runner.ts`, `sonda.ts`) |
| Prueba | `packages/core/test/runner.test.ts`, `npx vitest run --project integracion packages/core/test/runner.test.ts` |

Durante la prueba, el proceso de Node del host tenía definidas `DATABASE_URL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEMIURGO_SECRETO` y `PGPASSWORD` con valores falsos, y el Postgres de desarrollo escuchaba en `127.0.0.1:55432`. La prueba comprueba antes que ese puerto está abierto en el host.

## Orden con la que el broker lanza la sonda

`ejecutarSonda()` pide al broker un `JobSpec` con `comando: ['node', '-']`, el script de la sonda como entrada y `entorno: { LANG: 'C.UTF-8', CI: '1' }`. El broker genera esta orden y la lanza con `spawn('docker', args, { shell: false })`:

```text
docker run --rm --name demiurgo-sonda-<uuid> --label demiurgo.runner=1 --pull never
  --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m
  --cap-drop ALL --security-opt no-new-privileges --user 1000:1000
  --pids-limit 128 --memory 512m --memory-swap 512m --cpus 1
  -i --env CI=1 --env LANG=C.UTF-8
  node:24.21-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 node -
```

No lleva `-v`, `--mount`, `--privileged` ni `--network host`. El proceso `docker` solo recibe `PATH`, `SystemRoot`, `USERPROFILE`/`HOME`, `APPDATA`, `LOCALAPPDATA`, `ProgramData`, `TEMP`/`TMP` y las variables `DOCKER_*` de conexión si existen. Nunca recibe `DEMIURGO_*`, `DATABASE_URL` ni `PG*`.

## Resultado de cada comprobación

Resultado: **0 violaciones** en las 3 ejecuciones medidas y en la prueba AC-ESQ-001-11.

| Comprobación | Resultado dentro del runner | Cumple |
|---|---|---|
| Usuario | `uid 1000`, `gid 1000` | Sí |
| Capacidades | `CapEff 0000000000000000`, `NoNewPrivs 1`, `Seccomp 2` (filtro por defecto de Docker) | Sí |
| Variables de entorno visibles | `CI`, `HOME`, `HOSTNAME`, `LANG`, `NODE_VERSION`, `PATH`, `PWD`, `SHLVL`, `YARN_VERSION` | Sí |
| Variables sensibles (patrones KEY, TOKEN, SECRET, PASS, DATABASE, PG, DEMIURGO, ANTHROPIC, OPENAI, CODEX, CLAUDE, AWS, GITHUB…) | Ninguna. Las variables falsas del host no llegan | Sí |
| `/data`, `/codex`, `/home/node/.claude`, `/home/node/.codex`, `/run/secrets`, `/var/run/docker.sock`, `/run/docker.sock`, `/host`, `/mnt/c`, `/mnt/host`, `/workspace` | No existen (`ENOENT`) | Sí |
| `/root/.claude`, `/root/.codex` | Inaccesibles (`EACCES`): `/root` tiene modo 700 y la sonda no es root. Tampoco existen en la imagen | Sí |
| TCP `host.docker.internal:55432` (Postgres de desarrollo) | Sin conexión: el nombre no se resuelve (`TIMEOUT`) | Sí |
| TCP `host.docker.internal:8000` | Sin conexión (`TIMEOUT`) | Sí |
| TCP `192.168.65.254:55432` (IP de `host.docker.internal` en Docker Desktop) | `ENETUNREACH` | Sí |
| TCP `172.17.0.1:5432` (puente de Docker) | `ENETUNREACH` | Sí |
| TCP `10.0.2.2:55432` | `ENETUNREACH` | Sí |
| TCP `127.0.0.1:5432` | `ECONNREFUSED`: solo existe el loopback propio del contenedor | Sí |
| TCP `1.1.1.1:443` (Internet) | `ENETUNREACH` | Sí |
| DNS `registry.npmjs.org` | Sin resolución (`TIMEOUT`) | Sí |
| Escritura en `/` y en el directorio de trabajo (`/`) | `EROFS` | Sí |
| Escritura en `/home/node`, `/etc`, `/usr/local/lib` | `EROFS` | Sí |
| Escritura en `/tmp` (control) | Escribe (tmpfs `noexec,nosuid`, 64 MiB) | Esperado |

## Controles: la sonda detecta lo que busca

Para que el resultado no sea vacío, se hicieron dos controles con la misma sonda:

1. **Fuera del runner, en el host** (prueba `AC-ESQ-001-11 control…`): detecta las variables falsas, un fichero de credenciales creado para la prueba, la conexión TCP a `127.0.0.1:55432` y la escritura en el directorio de trabajo.
2. **En un contenedor sin el runner** (`docker run --rm -i` con la misma imagen y las opciones por defecto; se quitó el puerto 8000 de los destinos). Medido una vez, fuera de las pruebas:

| Comprobación | Contenedor por defecto | Runner |
|---|---|---|
| Usuario | `uid 0` | `uid 1000` |
| Postgres del host por `host.docker.internal:55432` y `192.168.65.254:55432` | **Conecta** | No conecta |
| Internet (`1.1.1.1:443`) y DNS (`registry.npmjs.org`) | **Conecta** y resuelve | No |
| Escritura en `/`, `/etc`, `/home/node`, `/usr/local/lib` | **Escribe** | `EROFS` |
| Capacidades | `CapEff 00000000a80425fb`, `NoNewPrivs 0` | `CapEff 0`, `NoNewPrivs 1` |

Conclusión del control: en Docker Desktop, un contenedor con la red por defecto **sí alcanza el Postgres publicado solo en `127.0.0.1` del host**. La barrera que lo impide es `--network none`. Por eso el broker la fija y el `JobSpec` no permite cambiarla.

## Tiempos

| Medida | Valor |
|---|---|
| Sonda completa en el runner, 3 ejecuciones | 5,49 s, 5,42 s y 5,44 s |
| Tiempo interno de la sonda (desde que Node evalúa el script hasta que escribe el informe) | 3,0 s, marcado por el límite de 3 s del intento de DNS |
| Trabajo trivial (`node -e 0`), 3 ejecuciones | 0,41 s, 0,41 s y 0,39 s |
| Trabajo `sleep 30` con `tiempoMaxMs: 3000` | 3,2 s hasta `failureKind: 'timeout'` y el contenedor eliminado |
| Cancelación con `AbortSignal` a los 2 s | 2,2 s hasta `failureKind: 'cancelled'` y el contenedor eliminado |
| Fichero de pruebas completo (11 pruebas) | unos 12 s |

Los intentos de red vencen a los 1,5 s (TCP) y a los 3 s (DNS). Los ~2 s que faltan hasta el total los pasa Node al salir, esperando a los hilos de `getaddrinfo` de musl, que siguen reintentando hasta su propio límite de 5 s. Ningún paquete sale del contenedor porque no tiene interfaz de red.

## Limitaciones y pendientes

- **T0 y T1 comparten la VM.** Con Docker Desktop, el runner, el Postgres de desarrollo y la futura v2 corren en la misma VM Linux. Un escape de contenedor alcanzaría la base aunque no esté montada. La separación real (microVM o VM dedicada) queda para después del esqueleto (ADR-RUN-001).
- **El backend es WSL2, no Hyper-V.** El kernel de la VM es `microsoft-standard-WSL2`. El §6 del stack recomienda Hyper-V porque en WSL2 todas las distros comparten kernel. En esta máquina ese kernel también lo comparten las distros WSL del usuario.
- **Imágenes descargadas de antemano.** El broker lanza con `--pull never`, así que una imagen permitida que no esté descargada da `failureKind: 'infra'`. La preparación de las pruebas la descarga si falta. En la CI hará falta un `docker pull` de la imagen por digest.
- **Sin seccomp propio ni AppArmor explícito.** Se usa el perfil seccomp por defecto de Docker (`Seccomp 2`), que no se desactiva en ningún caso.
- **Sin red, sin egress controlado.** El perfil A del §6 (proxy de egress con lista permitida y pasarela de modelo) queda para S4. Hoy el runner no tiene ninguna red.
- **El proceso `docker` hereda `USERPROFILE`/`APPDATA`.** Los necesita para leer `~/.docker` (contexto y credenciales del registro). No llegan al contenedor, porque el broker solo pasa `--env` con clave y valor explícitos de la lista permitida.
