#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"
BACKUP_DIR="${ROOT_DIR}/db-backups"

mkdir -p "${BACKUP_DIR}"

TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
ARCHIVE_PATH="${BACKUP_DIR}/devata-${TIMESTAMP}.sql.gz"

POSTGRES_USER="${POSTGRES_USER:-devata}"
POSTGRES_DB="${POSTGRES_DB:-devata}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker CLI не найден" >&2
  exit 1
fi

# Используем compose из каталога infra, чтобы не зависеть от текущей директории
cd "${ROOT_DIR}"

# Выполняем pg_dump внутри контейнера db и архивируем вывод
if ! docker compose -f "${COMPOSE_FILE}" ps db >/dev/null 2>&1; then
  echo "Контейнер db не запущен" >&2
  exit 1
fi

docker compose -f "${COMPOSE_FILE}" exec -T db pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${ARCHIVE_PATH}"

# Храним максимум 14 архивов, старые удаляем
ls -1t "${BACKUP_DIR}"/devata-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --

echo "Резервная копия сохранена: ${ARCHIVE_PATH}"
