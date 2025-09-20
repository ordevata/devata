# DEVATA Infrastructure Starter

Минимальный комплект файлов для быстрого запуска backend-окружения DEVATA на отдельном сервере. Стек соответствует дорожной карте: Caddy как обратный прокси с авто-HTTPS, демо-API на Node.js, PostgreSQL и Redis в Docker-контейнерах.

## Требования
- Ubuntu 22.04+ с установленными `docker` и `docker compose` (плагины из официального репозитория Docker).
- DNS-запись `api.devata.ru`, указывающая на IP сервера.
- Порты 80 и 443 открыты во внешнюю сеть.

## Структура каталога
```
infra/
├── api/                # демо-API (Express)
├── db-backups/         # каталог для архивов pg_dump (оставьте пустым, .gitkeep)
├── reverse-proxy/      # конфигурация Caddy
├── scripts/            # утилиты обслуживания (backup-db.sh)
└── docker-compose.yml  # основной стек сервисов
```

## Запуск
```bash
cd infra
# Собираем и запускаем контейнеры в фоне
docker compose up -d --build

# Проверяем статус
docker compose ps
```
После успешного запуска маршрут `https://api.devata.ru/healthz` возвращает JSON `{ "ok": true }`.

## Обновление демо-API
Файлы в `infra/api` представляют простой Express-сервер. Замените их на реальную реализацию (NestJS, FastAPI и т.д.), или укажите готовый образ в `docker-compose.yml` через `image: your-registry/devata-api:tag`.

Во время разработки можно собрать новый образ так:
```bash
cd infra
docker compose build api
# затем перезапустить только сервис API
docker compose up -d api
```

## Переменные окружения
По умолчанию контейнер API получает строку подключения к Postgres и Redis:
- `DATABASE_URL=postgresql://devata:devata@db:5432/devata`
- `REDIS_URL=redis://redis:6379`

Подставьте собственные значения, создав файл `.env` рядом с `docker-compose.yml` и подключив его через `env_file`.

## Резервное копирование БД
Скрипт `scripts/backup-db.sh` создаёт архив `pg_dump` и хранит последние 14 копий:
```bash
cd infra
./scripts/backup-db.sh
```
Рекомендуется добавить задачу cron, например:
```
17 2 * * * /path/to/infra/scripts/backup-db.sh >/dev/null 2>&1
```

Архивы помещаются в `infra/db-backups/`. Каталог присутствует в репозитории только с `.gitkeep`, поэтому боевые дампы не попадут в git.

## Остановка и обновления
```bash
cd infra
# Корректная остановка
docker compose down

# Обновление образов Docker Hub и перезапуск
docker compose pull
docker compose up -d
```

## Безопасность и наблюдаемость
- Caddy автоматически выпустит сертификат Let's Encrypt, когда DNS уже направлен на сервер.
- Дополнительно настройте UFW/iptables (`22`, `80`, `443`).
- Подключите мониторинг (UptimeRobot, BetterUptime) к эндпоинту `/healthz`.
- Логи контейнеров доступны через `docker compose logs -f <service>`.
