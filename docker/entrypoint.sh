#!/bin/sh
# Entrada de los contenedores de DEMIURGO (Dockerfile). El repo está montado en /app y node_modules es
# un volumen: los enlaces packages/*/node_modules del repo no existen la primera vez (o el lockfile
# cambió), así que se recrean desde el almacén del volumen, sin red. Un cerrojo evita que api,
# web-build e ingestor lo hagan a la vez.
set -eu
cd /app
if [ ! -e packages/api/node_modules ] || [ ! -e node_modules/.modules.yaml ]; then
  flock /app/node_modules/.demiurgo-install.lock sh -c \
    '[ -e packages/api/node_modules ] || pnpm install --frozen-lockfile --offline'
fi
if [ -z "${DEMIURGO_SERVICE_VERSION:-}" ]; then
  DEMIURGO_SERVICE_VERSION="$(git -c safe.directory=/app rev-parse --short HEAD 2>/dev/null || true)"
  export DEMIURGO_SERVICE_VERSION="${DEMIURGO_SERVICE_VERSION:-unknown}"
fi
exec "$@"
