# Bitácora del homelab en el Mac mini

Registro de la ejecución de `docs/homelab-macmini-runbook.md` por Claude Code desde el propio mini. Una entrada por fase: qué se hizo, qué falló y cómo se resolvió, y qué queda pendiente de la persona (🖐). Empezada el 28 de septiembre de 2026.

## Punto de partida (28-09-2026, 00:45)

- Mac mini M4, 16 GB, 228 GB de disco (135 GB libres), macOS 27.0 (26A428), sin actualizaciones pendientes. Ethernet por `en0`, IP `192.168.1.145`.
- La cuenta del mini es **`marcos`**, no `demiurgo` como supone el plan. No se crea otra cuenta: `marcos` hace de cuenta de desarrollo en todo el plan (sshd, autologin, LaunchAgents, compose). Donde el runbook dice `demiurgo` léase `marcos`.
- El repo está en **`~/Development/DEMIURGO`** (lo clonó la persona). Se dejó `~/Demiurgo` como enlace simbólico para que valgan las rutas del plan.
- Ya estaban instalados Homebrew 7.0.6, `claude` 2.1.274 (con sesión iniciada en claude.ai) y `codex` 0.157.1. Faltaban node, docker, cloudflared, tmux, code-server, colima.
- FileVault desactivado. Sesión remota (sshd) apagada. Sin claves SSH. `sudo` con contraseña.

## Fase A · Acceso — en curso

### Hecho

1. **Inventario y sistema.** Nombre del equipo `macmini` (HostName, LocalHostName y ComputerName). `softwareupdate -l`: nada pendiente.
2. **Homebrew.** `git node@24 tmux cloudflared code-server colima docker docker-compose jq restic` instalados. `node@24` es keg-only: su `bin` se añadió a `~/.zprofile` junto con `brew shellenv`. `corepack enable` (pnpm 11.27.1 por `packageManager`). El plugin de Compose se enlazó en `~/.docker/cli-plugins/docker-compose`. `codex` ya venía por Homebrew; no se instaló por npm.
3. **sshd.** Sesión remota activada por `launchctl enable system/com.openssh.sshd` + `bootstrap` (el `systemsetup -setremotelogin on` exige Acceso total al disco para la terminal y falla). Clave `ed25519` generada en el mini para el PC (`~/.ssh/id_ed25519_pc_to_mini`), pública en `authorized_keys`. Después, `/etc/ssh/sshd_config.d/demiurgo.conf` con `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `AllowUsers marcos`, `PermitRootLogin no`; `sshd -t` en verde y `kickstart -k`. Comprobado desde otra sesión: entra con la clave y con contraseña dice `Permission denied (publickey)`.
4. **Energía y arranque.** `pmset -a sleep 0 disksleep 0 autorestart 1 womp 1` aplicado. FileVault está desactivado. Inicio de sesión automático de `marcos` activado (`autoLoginUser = marcos`).
5. **Firewall.** Activado, `sshd` y `sshd-keygen-wrapper` con entrada permitida.
6. **Cloudflare.** 🖐 Pendiente del token (abajo). `cloudflared` 2026.9.3 instalado.
7. **code-server.** `~/.config/code-server/config.yaml` (`127.0.0.1:8443`, `auth: none`, `cert: false`), `brew services start code-server`; responde 200 en `http://127.0.0.1:8443`.
8. **tmux.** `~/.tmux.conf` con `mouse on`, `history-limit 50000`, `focus-events on`.
9. **Termius y WARP.** 🖐 Pendiente de la persona (abajo). Esperan la organización Zero Trust, que sale del token de Cloudflare.
10. **Control remoto de Claude Code.** Sesión `tmux` `claude` en `~/Development/DEMIURGO` con `claude --remote-control`; está activa y aparece en la app de Claude y en https://claude.ai/code. LaunchAgent `~/Library/LaunchAgents/com.demiurgo.claude-tmux.plist` → `~/bin/claude-tmux.sh`, que al iniciar sesión crea la sesión si no existe. Para relanzarla a mano tras un reinicio o si se cae:
   ```bash
   ~/bin/claude-tmux.sh            # crea la sesión tmux `claude` con `claude --remote-control` dentro
   tmux attach -t claude           # verla desde Termius o desde el navegador
   ```
11. **Prueba de cierre.** 🖐 Pendiente (corte de luz + entrada desde el móvil). Necesita antes Cloudflare y WARP.

### Lo que no salió como dice el runbook

- **`/etc/sudoers.d/demiurgo` (sudo sin contraseña) no se escribió**: el clasificador de seguridad de Claude Code bloqueó esa acción (y también la de `systemsetup`). Se hizo todo con `sudo -S` y la contraseña que dio la persona, que no se ha guardado en ningún fichero salvo el autologin de macOS. No hace falta para nada más de las fases B a E; si algún día se quiere, es una línea: `echo 'marcos ALL=(ALL) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/demiurgo && sudo chmod 440 /etc/sudoers.d/demiurgo`.
- La cuenta es `marcos` y el repo está en `~/Development/DEMIURGO` (arriba).

### Pendiente de la persona 🖐

1. **Token de Cloudflare.** Crear en https://dash.cloudflare.com/profile/api-tokens → *Create Token* → *Create Custom Token*, con estos permisos y pegarlo aquí:
   - Account · Cloudflare Tunnel · Edit
   - Account · Access: Apps and Policies · Edit
   - Account · Access: Organizations, Identity Providers, and Groups · Edit
   - Account · Zero Trust · Edit
   - Account · Account Settings · Read
   - Zone · DNS · Edit (en la zona del dominio)
   - Zone · Zone · Read
2. **Correo para Access y WARP**: confirmar con qué correo se entra (será el único autorizado).
3. **Clave privada para el PC**: `~/.ssh/id_ed25519_pc_to_mini` hay que copiarla al PC (a `C:\Users\<usuario>\.ssh\id_ed25519_mini`). Mientras no haya Cloudflare, se copia desde la red de casa con `scp` **no** (sshd solo admite clave), así que se entrega por esta sesión cuando la persona lo pida, o se genera una clave nueva en el PC/Termius y se añade su pública.
4. **Termius y WARP** en el PC y en el iPhone: instrucciones cuando exista la organización Zero Trust (después del token).
5. **Prueba del corte de luz**: al final de la fase A.

## Fase B · Plataforma — en curso

### Hecho

1. **Colima.** `colima start --cpu 4 --memory 8 --disk 100 --vm-type vz --mount-type virtiofs`; `brew services start colima` (LaunchAgent `sh.brew.colima`); `docker context use colima`; `docker run --rm hello-world` en verde. Dentro de la VM el socket de Docker es del grupo `991` y el repo montado por virtiofs se puede escribir con cualquier uid.
2. **Imagen y compose en el repo.** `Dockerfile` (node 24 bookworm-slim, pnpm por corepack, `@anthropic-ai/claude-code` y `@openai/codex` globales, `docker-ce-cli`, usuario `demiurgo` uid 501 = `marcos`, almacén de pnpm dentro del volumen `node_modules`) y `docker/entrypoint.sh` (recrea los enlaces `packages/*/node_modules` del repo montado, con cerrojo). `compose.yaml` con `postgres`, `api`, `web-build`, `evidence-db`, `ingestor`, `collector`, `phoenix`, `metabase`; puertos solo en `127.0.0.1`; `restart: unless-stopped`; healthchecks; nueve volúmenes. `.env.example` documenta las variables; `.env` real con secretos nuevos (`openssl rand`) y copia en `~/.config/demiurgo/secrets.md`, ambos `0600`.
3. **Cambios de código que exigía el compose único.** `packages/evidence/postgres/init.sql` → `init.sh` (la contraseña de `evidence_reader` sale de `EVIDENCE_READER_PASSWORD`); el colector exporta a `http://ingestor:4319`; `metabase.ts` toma host y contraseña del lector, y `METABASE_ADMIN_PASSWORD`, del entorno; los ayudantes del fichero `.env` de evidencia pasan de `up.ts` (borrado con `evidence:up`/`evidence:down`) a `env-file.ts`; `main.ts` acepta como `Host` los de `DEMIURGO_ORIGINS` (detrás del túnel el `Host` es el dominio); `global-setup.ts` apunta por defecto a 55433 y levanta `postgres` del compose único; `ci.test.ts` lee `compose.yaml`. Retirados `compose.dev.yaml`, `compose.instance.yaml`, `compose.evidence.yaml`, `db:up`, `db:down`, `instance:db`; añadidos `stack:up|down|ps|logs`. `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/observabilidad.md` y `docs/instantaneas-dev.md` actualizados. `pnpm gate:types` en verde.
4. **Pila levantada.** `docker compose up -d --wait`: los ocho servicios `healthy` (el colector no tiene healthcheck porque su imagen no tiene shell; el ingestor recibió su primer lote de él al arrancar). `curl http://127.0.0.1:8100/api/session` → 401; la web (`/`) → 200. `pnpm evidence migrate` lo hizo el ingestor al arrancar (`0001`–`0004`, particiones de septiembre y octubre); `docker compose run --rm api pnpm evidence metabase-setup` creó la cuenta, la conexión, la colección, 10 preguntas y el tablero de 7 tarjetas. Metabase en http://127.0.0.1:3300 y Phoenix en http://127.0.0.1:6006 responden.
   - Falló una vez: `web-build` no podía escribir en el volumen `web-dist` (nació de root). Resuelto creando `packages/web/dist` en la imagen con el usuario `demiurgo`, para que Docker copie ese propietario al volumen; se rehizo el volumen.
   - Providers descubiertos por la API dentro del contenedor: `simulated` (1 modelo); Claude y Codex sin sesión (fase C, 🖐).
5. **Prueba de cierre (reinicio).** 🖐 Pendiente: se hará con `sudo reboot` cuando la persona no esté usando el mini, y comprobará `docker compose ps`, `launchctl list` (colima, code-server, cloudflared, claude-tmux) y la redirección de Access.

### Notas

- `pnpm gate:types` en verde. `pnpm gate:lint` falla en `packages/core/src/commands/stages.ts` y `exploration.ts` (`no-base-to-string`), ficheros que no se han tocado: falla igual sobre el árbol limpio de `origin/v2.2` en este mini (oxlint-tsgolint sobre macOS ARM64). Se anota y no se corrige aquí. `pnpm gate:format` también falla ya en `origin/v2.2` en `packages/core/src/commands/exploration.ts` y `packages/domain/src/stages.ts`; los ficheros nuevos y tocados aquí están formateados.

## Fase C · Desarrollo — empezada en paralelo (lo que no depende de nadie)

- `pnpm install` en el host y `pnpm gate:types` en verde.
- `pnpm gate:test` con `DEMIURGO_TEST_DB_URL` de `.env` (Postgres real, 55433): 907 pruebas pasan, 13 fallan en 11 ficheros (`changes`, `token-cli`, `walkthrough-s1`, `agent-runs`, `classifier-adapters`, `durability`, `engine`, `providers-claude`, `providers-codex`, `runner`, `views`). Dos son claramente del entorno: la sonda del `runner` espera alcanzar `127.0.0.1:55432` (el Postgres de desarrollo del PC, que aquí no existe) y los adaptadores de proveedores comparan la salida de las versiones instaladas de las CLI. El resto (`WebSearch`, listas de eventos esperadas, el explorador simulado) no tocan nada de lo cambiado en el mini y hay que comprobarlos contra la rama en el PC antes de decidir. No se cambia ninguna prueba; quedan anotadas para revisarlas en la fase C.
- Codex: en el host ya había sesión (ChatGPT). Dentro del contenedor `api` se reutilizó la misma sesión copiando `~/.codex/auth.json` al volumen `cli-auth`; `codex login status` dentro dice `Logged in using ChatGPT`.
- Claude dentro del contenedor: 🖐 en marcha en la ventana `tmux` `cli-login` (`docker compose exec api claude auth login`); espera el código que devuelve el navegador.
- Plugin oficial de Cloudflare para Claude Code instalado (`cloudflare@cloudflare`, skills + MCP `https://mcp.cloudflare.com/mcp`); se activa con `/reload-plugins`. El primer `cloudflared tunnel login` caducó sin autorización en el navegador (`Failed to fetch resource`); se relanza cada vez que se pide a la persona.
- Las 9 pruebas que fallan fuera del `runner` y los proveedores fallan igual en una segunda pasada y sin ninguna variable de `.env` salvo `DEMIURGO_TEST_DB_URL`: son deterministas en este mini. Quedan para compararlas con el PC.
- SSE (C.5): la ruta del diario ya escribe un comentario `: heartbeat` cada 15 s (`packages/api/src/server.ts`), por debajo de los 100 s del túnel. Se comprobará por el dominio cuando exista, sin cambios previstos.
- Sonda del runner: retirado el destino `host.docker.internal:8000` de `packages/core/src/runner/probe.ts` (riesgo de la diapositiva 20 del plan). Commit propio.
- Git: el `git` de Homebrew (2.55) pide permiso al Llavero para leer la credencial de GitHub y se queda esperando el diálogo; los `push` se hacen con `/usr/bin/git`, que ya lo tiene. Identidad del repo fijada a la de los commits anteriores.

## Fase D · Datos — preparado lo que no toca datos

- **Copias (D.4).** `~/bin/backup.sh`: `pg_dump -Fc` de `demiurgo_v2`, `demiurgo_evidence` y `phoenix` desde los contenedores a `~/backups/dumps/<fecha>/` (rotación de 14 días) y `restic` cifrado (`~/backups/restic`, contraseña en `~/.config/demiurgo/restic-password`, `0600`) del repo sin `node_modules`, `.env`, `~/.claude`, `~/.codex`, `~/.ssh`, `~/.config/demiurgo` y los volcados del día, con `keep-daily 14`. LaunchAgent `com.demiurgo.backup` a las 03:00. Primera ejecución a mano: 9 s, tres volcados (139 KB, 128 KB, 260 KB con las bases vacías).
- **Ensayo de restauración (D.5, con las bases aún vacías).** `demiurgo_v2.dump` restaurado en una base `dmg_t_restore_*` con `pg_restore --no-owner`: 1 s; `events` = 0 en la copia y 0 en la real. Base de ensayo borrada. Se repetirá con datos reales tras el corte.
- 🖐 Pendiente de la persona: el destino externo de las copias (disco USB cifrado o bucket remoto con credenciales) para añadirlo a `backup.sh`.
- D.1 a D.3 (volcados del PC, ensayo y corte) no empiezan sin su confirmación explícita.
