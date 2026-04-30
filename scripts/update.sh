#!/usr/bin/env bash
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$dir"

docker compose pull sharkshell-postgres || true
docker compose build sharkshell

docker compose up -d

read -r -p "¿Quieres limpiar imágenes antiguas con docker image prune -f? [s/N]: " REPLY
if [[ "${REPLY,,}" == "s" || "${REPLY,,}" == "si" || "${REPLY,,}" == "y" || "${REPLY,,}" == "yes" ]]; then
  docker image prune -f
fi
