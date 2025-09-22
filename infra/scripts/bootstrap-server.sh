#!/usr/bin/env bash
set -euo pipefail
set -o pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "[bootstrap] Требуются права root. Запустите скрипт через sudo или от root." >&2
  exit 1
fi

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"
}

ensure_directory() {
  local dir="$1"
  if [[ ! -d "$dir" ]]; then
    mkdir -p "$dir"
  fi
}

log "Обновляю индекс пакетов"
apt-get update

log "Устанавливаю базовые зависимости (ca-certificates, curl, gnupg, ufw)"
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg ufw

log "Настраиваю keyring Docker"
ensure_directory /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi

log "Подключаю репозиторий Docker"
if [[ ! -f /etc/apt/sources.list.d/docker.list ]]; then
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
fi

log "Обновляю индекс пакетов (Docker repo)"
apt-get update

log "Устанавливаю docker-ce, docker-compose-plugin и сопутствующие"
DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

log "Включаю и запускаю службу docker"
systemctl enable docker
systemctl start docker

if [[ -n "${SUDO_USER:-}" ]]; then
  if id -nG "${SUDO_USER}" | tr ' ' '\n' | grep -qx 'docker'; then
    log "Пользователь ${SUDO_USER} уже состоит в группе docker"
  else
    log "Добавляю пользователя ${SUDO_USER} в группу docker"
    usermod -aG docker "${SUDO_USER}"
  fi
else
  log "Запустите 'usermod -aG docker <user>' для доступа без sudo при необходимости"
fi

log "Настраиваю UFW (22/80/443)"
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

log "Создаю базовые каталоги проекта DEVATA"
BASE_DIR="/opt/devata"
ensure_directory "$BASE_DIR"
ensure_directory "$BASE_DIR/db-backups"

log "Bootstrap завершён"
cat <<'MSG'

[bootstrap] Базовая настройка завершена.

Дальнейшие шаги:
1. Склонируйте репозиторий DEVATA или загрузите каталог infra в /opt/devata.
2. Выполните `docker compose up -d --build` из каталога infra.
3. Повторно войдите в систему, чтобы применились права группы docker (если добавлены).

MSG
