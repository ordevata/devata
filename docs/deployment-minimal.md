# DEVATA Minimal Deployment Guide

> Обновлено: 2025-08-27
>
> Цель этого руководства — поднять рабочее окружение DEVATA API на новом сервере за один вечер без сторонних зависимостей, используя минимальный стек Docker.

## 1. Подготовьте домены и DNS

1. В панели NIC.RU добавьте записи:
   - `app.devata.ru` → CNAME на домен проекта во Vercel (например, `cname.vercel-dns.com`).
   - `api.devata.ru` → A-запись на публичный IP вашего VPS.
2. Дождитесь распространения DNS (обычно 5–30 минут).

## 2. Минимальная конфигурация сервера

| Параметр | Значение |
| --- | --- |
| ОС | Ubuntu 22.04 LTS |
| CPU | 2 vCPU |
| RAM | 4 GB |
| Диск | 120 GB SSD |
| Открытые порты | 22 (SSH), 80, 443 |

Подключитесь по SSH пользователем с правами sudo и обновите систему:

```bash
sudo apt update && sudo apt -y upgrade
```

### 2.1 Установите Docker и плагин compose

```bash
sudo apt -y install ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

(Опционально) добавьте своего пользователя в группу `docker`:

```bash
sudo usermod -aG docker $USER
```

Выйдите и зайдите в SSH заново, чтобы группа применилась.

### 2.2 Настройте UFW

```bash
sudo apt -y install ufw
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

## 3. Разверните DEVATA стек

Склонируйте репозиторий или загрузите архив с каталогом `infra/`. Далее выполните:

```bash
cd infra
mkdir -p db-backups
# Соберите и запустите контейнеры
docker compose up -d --build
# Проверьте статус
docker compose ps
```

Caddy автоматически выпустит сертификат Let's Encrypt для `api.devata.ru`.

Проверка готовности:

```bash
curl -I https://api.devata.ru/healthz
```

Ответ должен содержать `200 OK` и JSON `{ "ok": true }`.

## 4. Настройте фронтенд (Vercel)

1. В проекте на Vercel установите переменную окружения `NEXT_PUBLIC_API_BASE=https://api.devata.ru`.
2. В разделе Domains добавьте `app.devata.ru` и следуйте инструкциям Vercel для DNS.
3. После деплоя убедитесь, что страница по адресу `https://app.devata.ru` загружается и обращается к API.

## 5. Подключите n8n

Пока DEVATA API работает в демо-режиме, можно настроить будущие вебхуки и уведомления:

- Регистрируйте события `booking.created`, `booking.canceled`, `payment.deposit_created`, `payment.deposit_paid` на стороне API (см. `docs/booking-spec.md`).
- В n8n создайте соответствующие вебхуки и подключите Email/Telegram ноды для подтверждений и напоминаний.
- При запуске реального API обновите URL вебхуков на `https://api.devata.ru/webhooks/...`.

## 6. Резервные копии базы данных

В каталоге `infra/scripts/` уже лежит `backup-db.sh`. Настройте ежедневный cron:

```bash
crontab -e
# Добавьте строку
17 2 * * * /home/<USER>/infra/scripts/backup-db.sh >/dev/null 2>&1
```

Скрипт сохраняет архивы `pg_dump` в `infra/db-backups/` и удаляет старше 14 файлов.

## 7. Безопасность и обслуживание

- Отключите SSH-вход по паролю (`PasswordAuthentication no`) и перезапустите `sshd`.
- Следите за обновлениями: `sudo apt update && sudo apt -y upgrade` хотя бы раз в неделю.
- Логи контейнеров просматривайте командой `docker compose logs -f <service>`.
- Настройте внешние алерты (UptimeRobot/BetterUptime) на `https://api.devata.ru/healthz`.

## 8. Обновление API в будущем

Чтобы заменить демо-реализацию на «боевой» сервис:

1. Обновите содержимое `infra/api/` (код, миграции) и соберите новый образ: `docker compose build api`.
2. Примените миграции (`npm --prefix infra/api run migrate` или `docker compose run --rm api npm run migrate`).
3. Перезапустите только API: `docker compose up -d api`.

## 9. Чек-лист готовности

- [ ] DNS для `app.devata.ru` и `api.devata.ru` активны.
- [ ] `https://api.devata.ru/healthz` отвечает 200.
- [ ] `https://app.devata.ru` использует новое API.
- [ ] Включен cron-бэкап и UFW.
- [ ] Настроены вебхуки в n8n и тестовые уведомления.

Готово! Минимальная инфраструктура DEVATA запущена и готова к дальнейшей разработке (этапы онлайн-записи, депозиты, партнёрка).
