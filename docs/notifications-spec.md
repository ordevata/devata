# DEVATA Notification Stack — Email, Telegram, WhatsApp

> Обновлено: 2025-08-27
>
> Документ описывает архитектуру и технические детали реализации каскадных уведомлений DEVATA через n8n. Каналы: email, Telegram и WhatsApp (через собственный шлюз). Ориентирован на этапы 2–4 дорожной карты.

## 1. Цели
- Обеспечить гарантированную доставку транзакционных сообщений (подтверждение брони, напоминания, отмены, платежи).
- Использовать каскадную схему: если приоритетный канал недоступен, автоматически переключаться на следующий.
- Собирать журнал уведомлений для аудита и SLA.
- Минимизировать эксплуатационные затраты за счёт n8n и собственного WhatsApp-шлюза.

## 2. Общая архитектура
```
DEVATA API → Webhook → n8n → Каналы (SMTP, Telegram Bot API, WhatsApp Gateway)
```

- Каждый канал оформлен отдельным node в n8n.
- Фолбэки реализуются через IF / Switch ноды и глобальный сервис конфигурации.
- Вебхуки API подписывают payload HMAC-SHA256 (секрет `N8N_WEBHOOK_SECRET`). n8n проверяет подпись в первой ноде Function.
- WhatsApp обрабатывается отдельным микросервисом `infra/whatsapp-gateway` (Fastify), который в текущей версии выступает заглушкой:
  - `POST /send` принимает сообщения от n8n и логирует их (позже добавим отправку через Baileys/Cloud API).
  - `POST /simulate/inbound` имитирует входящие события и пересылает их в n8n с подписью `x-signature`.
  - `GET /healthz` используется для проверок Caddy и мониторинга.
  - Авторизация — токен в заголовке `Authorization: Bearer ...`, плюс ограничение по числу сообщений в минуту.
- Все отправленные сообщения логируются в Google Sheets `Notifications` и в Supabase таблицу `notification_logs` (через HTTP Request node в API).

### 2.1 Приоритет каналов
1. WhatsApp (если у клиента есть `wa_jid` и шлюз онлайн).
2. Telegram (если есть `tg_chat_id`).
3. Email (всегда как fallback).

Конфигурация хранится в Supabase таблице `notification_preferences` и кэшируется Redisом API (ttl 5 минут). n8n читает настройки через HTTP Request к `GET /internal/notification-preferences/{personId}`.

## 3. Типы уведомлений
| Код | Событие | Источник | Каналы | SLA |
|-----|---------|----------|--------|-----|
| booking.created | Новая бронь | API → Webhook | WA → TG → Email | мгновенно |
| booking.reminder | T-24h / T-2h / T-15m | n8n cron → API | WA → TG → Email | в заданный слот |
| booking.cancelled | Отмена | API → Webhook | TG → Email | мгновенно |
| payment.deposit_required | Запрос депозита | API → Webhook | Email → WA | мгновенно |
| payment.deposit_paid | Депозит получен | API → Webhook | Email → TG | мгновенно |
| payment.expired | Депозит просрочен | API → Webhook | WA → Email | ≤ 5 минут |

Дополнительно: internal alerts (`wa_gateway.down`, `smtp.fail`, `telegram.fail`) идут в Telegram канал администраторов.

## 4. n8n Workflows
Экспорт workflow лежит в `n8n/workflows/`:
- `booking-confirmation.json`
- `booking-reminders.json`
- `deposit-expired.json`

Каждый workflow использует общий набор cred:
- `SMTP_DEVATA`
- `TELEGRAM_DEVATA_BOT`
- `WA_GATEWAY` (HTTP Request с header `Authorization: Bearer <token>`)
- `SUPABASE_SERVICE_ROLE`

### 4.1 Общие переменные
- `meta.event` — тип события (string).
- `meta.attempt` — номер попытки.
- `customer` — объект клиента (получаем из API).
- `message` — сформированный текст + payload.

### 4.2 Шаблоны сообщений
Шаблоны лежат в Supabase таблице `notification_templates` (по коду события и каналу). n8n берёт актуальную версию через HTTP GET:
`GET /internal/notification-templates?event=booking.created&channel=whatsapp`

Ответ (пример):
```json
{
  "subject": "DEVATA: запись подтверждена",
  "body": "Здравствуйте, {{name}}! Ваша запись {{date}} в {{time}} подтверждена."
}
```

n8n подставляет переменные через Handlebars Function.

## 5. WhatsApp Gateway
- Отдельный контейнер `wa-gateway` (Node.js + Baileys) за Caddy.
- API:
  - `POST /send` — отправка сообщений. Тело: `{ "to": "<jid>", "type": "text", "text": { "body": "..." }, "meta": { ... } }`
  - `GET /healthz` — состояние сессии.
  - `POST /webhook` — входящие сообщения → n8n.
- Аутентификация: n8n отправляет `Authorization: Bearer <WA_GATEWAY_TOKEN>`. Шлюз шлёт в n8n `X-Signature: HMAC_SHA256(body, WA_WEBHOOK_SECRET)`.
- Храним message_id и статус (sent, delivered, failed). При ошибке шлюз возвращает код и причину — n8n записывает в журнал и пробует следующий канал.

## 6. Логирование и SLA
- В n8n каждая отправка завершает workflow node `Set → NotificationLog`, который формирует объект:
```json
{
  "event": "booking.created",
  "person_id": "...",
  "channel": "whatsapp",
  "status": "sent",
  "attempt": 1,
  "error": null,
  "sent_at": "2025-08-27T12:15:00Z"
}
```
- Далее HTTP Request `POST /internal/notification-logs` (идемпотентность по `event + person_id + channel + sent_at`).
- Параллельно пишем строку в Google Sheet `Notifications` (для быстрых проверок).

## 7. Мониторинг
- n8n Cron каждые 5 минут проверяет `wa-gateway` через `/healthz`. При падении → Telegram alert + автоматический фолбэк на TG/email.
- SMTP/Telegram ошибки ловим через `Continue On Fail` + ветку alert.
- SLA считается в Supabase (materialized view) и выводится в админке: процент доставленных вовремя за 24 часа.

## 8. Пошаговое внедрение
1. Настроить креды в n8n.
2. Импортировать workflows из `n8n/workflows/`.
3. Создать таблицы в Supabase (`notification_preferences`, `notification_templates`, `notification_logs`).
4. Подключить вебхуки API к workflow `booking-confirmation` и `deposit-expired`.
5. Запустить cron `booking-reminders`.
6. Протестировать фолбэки: временно отключить WA-шлюз и убедиться, что уведомление ушло в Telegram/email.

## 9. Чек-лист готовности
- [ ] Импортированы все workflow и активированы.
- [ ] n8n проверяет HMAC подпись входящих вебхуков.
- [ ] Шлюз WhatsApp авторизован и проходит health-check.
- [ ] Шаблоны сообщений утверждены и загружены в Supabase.
- [ ] Журнал уведомлений пополняется и доступен в админке.
- [ ] Настроены алерты при сбое любого канала.

Документ покрывает MVP-реализацию. Расширения (push-уведомления, SMS) можно добавить в этот же каскад, подключив новые ноды и обновив таблицу приоритетов.
