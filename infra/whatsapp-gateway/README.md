# DEVATA WhatsApp Gateway (заглушка)

> Обновлено: 2025-08-27
>
> Этот сервис представляет собой минимальный каркас собственного WhatsApp-шлюза DEVATA. Он не подключается к WhatsApp напрямую, но
> реализует REST-контракты, авторизацию и пересылку входящих сообщений в n8n. После подключения Baileys (или другого клиента
> WhatsApp) достаточно заменить заглушки отправки/приёма на реальные вызовы API.

## Возможности

- `POST /send` — защищённый эндпоинт для n8n, принимает текстовые сообщения и ставит их в очередь (пока только логирует).
- `POST /simulate/inbound` — вспомогательный маршрут для имитации входящих сообщений и тестирования цепочки до n8n.
- `GET /healthz` — проверка здоровья для Caddy/UptimeRobot.
- Простейший лимитер (по номеру) — не более N сообщений в минуту (по умолчанию 20).
- Подпись HMAC `x-signature` при отправке событий в n8n.

## Переменные окружения

| Название | Описание |
| --- | --- |
| `PORT` | Порт HTTP (по умолчанию 8080). |
| `OUTBOUND_TOKEN` | Токен для авторизации `POST /send` (формат Bearer). |
| `INBOUND_WEBHOOK_URL` | URL вебхука n8n, куда шлюз пересылает входящие сообщения. |
| `INBOUND_WEBHOOK_SECRET` | Секрет для расчёта HMAC заголовка `x-signature`. |
| `SIMULATION_TOKEN` | Дополнительный токен для доступа к `POST /simulate/inbound` (заголовок `x-simulation-token`). |
| `RATE_LIMIT_PER_MINUTE` | Лимит исходящих сообщений на контакт в минуту (минимум 1, дефолт 20). |

## Локальный запуск

```bash
cd infra/whatsapp-gateway
npm start
```

Пример запроса в `POST /send`:

```bash
curl -X POST http://localhost:8080/send \
  -H "Authorization: Bearer DEVATA-TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+79990000000",
    "message": "Здравствуйте! Ваша запись подтверждена",
    "metadata": { "bookingId": "demo-123" }
  }'
```

Пример имитации входящего сообщения (с пересылкой в n8n):

```bash
curl -X POST http://localhost:8080/simulate/inbound \
  -H "Content-Type: application/json" \
  -H "x-simulation-token: DEVATA-SIM" \
  -d '{
    "from": "+79990000000",
    "message": "Добрый день! Подтвердите, пожалуйста, время.",
    "raw": { "source": "manual-test" }
  }'
```

Если `INBOUND_WEBHOOK_URL` не задан, сервис оставит предупреждение в логах и не будет пытаться отправить событие.

## Интеграция с docker-compose

Добавьте сервис в `infra/docker-compose.yml` и проксируйте его через Caddy на домен `wa.devata.ru`. Пример:

```yaml
  wa_gateway:
    build: ./whatsapp-gateway
    restart: unless-stopped
    environment:
      - PORT=8080
      - OUTBOUND_TOKEN=замените-на-токен
      - INBOUND_WEBHOOK_URL=https://sobacuruskneel.beget.app/webhook/devata/wa-inbound
      - INBOUND_WEBHOOK_SECRET=замените-на-hmac
      - SIMULATION_TOKEN=замените-на-тестовый
```

Затем в `reverse-proxy/Caddyfile` добавьте блок:

```caddy
wa.devata.ru {
  encode zstd gzip
  reverse_proxy wa_gateway:8080
}
```

Сервис не требует сборки и внешних зависимостей: достаточно Node.js 20+. После замены заглушек на реальный клиент WhatsApp (Baileys/Meta Cloud API) сохраняются те же REST-контракты, поэтому n8n и остальная инфраструктура не требуют изменений.
