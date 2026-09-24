#!/bin/sh
set -e

# Volumes de plataformas como Railway e Render são montados como root. O contêiner
# inicia como root apenas para ajustar a pasta do banco e em seguida roda como "node".
if [ "$(id -u)" = "0" ]; then
  dir="$(dirname "${DB_PATH:-/app/data/gestao.db}")"
  mkdir -p "$dir"
  chown -R node:node "$dir"
  exec su-exec node "$@"
fi

exec "$@"
