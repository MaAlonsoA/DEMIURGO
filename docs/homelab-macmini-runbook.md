# Guion de ejecución del homelab para Claude Code en el Mac mini

Este documento lo lee Claude Code **en el mini** para ejecutar el plan de `docs/homelab-macmini-plan.md` de forma autónoma. Claude Code ya está instalado y con sesión iniciada en el mini. Todo lo que puede hacerse desde una terminal del mini o por una API lo hace Claude sin preguntar. Cloudflare se configura por su API con un token; nada se hace en el panel.

## Lo que hace la persona: dar el objetivo

Nada más. No prepara tokens, ni `sudo`, ni valores. Pega el prompt del final de este documento y responde cuando Claude le pida algo. Claude averigua lo que pueda por sí mismo (la URL del repo con `git remote`, el dominio con la lista de zonas de Cloudflare, la IP del mini con `ipconfig`) y pide lo que no, en el momento en que lo necesita y una sola vez:

- **La contraseña de la cuenta del mini**, la primera vez que haga falta `sudo`. Con ella deja `sudo` sin contraseña para el resto (`/etc/sudoers.d/demiurgo`) y activa el inicio de sesión automático.
- **Un acceso a Cloudflare.** Claude imprime el enlace para crear un token de API con los permisos que necesita (Cloudflare Tunnel, Access: Apps and Policies, Access: Organizations, Zero Trust, DNS de la zona), la persona lo crea con un clic y le pega el token. Si Cloudflare lo permite por enlace de autorización (`cloudflared tunnel login`), Claude lo usa para lo que cubra y pide el token solo para el resto.
- **Su correo**, para las políticas de Access.

Y durante la ejecución, lo que un proceso en el mini no puede hacer físicamente. Claude lo pide con instrucciones exactas y sigue con lo que no dependa de ello:

- 🖐 **Instalar apps en sus dispositivos**: WARP y Termius en el PC y en el iPhone, e iniciar sesión en la organización Zero Trust. Claude dice qué instalar, con qué correo entrar y qué host crear en Termius; cuando Termius tenga su clave, la persona le pega la pública.
- 🖐 **Logins con código de dispositivo**: Codex en el host y las CLI de Claude y Codex dentro del contenedor. Claude imprime la URL y el código; la persona los abre desde el móvil.
- 🖐 **La prueba del corte de luz**: desconectar el monitor, cortar la corriente un minuto y entrar desde el móvil con datos.
- 🖐 **Los datos del PC** (fase D): un comando que Claude dicta para volcar las bases en Windows y copiarlas al mini, y la confirmación explícita antes del corte.

## Reglas para Claude durante la ejecución

- Sigue las fases del plan en orden, A → E. No empieces una fase sin cerrar la anterior con su criterio de cierre. Si un criterio de cierre necesita a la persona (🖐), déjalo pendiente, sigue con todo lo demás de la fase siguiente que no dependa de él, y recuérdalo al final.
- Todo lo que sea configurable por CLI, fichero o API lo haces tú. No pidas a la persona que haga en un panel lo que puedes hacer con la API de Cloudflare. Consulta la documentación de la API (`https://developers.cloudflare.com/api/`) cuando dudes de un endpoint; no inventes campos.
- Para lo que solo puede hacer la persona (🖐), di exactamente qué, con qué valores, y qué te tiene que devolver. No inventes tokens ni des por hecho un paso manual. No te quedes bloqueado esperando si hay trabajo que no depende de ello.
- No hagas ninguna llamada real a Claude ni a Codex desde DEMIURGO para probar: usa el proveedor simulado (`DEMIURGO_DEV_TOOLS=1`).
- No migres datos (fase D) sin confirmación explícita de la persona en ese momento.
- No toques nada que no sea el mini: ni el PC, ni `demiurgo-stable`, ni el puerto 8000.
- Genera todos los secretos nuevos con `openssl rand -base64 32`; nunca reutilices los valores de ejemplo del repo. Guárdalos en `~/Demiurgo/.env` y en `~/.config/demiurgo/secrets.md` con permisos `0600`, y muéstraselos a la persona una vez al cerrar la fase B.
- Cada cambio en el repo (Dockerfile, compose, CLAUDE.md, retirada de los compose viejos) va en su commit, en español, y se sube a `origin v2.2`.
- Al cerrar cada fase, escribe en `docs/homelab-macmini-bitacora.md` qué se hizo, qué falló y cómo se resolvió, y qué queda pendiente de la persona. Es el registro para la persona. Commitea y sube.
- Si algo falla dos veces de la misma forma, no insistas: anótalo, sigue con lo que puedas y repórtalo al cerrar la fase.

## Fase A · Acceso

1. Inventario: `sw_vers`, `softwareupdate -l` (instalar actualizaciones con `sudo softwareupdate -ia` si hay), IP por Ethernet (`ipconfig getifaddr en0`), nombre del equipo `macmini` (`sudo scutil --set HostName macmini` y `ComputerName`, `LocalHostName`). Comprobar si `sudo -n true` funciona; si no, pedir la contraseña de la cuenta una vez, usarla con `sudo -S` para escribir `/etc/sudoers.d/demiurgo` (`demiurgo ALL=(ALL) NOPASSWD: ALL`, modo 440) y no volver a pedirla.
2. Homebrew, si no está: instalar sin prompts (`NONINTERACTIVE=1`) y añadir `brew shellenv` a `~/.zprofile`. `brew install git node@24 tmux cloudflared code-server colima docker docker-compose jq`. `corepack enable`. `npm install -g @openai/codex`.
3. `sshd` solo con claves y solo `demiurgo`: `/etc/ssh/sshd_config.d/demiurgo.conf` con `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `AllowUsers demiurgo`, `PermitRootLogin no`. **Antes** de aplicarlo, comprobar que `~/.ssh/authorized_keys` tiene al menos una clave (la del PC con la que entró la persona); si no la hay, generar un par `ed25519` en el mini, añadir la pública, y entregar la privada a la persona por la sesión actual para que la guarde en el PC. Aplicar con `sudo launchctl kickstart -k system/com.openssh.sshd` y comprobar desde otra sesión antes de cerrar la actual.
4. Energía y arranque: `sudo pmset -a sleep 0 disksleep 0 autorestart 1 womp 1`. Comprobar FileVault desactivado (`fdesetup status`); si está activo, anotarlo: desactivarlo es decisión de la persona (`sudo fdesetup disable` lo hace). Inicio de sesión automático con la misma contraseña ya pedida: `sudo sysadminctl -autologin set -userName demiurgo -password '<contraseña>'`. Comprobar con `defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser`.
5. Firewall: `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on` y `--add /usr/sbin/sshd --unblockapp /usr/sbin/sshd`.
6. Cloudflare por API. Pedir el token a la persona con el enlace `https://dash.cloudflare.com/profile/api-tokens` y la lista exacta de permisos; guardarlo en `~/.config/demiurgo/cloudflare.env` (modo 600) como `CF_API_TOKEN`. Obtener el `account_id` (`GET /accounts`) y las zonas (`GET /zones`): si hay una sola, es el dominio; si hay varias, preguntar cuál. Guardar `account_id` y `zone_id` en el mismo fichero.
   - **Túnel:** `POST /accounts/{account_id}/cfd_tunnel` con `name: macmini` y `config_src: cloudflare`. Guardar el `id` y obtener el token del túnel (`GET /accounts/{account_id}/cfd_tunnel/{id}/token`). `sudo cloudflared service install <token>`; comprobar `sudo launchctl list | grep cloudflared` y `cloudflared tunnel info macmini` o el estado por API (`connections` no vacío).
   - **Ingress:** `PUT /accounts/{account_id}/cfd_tunnel/{id}/configurations` con las reglas: `ssh.<dominio> → ssh://localhost:22`, `demiurgo.<dominio> → http://localhost:8100`, `phoenix.<dominio> → http://localhost:6006`, `metabase.<dominio> → http://localhost:3300`, `code.<dominio> → http://localhost:8443`, y la regla final `http_status:404`.
   - **DNS:** un registro `CNAME` proxied por hostname, apuntando a `<tunnel-id>.cfargotunnel.com` (`POST /zones/{zone_id}/dns_records`).
   - **Red privada:** `POST /accounts/{account_id}/teamnet/routes` con `network: <ip-lan-del-mini>/32` y `tunnel_id`. Activar el proxy TCP de WARP en la configuración de la cuenta (`PATCH /accounts/{account_id}/gateway/configuration`, `settings.proxy.tcp: true`), y comprobar que la red del mini no está en la lista de exclusiones de WARP (split tunnel) del perfil de dispositivo por defecto (`GET /accounts/{account_id}/devices/policy`); si `192.168.0.0/16` o la red local está excluida, retirar esa exclusión con `PUT /accounts/{account_id}/devices/policy/exclude`.
   - **Access:** una aplicación self-hosted por hostname (`POST /accounts/{account_id}/access/apps`) con `session_duration: 720h` y una política `allow` con `include: [{ email: { email: <correo> } }]` (`POST /accounts/{account_id}/access/apps/{app_id}/policies`). En la de `ssh.<dominio>`, `type: ssh` con browser rendering activado. Inscripción de dispositivos para WARP: la aplicación de tipo `warp` con la misma política. Comprobar que la organización Zero Trust existe (`GET /accounts/{account_id}/access/organizations`); si no, crearla con un `auth_domain` `<algo>.cloudflareaccess.com` y el proveedor de identidad One-time PIN (`POST /accounts/{account_id}/access/identity_providers`, `type: onetimepin`).
   - Comprobación: `curl -sI https://demiurgo.<dominio>` responde con una redirección al login de Access (302 a `cloudflareaccess.com`).
7. code-server: `~/.config/code-server/config.yaml` con `bind-addr: 127.0.0.1:8443`, `auth: none`, `cert: false`. `brew services start code-server`. `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8443` devuelve 200 o 302.
8. `tmux`: `~/.tmux.conf` con `set -g mouse on` y `set -g history-limit 50000`.
9. Termius y WARP 🖐. Entregar a la persona, en un solo mensaje: qué instalar (WARP «1.1.1.1» y Termius en el PC y en el iPhone), el nombre de la organización Zero Trust para el login de WARP (`auth_domain` sin el sufijo) y su correo, y el host para Termius: alias `mini`, dirección `<ip-lan-del-mini>`, puerto 22, usuario `demiurgo`, clave `ed25519` generada en Termius (Keychain → Generate), y como comando de inicio `tmux attach -t claude || tmux new -s claude`. Pedirle la clave pública de Termius y, cuando llegue, añadirla a `authorized_keys`. No esperar bloqueado: seguir con el paso 10 y la fase B.
10. Control remoto de Claude Code: en el mini, `tmux new -d -s claude` y dentro `claude`. Consultar en `claude --help` y en la documentación de Claude Code cómo se activa el control remoto en la versión instalada (`/remote-control` en la sesión o una opción de arranque), activarlo, y dejar en la bitácora el comando exacto para relanzarlo tras un reinicio, más un LaunchAgent `~/Library/LaunchAgents/com.demiurgo.claude-tmux.plist` que al iniciar sesión cree la sesión `tmux` con `claude` dentro. Decir a la persona que la sesión debería aparecer en su app de Claude.
11. **Prueba de cierre** 🖐, cuando la persona pueda: desconectar el monitor, cortar la corriente un minuto, volver a darla y, desde el móvil con datos, entrar por `code.<dominio>`, por la terminal SSH del navegador y por Termius con WARP. Si entra por las tres y `uptime` es reciente, la fase A está cerrada. Mientras tanto, continuar con la fase B.

## Fase B · Plataforma

1. Colima: `colima start --cpu 4 --memory 8 --disk 100 --vm-type vz --mount-type virtiofs`. `brew services start colima`. `docker context use colima`. Comprobar `docker run --rm hello-world`.
2. Escribir en el repo, en la raíz:
   - `Dockerfile`: `node:24-bookworm-slim`, `corepack enable`, `pnpm install --frozen-lockfile` en `/app` (con el repo montado encima en desarrollo, `node_modules` en volumen con nombre), CLI `@anthropic-ai/claude-code` y `@openai/codex` globales, cliente `docker` (`docker-ce-cli`), usuario no root.
   - `compose.yaml` con los servicios de la diapositiva 10 del plan: `postgres`, `api`, `web-build`, `evidence-db`, `collector`, `ingestor`, `phoenix`, `metabase`. Puertos solo en `127.0.0.1`. `restart: unless-stopped`, healthchecks, `depends_on: condition: service_healthy`. Volúmenes: `pgdata`, `node_modules`, `web-dist`, `agent-sessions`, `cli-auth`, `evidence-data`, `evidence-archive`, `evidence-queue`, `evidence-metabase`. Socket de Docker montado en `api`.
   - `api` arranca con `node --watch packages/api/src/main.ts`; `web-build` con `pnpm --filter @demiurgo/web exec vite build --watch`. Ambos con el repo montado en `/app`.
   - Ajustar el ingestor para escuchar en `0.0.0.0` (`DEMIURGO_EVIDENCE_HOST`) y el colector para exportar a `http://ingestor:4319`.
   - `.env.example` con todas las variables de la diapositiva 12 y `.env` real fuera de Git.
3. Retirar `compose.dev.yaml`, `compose.instance.yaml` y `compose.evidence.yaml`, el script `db:up` y adaptar los scripts `evidence:*` de `package.json` al compose único. Cambiar el valor por defecto de `DEMIURGO_TEST_DB_URL` en `packages/core/test/support/global-setup.ts` al Postgres de 55433. Actualizar CLAUDE.md, AGENTS.md y `docs/observabilidad.md` (puertos y forma de relanzar).
4. `docker compose up -d --build --wait`. Comprobar `docker compose ps` todo `healthy`, `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8100/api/session` devuelve 401, `pnpm evidence migrate` y `pnpm evidence metabase-setup` con `docker compose run --rm`.
5. **Prueba de cierre**: `sudo reboot`. Tras volver a entrar, sin abrir ninguna terminal más, `docker compose ps` muestra todos los servicios sanos, `cloudflared` y `code-server` están arriba (`launchctl list`), y `curl -sI https://demiurgo.<dominio>` responde con la redirección de Access. Si el reinicio no vuelve solo (Colima no arranca sin sesión), revisar el inicio de sesión automático del paso A.4 antes de seguir.

## Fase C · Desarrollo

1. `pnpm install` en el host (para `gate:types`, `gate:test` y las herramientas). `pnpm gate:types` en verde.
2. `pnpm gate:test` contra `DEMIURGO_TEST_DB_URL=postgres://demiurgo:<secreto>@127.0.0.1:55433/postgres`. Si alguna prueba falla por el entorno, anotarlo en la bitácora; no cambiar pruebas para que pasen.
3. Codex interactivo 🖐: `codex login --device-auth`; imprimir la URL y el código para que la persona los abra desde el móvil. Esperar como mucho lo que dure el código; si caduca, anotarlo y seguir.
4. Proveedores dentro del contenedor 🖐: `docker compose exec api claude` y `docker compose exec api codex login --device-auth`, con el mismo patrón de URL y código. Comprobar que la web, en Models & providers, descubre Claude y Codex. No lanzar ninguna ejecución real.
5. Comprobar SSE a través de Cloudflare: con una sesión de la web iniciada por `curl` (cookie y CSRF), abrir la ruta SSE del diario por el dominio y mantenerla dos minutos; si se corta a los 100 s, añadir un keepalive de comentario cada 30 s en la ruta SSE de `packages/api` y commitear.
6. Comprobar `Host`/`Origin`: por el dominio, iniciar sesión y ejecutar un comando cualquiera (crear un proyecto de prueba y borrarlo con una instantánea previa). Si la API rechaza, ajustar `DEMIURGO_ORIGINS` o el `trust proxy` de Fastify y commitear.
7. **Prueba de cierre**: editar un texto de `packages/web` y un texto de una respuesta de `packages/api`, y comprobar con `curl` por el dominio que ambos cambian sin ningún `docker compose` de por medio. Deshacer los dos cambios.

## Fase D · Datos

1. 🖐 Dictar a la persona el comando para el PC, con Docker Desktop arrancado y la API 8100 y el ingestor parados: `docker exec <contenedor-postgres-55433> pg_dump -Fc -U demiurgo demiurgo_v2 -f /tmp/demiurgo_v2.dump` y `docker cp` al escritorio, lo mismo para `demiurgo_evidence` y `phoenix`, y `scp` de los tres ficheros a `mini:~/restore/` (por Termius/WARP, `scp -i <clave> <fichero> demiurgo@<ip-lan>:~/restore/`). Esperar a que los ficheros existan en `~/restore/`.
2. Ensayo: restaurar cada volcado en una base `dmg_t_restore_*`, arrancar una API temporal contra ella en otro puerto, comprobar migraciones y conteo de `events`. Tirar la base de ensayo.
3. 🖐 Confirmación explícita de la persona para el corte. Restaurar en `demiurgo_v2`, `demiurgo_evidence` y `phoenix` reales. `docker compose restart api ingestor`. Comprobar por el dominio que los proyectos y los hilos están.
4. Copias: script `~/bin/backup.sh` (dumps `-Fc` de las tres bases + `restic` del repo, `.env`, `~/.claude`, `~/.codex`, `~/.ssh`) y un LaunchAgent diario a las 03:00, de momento a `~/backups` con rotación de 14 días. 🖐 Preguntar a la persona, sin bloquear, el destino externo (disco USB cifrado o bucket remoto con credenciales) y añadirlo cuando lo dé.
5. **Prueba de cierre**: restaurar el último backup en una base de ensayo y arrancar contra ella. Anotar en la bitácora cuánto tarda.

## Fase E · Limpieza

1. Commit final con los compose viejos borrados, CLAUDE.md y AGENTS.md actualizados (dónde vive la instancia, cómo se relanza con `docker compose`, puertos).
2. 🖐 Decir a la persona que en el PC ya no debe arrancar las instancias y que puede desinstalar Docker Desktop.
3. Dejar `sudo` sin contraseña solo si la persona lo pide; si no, retirar `/etc/sudoers.d/demiurgo` al final y anotarlo.
4. Cerrar la bitácora con la lista de hostnames, puertos, dónde están los secretos, cómo se hace un backup y una restauración, cómo se relanza la sesión de Claude con control remoto, y qué pasa si el mini falla.

## Prompt para pegar en Claude Code en el mini

```
Objetivo: convierte este Mac mini en el homelab de DEMIURGO siguiendo docs/homelab-macmini-plan.md y docs/homelab-macmini-runbook.md, fase por fase desde la A, de forma autónoma.
Yo no configuro nada. Todo lo que se pueda hacer desde este mini o por la API de Cloudflare lo haces tú. Lo que necesites de mí (una contraseña, un token, un login desde el móvil, instalar una app en mis dispositivos, la prueba del corte de luz, los datos del PC) me lo pides en el momento, con instrucciones exactas, y mientras tanto sigues con lo que no dependa de ello.
Quiero entrar con Termius desde el PC y el iPhone a través de WARP, y escribir a Claude Code desde la app de Claude con el control remoto. Déjalo todo preparado.
No migres datos ni lances ninguna ejecución real con Claude o Codex sin que te lo confirme en ese momento. No toques demiurgo-stable ni el puerto 8000.
Al cerrar cada fase, apunta en docs/homelab-macmini-bitacora.md lo que has hecho y lo que queda pendiente de mí, y commitea y sube a origin v2.2.
```
