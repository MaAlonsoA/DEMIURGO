# Imagen única de DEMIURGO para el homelab (docs/homelab-macmini-plan.md, diapositivas 10 y 12).
# La usan los servicios `api`, `web-build` e `ingestor` de compose.yaml. El repo se monta encima de
# /app en desarrollo, así que aquí solo se instalan las dependencias: node_modules va en un volumen
# con nombre que Docker rellena desde la imagen la primera vez. No lleva secretos ni .env.
FROM node:24-bookworm-slim

ARG UID=501
ARG GID=501

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    # El almacén de pnpm vive dentro del volumen de node_modules: mismo sistema de ficheros, hardlinks.
    npm_config_store_dir=/app/node_modules/.pnpm-store \
    # Credenciales de las CLI de los proveedores, en el volumen cli-auth (plan, diapositiva 14).
    CLAUDE_CONFIG_DIR=/var/lib/demiurgo/cli-auth/claude \
    CODEX_HOME=/var/lib/demiurgo/cli-auth/codex \
    DEMIURGO_AGENT_SESSIONS_DIR=/var/lib/demiurgo/sessions

# Herramientas del sistema y el cliente de Docker (el runner de packages/core lanza contenedores).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git gnupg procps tini util-linux \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli \
 && rm -rf /var/lib/apt/lists/*

# pnpm por corepack (la versión la fija package.json) y las CLI de Claude y Codex para Linux, siempre
# en su última versión: cada build descarga la ficha de la última versión publicada en npm, y cuando
# cambia invalida la capa de abajo, así que `pnpm stack:up` las actualiza en cuanto sale una nueva
# (sin esto, Docker reutilizaba la capa y se quedaban en la versión del primer build).
ADD https://registry.npmjs.org/@anthropic-ai/claude-code/latest /tmp/cli-latest/claude-code.json
ADD https://registry.npmjs.org/@openai/codex/latest /tmp/cli-latest/codex.json
RUN corepack enable \
 && npm install -g @anthropic-ai/claude-code@latest @openai/codex@latest \
 && npm cache clean --force

# Usuario no root con el mismo uid que la cuenta del mini, para poder escribir en el repo montado.
RUN groupadd -g "${GID}" demiurgo \
 && useradd -m -u "${UID}" -g "${GID}" -s /bin/bash demiurgo \
 && mkdir -p /app /var/lib/demiurgo/sessions /var/lib/demiurgo/cli-auth \
 && chown -R demiurgo:demiurgo /app /var/lib/demiurgo

COPY docker/entrypoint.sh /usr/local/bin/demiurgo-entrypoint
RUN chmod 755 /usr/local/bin/demiurgo-entrypoint

WORKDIR /app
USER demiurgo

# Solo los manifiestos: bastan para instalar y así el código no invalida esta capa.
COPY --chown=demiurgo:demiurgo package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=demiurgo:demiurgo packages/api/package.json packages/api/
COPY --chown=demiurgo:demiurgo packages/core/package.json packages/core/
COPY --chown=demiurgo:demiurgo packages/design/package.json packages/design/
COPY --chown=demiurgo:demiurgo packages/design-system/package.json packages/design-system/
COPY --chown=demiurgo:demiurgo packages/domain/package.json packages/domain/
COPY --chown=demiurgo:demiurgo packages/evidence/package.json packages/evidence/
COPY --chown=demiurgo:demiurgo packages/mcp/package.json packages/mcp/
COPY --chown=demiurgo:demiurgo packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile
# El volumen web-dist nace de esta carpeta: Docker copia su propietario (demiurgo) al crearlo, y así
# web-build puede escribir en él.
RUN mkdir -p packages/web/dist

ENTRYPOINT ["tini", "--", "demiurgo-entrypoint"]
CMD ["node", "--watch", "packages/api/src/main.ts"]
