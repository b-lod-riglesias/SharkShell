#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

action="${1:-create}"
BACKUP_DIR="$ROOT_DIR/backups"
DATA_DIR="$ROOT_DIR/data"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
ARCHIVE="$BACKUP_DIR/sharkshell-data-${TIMESTAMP}.tar.gz"

case "$action" in
  create)
    tar --exclude='*/.DS_Store' -czf "$ARCHIVE" -C "$ROOT_DIR" data
    chmod 600 "$ARCHIVE"
    echo "Backup creado: $ARCHIVE"
    ;;
  restore)
    if [[ -z "${2:-}" ]]; then
      echo "Uso: $0 restore /ruta/a/backups/sharkshell-data-YYYYmmdd-HHMMSS.tar.gz"
      exit 1
    fi
    tar -xzf "$2" -C "$ROOT_DIR"
    echo "Restore aplicado desde $2"
    echo "Importante: primero detén los servicios (scripts/stop.sh) y valida la restauración antes de poner en servicio."
    ;;
  *)
    echo "Uso: $0 [create|restore] [archivo.tar.gz]"
    exit 1
    ;;
esac

# Limpieza de backups antiguos
find "$BACKUP_DIR" -type f -name 'sharkshell-data-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
