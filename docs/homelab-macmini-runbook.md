# Guion de ejecución del homelab para Claude Code en el Mac mini

Este documento lo lee Claude Code **en el mini** para ejecutar el plan de `docs/homelab-macmini-plan.md` de forma autónoma. La persona solo interviene en los pasos marcados con 🖐, que ocurren en su navegador o en su ordenador. Todo lo demás lo hace Claude por SSH en el mini.

## Cómo arrancar (lo hace la persona, una vez)

1. Configuración inicial de macOS con monitor y teclado prestados: cuenta `demiurgo` como administrador (durante la instalación necesita `sudo`; al final del guion se decide si se le quita), Ethernet, Sesión remota activada en Ajustes → General → Compartir.
2. Desde el PC, en la red de casa:

   ```
   ssh demiurgo@<ip-del-mini>
   ```

3. En el mini, pegar esto (instala Homebrew, git, node, pnpm y Claude Code, y clona el repo):

   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile && eval "$(/opt/homebrew/bin/brew shellenv)"
   brew install git node@24 tmux
   brew link --overwrite node@24
   corepack enable
   npm install -g @anthropic-ai/claude-code
   git clone <url-del-repo> ~/Demiurgo && cd ~/Demiurgo && git checkout v2.2
   claude
   ```

   El primer `claude` pide login: abre en el PC la URL que muestra y pega el código.

4. Dentro de Claude Code, pegar el prompt del final de este documento.

A partir de ahí Claude sigue este guion. Se recomienda lanzar `claude` dentro de `tmux new -s setup` para que sobreviva a una desconexión.

## Reglas para Claude durante la ejecución

- Sigue las fases del plan en orden, A → E. No empieces una fase sin cerrar la anterior con su criterio de cierre.
- Cuando un paso lleve 🖐, para, di exactamente qué tiene que hacer la persona en el navegador o en su PC, qué valor te tiene que devolver (un token, un «hecho») y espera. No inventes tokens ni des por hecho un paso manual.
- No hagas ninguna llamada real a Claude ni a Codex desde DEMIURGO para probar: usa el proveedor simulado (`DEMIURGO_DEV_TOOLS=1`).
- No migres datos (fase D) sin que la persona lo confirme explícitamente en ese momento.
- No toques nada que no sea el mini: ni el PC, ni `demiurgo-stable`, ni el puerto 8000.
- Genera todos los secretos nuevos con `openssl rand -base64 32`; nunca reutilices los valores de ejemplo del repo. Guárdalos en `~/Demiurgo/.env` y en `~/.config/demiurgo/secrets.md` con permisos `0600`, y muéstraselos a la persona una vez.
- Cada cambio en el repo (Dockerfile, compose, CLAUDE.md, retirada de los compose viejos) va en su commit, en español, y se sube a `origin v2.2`.
- Al cerrar cada fase, escribe en `docs/homelab-macmini-bitacora.md` qué se hizo, qué falló y cómo se resolvió. Es el registro para la persona.

## Fase A · Acceso

1. Comprobar macOS actualizado (`softwareupdate -l`), nombre del equipo `macmini`, IP por Ethernet.
2. `sshd`: solo claves y solo `demiurgo`. Escribir `/etc/ssh/sshd_config.d/demiurgo.conf` con `PasswordAuthentication no`, `AllowUsers demiurgo`, `PermitRootLogin no`. **Antes** de reiniciar `sshd`, 🖐 pedir a la persona la clave pública de su PC y añadirla a `~/.ssh/authorized_keys`; comprobar que entra por clave desde otra ventana antes de cerrar la actual.
3. Energía: `sudo pmset -a sleep 0 disksleep 0 autorestart 1 womp 1`. Inicio de sesión automático de `demiurgo`: 🖐 la persona lo activa en Ajustes → Usuarios y grupos → Inicio de sesión automático (macOS exige la contraseña en pantalla; puede hacerse por Screen Sharing desde el PC o en la sesión inicial con monitor). Confirmar que FileVault está desactivado (`fdesetup status`).
4. Firewall: `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on` y permitir `sshd`.
5. Cloudflare: `brew install cloudflared`. 🖐 La persona, en el panel de Cloudflare Zero Trust: Networks → Tunnels → crear túnel `macmini` → copiar el token del comando de instalación. Claude ejecuta `sudo cloudflared service install <token>` y comprueba `sudo launchctl list | grep cloudflared`.
6. 🖐 La persona crea en el túnel los public hostnames: `ssh.tudominio → ssh://localhost:22`, `demiurgo.tudominio → http://localhost:8100`, `phoenix.tudominio → http://localhost:6006`, `metabase.tudominio → http://localhost:3300`, `code.tudominio → http://localhost:8443`. Y en Access → Applications, una aplicación self-hosted por hostname con política Allow para su correo; en la de `ssh.tudominio`, activar «Browser rendering: SSH».
7. code-server: `brew install code-server`, configurar `~/.config/code-server/config.yaml` con `bind-addr: 127.0.0.1:8443` y `auth: none` (Access ya autentica), `brew services start code-server`.
8. `tmux` con `set -g mouse on` en `~/.tmux.conf`.
9. **Prueba de cierre** 🖐: la persona desconecta el monitor, corta la corriente un minuto, la vuelve a dar y, desde el móvil con datos (no desde casa), abre `code.tudominio` y la terminal SSH del navegador. Si entra y `uptime` es reciente, la fase A está cerrada.

## Fase B · Plataforma

1. `brew install colima docker docker-compose`. `colima start --cpu 4 --memory 8 --disk 100 --vm-type vz --mount-type virtiofs`. `brew services start colima`. `docker context use colima`. Comprobar `docker run --rm hello-world`.
2. Escribir en el repo, en la raíz:
   - `Dockerfile`: `node:24-bookworm-slim`, `corepack enable`, `pnpm install --frozen-lockfile` en `/app` (con el repo montado encima en desarrollo, `node_modules` en volumen con nombre), CLI `@anthropic-ai/claude-code` y `@openai/codex` globales, cliente `docker` (`docker-ce-cli`), usuario no root.
   - `compose.yaml` con los servicios de la diapositiva 10 del plan: `postgres`, `api`, `web-build`, `evidence-db`, `collector`, `ingestor`, `phoenix`, `metabase`. Puertos solo en `127.0.0.1`. `restart: unless-stopped`, healthchecks, `depends_on: condition: service_healthy`. Volúmenes: `pgdata`, `node_modules`, `web-dist`, `agent-sessions`, `cli-auth`, `evidence-data`, `evidence-archive`, `evidence-queue`, `evidence-metabase`. Socket de Docker montado en `api`.
   - `api` arranca con `node --watch packages/api/src/main.ts`; `web-build` con `pnpm --filter @demiurgo/web exec vite build --watch`. Ambos con el repo montado en `/app`.
   - Ajustar el ingestor para escuchar en `0.0.0.0` (`DEMIURGO_EVIDENCE_HOST`) y el colector para exportar a `http://ingestor:4319`.
   - `.env.example` con todas las variables de la diapositiva 12 y `.env` real fuera de Git.
3. Retirar `compose.dev.yaml`, `compose.instance.yaml` y `compose.evidence.yaml`, el script `db:up` y adaptar los scripts `evidence:*` de `package.json` al compose único. Cambiar el valor por defecto de `DEMIURGO_TEST_DB_URL` en `packages/core/test/support/global-setup.ts` al Postgres de 55433. Actualizar CLAUDE.md, AGENTS.md y `docs/observabilidad.md` (puertos y forma de relanzar).
4. `docker compose up -d --build --wait`. Comprobar `docker compose ps` todo `healthy`, `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8100/api/session` devuelve 401, `pnpm evidence migrate` y `pnpm evidence metabase-setup` con `docker compose run --rm`.
5. **Prueba de cierre**: `sudo reboot`. Tras volver a entrar, sin abrir ninguna terminal más, `docker compose ps` muestra todos los servicios sanos y `demiurgo.tudominio` muestra la pantalla de login de DEMIURGO 🖐 (la persona lo confirma desde el navegador).

## Fase C · Desarrollo

1. `pnpm install` en el host (para `gate:types`, `gate:test` y las herramientas). `pnpm gate:types` en verde.
2. `pnpm gate:test` contra `DEMIURGO_TEST_DB_URL=postgres://demiurgo:<secreto>@127.0.0.1:55433/postgres`. Si alguna prueba falla por el entorno, anotarlo en la bitácora; no cambiar pruebas para que pasen.
3. Codex interactivo: `npm install -g @openai/codex`; 🖐 `codex login --device-auth`, la persona completa en su navegador.
4. Proveedores dentro del contenedor: `docker compose exec api claude` y `docker compose exec api codex login --device-auth`; 🖐 la persona completa ambos logins en el navegador. Comprobar que la web, en Models & providers, descubre Claude y Codex. No lanzar ninguna ejecución real.
5. Comprobar `SSE` a través de Cloudflare: abrir el diario en vivo en `demiurgo.tudominio` y esperar dos minutos; si la conexión se corta a los 100 s, añadir un keepalive de comentario cada 30 s en la ruta SSE de `packages/api` y commitear.
6. Comprobar `Host`/`Origin`: iniciar sesión en `demiurgo.tudominio` y ejecutar un comando cualquiera (crear un proyecto de prueba). Si la API rechaza, ajustar `DEMIURGO_ORIGINS` o el `trust proxy` de Fastify y commitear.
7. **Prueba de cierre**: editar un texto de `packages/web` y un texto de una respuesta de `packages/api`, y verlos en `demiurgo.tudominio` sin ningún `docker compose` de por medio 🖐 (la persona lo confirma). Deshacer los dos cambios.

## Fase D · Datos

1. 🖐 En el PC, con Docker Desktop arrancado, la persona ejecuta el volcado que Claude le dicta (`docker exec <postgres-55433> pg_dump -Fc -U demiurgo demiurgo_v2 > demiurgo_v2.dump`, y lo mismo para `demiurgo_evidence` y `phoenix`) y los copia al mini con `scp <fichero> mini:~/restore/`. Antes, la persona para la API 8100 y el ingestor en el PC.
2. Ensayo: restaurar cada volcado en una base `dmg_t_restore_*`, arrancar una API temporal contra ella en otro puerto, comprobar migraciones y conteo de `events`. Tirar la base de ensayo.
3. 🖐 Confirmación explícita de la persona para el corte. Restaurar en `demiurgo_v2`, `demiurgo_evidence` y `phoenix` reales. `docker compose restart api ingestor`. Comprobar por el dominio que los proyectos y los hilos están.
4. Copias: script `~/bin/backup.sh` (dumps `-Fc` de las tres bases + `restic` del repo, `.env`, `~/.claude`, `~/.codex`, `~/.ssh`) y un LaunchAgent diario a las 03:00. 🖐 La persona indica el destino: disco USB cifrado y bucket remoto con sus credenciales.
5. **Prueba de cierre**: restaurar el último backup en una base de ensayo y arrancar contra ella. Anotar en la bitácora cuánto tarda.

## Fase E · Limpieza

1. Commit final con los compose viejos borrados, CLAUDE.md y AGENTS.md actualizados (dónde vive la instancia, cómo se relanza con `docker compose`, puertos).
2. 🖐 En el PC: parar y no volver a arrancar las instancias; desinstalar Docker Desktop si se quiere.
3. Decidir si `demiurgo` conserva `sudo`. Si se le quita, dejar `admin` para actualizaciones.
4. Cerrar la bitácora con la lista de hostnames, puertos, dónde están los secretos, cómo se hace un backup y una restauración, y qué pasa si el mini falla.

## Prompt para pegar en Claude Code en el mini

```
Lee docs/homelab-macmini-plan.md y docs/homelab-macmini-runbook.md y ejecuta el runbook fase por fase, empezando por la A.
Trabaja de forma autónoma en este Mac mini. Cuando un paso lleve 🖐, para y dime exactamente qué tengo que hacer en mi navegador o en mi PC y qué te tengo que devolver; no sigas hasta que te lo dé.
Mi dominio es <tudominio>. La URL del repositorio es <url>. Mi correo para Cloudflare Access es <correo>.
No migres datos ni lances ninguna ejecución real con Claude o Codex sin que te lo confirme en ese momento. No toques demiurgo-stable ni el puerto 8000.
Al cerrar cada fase, apunta en docs/homelab-macmini-bitacora.md lo que has hecho y commitea y sube a origin v2.2.
```
