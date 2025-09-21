# DEVATA Booking MVP — Этап 2 Техническая спецификация

Дата обновления: 2025-08-27

## 1. Цели этапа
- Запустить собственную систему онлайн-записи без оплаты.
- Обеспечить корректную работу расписаний, исключений и броней без гонок.
- Подготовить API, на которое будут опираться фронтенд, кабинеты и n8n.

## 2. Сценарии использования
### 2.1 Клиент
1. Выбирает центр (филиал).
2. Выбирает услугу → получает список подходящих специалистов.
3. Открывает календарь доступных слотов → выбирает дату/время.
4. Заполняет форму (ФИО, телефон, email, комментарий).
5. Получает подтверждение (email + Telegram; позже WhatsApp).

### 2.2 Специалист
1. Просматривает «Мои визиты сегодня/неделя» и статус каждого клиента.
2. Отмечает приход клиента (check-in) и оставляет заметку.
3. При необходимости переносит визит или назначает follow-up.
4. Управляет своим расписанием: шаблонные смены + исключения (отпуск, больничный).

### 2.3 Администратор
1. Создает центры, услуги, специалистов, назначает специализации.
2. Настраивает шаблоны расписания (правила повторения) для специалистов.
3. Задает исключения (перерывы, выходные, отпуск).
4. Следит за журналом броней, отмен, переноса и статусов посещения.

## 3. Модель данных (PostgreSQL)
Актуальная схема хранится в `infra/api/migrations/001_init_schedule.sql` и покрывает дорожную карту этапов 2–3 (расписание, бронь с частичной предоплатой и расчёт фонда 26/74). Ключевые перечисления:

```sql
create type booking_status as enum (
  'reserved',    -- бронь создана, слот держится за клиентом
  'pending',     -- ожидаем подтверждение оплаты или ручное утверждение
  'confirmed',   -- депозит получен / бронь подтверждена
  'completed',   -- визит состоялся
  'canceled',    -- отменена вручную или клиентом
  'expired',     -- истек дедлайн депозита
  'no_show'      -- клиент не пришёл
);

create type payment_kind as enum ('deposit', 'balance', 'full', 'refund', 'adjustment');
create type payment_status as enum ('pending', 'succeeded', 'cancelled', 'failed', 'refunded');
create type schedule_rule_kind as enum ('weekly', 'one_off');
create type schedule_exception_kind as enum ('closed', 'extended');
```

### 3.1 Основные таблицы
- **centers** — филиалы DEVATA (адрес, часовой пояс, контакты). Поле `slug` уникально и используется в публичных ссылках.
- **services** — перечень услуг/курсов с длительностью, стоимостью, политикой оплаты и настройками депозита. Через связь `center_services` услуга привязывается к одному или нескольким центрам.
- **specialists** — сотрудники, ведущие восстановление и обучение. Таблица `specialist_services` фиксирует связку «специалист → услуга → центр» и, при необходимости, процент вознаграждения.
- **schedule_rules** — шаблоны расписаний (еженедельные и разовые). Для каждого правила фиксируем день недели, временной интервал, длительность слотов, период действия и вместимость.
- **schedule_exceptions** — временные блокировки или расширения расписания. Хранятся интервалы `starts_at` / `ends_at`, тип (`closed`/`extended`) и изменение вместимости.
- **bookings** — заявки клиентов с полями `hold_expires_at`, `deposit_due_at`, `deposit_amount_cents` и уникальным публичным идентификатором `public_id`. Частичный индекс `bookings_active_slot_unique` предотвращает двойное бронирование активных статусов.
- **booking_clients** — контактные данные клиента и отметка согласия на обработку данных.
- **booking_status_history** — аудит всех смен статуса (включая причины отмен, no-show и автоматическое истечение депозита).
- **orders** и **payments** — связка брони с финансовой частью (депозит, остаток, возвраты). Каждая запись платежа получает уникальный ключ `provider + provider_payment_id` для идемпотентности вебхуков.
- **funds_ledger_entries** — разбиение каждого платежа по фондам: уровни 10/3/3/1/1, бонус 2%, операционный фонд 74%, резерв.

### 3.2 Ограничения и бизнес-правила
- Все временные интервалы снабжены проверками (`CHECK (starts_at < ends_at)` и т.д.), чтобы исключить некорректные данные.
- Для `schedule_rules` и `schedule_exceptions` хранится `metadata` (JSONB) — сюда можно складывать дополнительные параметры без изменения схемы.
- Столбец `deposit_due_at` используется сервисом бронирования и n8n: при наступлении дедлайна бронь переводится в `expired`, слот освобождается, а событие попадает в историю.
- Таблицы `orders`, `payments` и `funds_ledger_entries` построены с расчётом на отчётность по фондам 26/74: каждая запись содержит сумму в копейках и долю в базисных пунктах (`basis_points`).
- Миграционный раннер (`npm --prefix infra/api run migrate`) создаёт служебную таблицу `schema_migrations` и применяет `.sql`-файлы в алфавитном порядке.

## 4. API-контракты (REST)
Базовый URL: `https://api.devata.ru/v1`

### 4.1 Публичные эндпоинты (для сайта)
| Метод | Путь | Описание |
|-------|------|----------|
| GET | /centers | Список центров |
| GET | /centers/{centerId}/services | Список услуг центра |
| GET | /services/{serviceId}/specialists | Активные специалисты по услуге |
| GET | /booking/slots | Получение доступных слотов |
| GET | /booking | Список броней с фильтрами |
| POST | /booking | Создание брони |

#### 4.1.1 GET /booking/slots
Параметры:
- `service_id` (uuid, required)
- `specialist_id` (uuid, optional)
- `center_id` (uuid, optional — для фильтрации, если услуга общая)
- `from` (ISO8601, required)
- `to` (ISO8601, required, max диапазон 30 дней)

Ответ:
```json
{
  "slots": [
    {
      "id": "slot-uuid-or-hash",
      "specialist_id": "...",
      "service_id": "...",
      "starts_at": "2025-09-01T09:00:00+03:00",
      "ends_at": "2025-09-01T10:00:00+03:00"
    }
  ],
  "generated_at": "2025-08-27T12:00:00Z"
}
```
`id` может быть детерминированным хэшем (`sha1(specialist_id|service_id|starts|ends)`) — пригодится при материализации и проверке гонок.

Ошибки:
- `400` — некорректные параметры (диапазон > 30 дней, отсутствует service_id).
- `404` — услуга или специалист не найдены/неактивны.

#### 4.1.2 POST /booking
```json
{
  "service_id": "uuid",
  "specialist_id": "uuid",
  "center_id": "uuid",
  "slot": {
    "starts_at": "2025-09-01T09:00:00+03:00",
    "ends_at": "2025-09-01T10:00:00+03:00"
  },
  "client": {
    "full_name": "Иван Иванов",
    "phone": "+7...",
    "email": "ivan@example.com",
    "utm_source": "telegram"
  },
  "comment": "Первичный визит"
}
```
Ответ `201 Created`:
```json
{
  "booking_id": "uuid",
  "status": "reserved",
  "specialist_id": "...",
  "starts_at": "...",
  "ends_at": "...",
  "payment": {
    "policy": "deposit_required",
    "currency": "RUB",
    "total_amount": 6500,
    "due_now_amount": 1950,
    "due_later_amount": 4550,
    "deposit_hold_minutes": 20,
    "deposit_due_at": "2025-09-01T09:20:00+03:00"
  },
  "funds": {
    "currency": "RUB",
    "total_amount": 6500,
    "referral_path": [
      "partner-sergey",
      "partner-oksana",
      "partner-vadim",
      "partner-elena",
      "partner-nikita"
    ],
    "components": [
      {
        "kind": "deposit",
        "amount": 1950,
        "due_at": "2025-09-01T09:20:00+03:00",
        "fund26": {
          "total": 507,
          "allocations": [
            { "partner_id": "partner-sergey", "level": 1, "percent": 10, "amount": 195 },
            { "partner_id": "partner-oksana", "level": 2, "percent": 3, "amount": 58.5 },
            { "partner_id": "partner-vadim", "level": 3, "percent": 3, "amount": 58.5 },
            { "partner_id": "partner-elena", "level": 4, "percent": 1, "amount": 19.5 },
            { "partner_id": "partner-nikita", "level": 5, "percent": 1, "amount": 19.5 }
          ],
          "professional_bonus": {
            "partner_id": "partner-elena",
            "percent": 2,
            "amount": 17.55,
            "specialist_share_percent": 45,
            "basis_amount": 877.5
          },
          "reserve": 138.45
        },
        "fund74": {
          "total": 1443,
          "allocations": [
            {
              "category": "specialist",
              "percent": 45,
              "amount": 877.5,
              "description": "Доля специалиста из операционного фонда"
            }
          ],
          "remaining": 565.5
        }
      },
      {
        "kind": "balance",
        "amount": 4550,
        "fund26": {
          "total": 1183,
          "allocations": [
            { "partner_id": "partner-sergey", "level": 1, "percent": 10, "amount": 455 },
            { "partner_id": "partner-oksana", "level": 2, "percent": 3, "amount": 136.5 },
            { "partner_id": "partner-vadim", "level": 3, "percent": 3, "amount": 136.5 },
            { "partner_id": "partner-elena", "level": 4, "percent": 1, "amount": 45.5 },
            { "partner_id": "partner-nikita", "level": 5, "percent": 1, "amount": 45.5 }
          ],
          "professional_bonus": {
            "partner_id": "partner-elena",
            "percent": 2,
            "amount": 40.95,
            "specialist_share_percent": 45,
            "basis_amount": 2047.5
          },
          "reserve": 323.05
        },
        "fund74": {
          "total": 3367,
          "allocations": [
            {
              "category": "specialist",
              "percent": 45,
              "amount": 2047.5,
              "description": "Доля специалиста из операционного фонда"
            }
          ],
          "remaining": 1319.5
        }
      }
    ]
  }
}
```
Если услуге не требуется предоплата, поле `payment` возвращается с политикой `none` или не возвращается вовсе. Статус `reserved`
означает, что слот удерживается до внесения депозита/оплаты; после успешного платежа бронь переходит в `confirmed`. Если клиент не
успевает оплатить до момента `payment.depositDueAt`, демонстрационный API автоматически переводит бронь в `expired` и возвращает слот
в общий пул доступности.

Блок `funds` демонстрирует, как по каждой оплате рассчитывается фонд 26%/74% и сеть 10/3/3/1/1. В демо-API мы возвращаем список
партнёров по уровням, сумму профессионального бонуса (2% от дохода специалиста) и остаток фонда 26%, а также долю специалиста в
операционном фонде 74%. Эти данные станут основой для таблицы `funds_ledger` и отчётов в реальном backend.
Ошибки:
- `409 Conflict` — слот занят. В теле ответа вернуть ближайшие альтернативы:
```json
{
  "error": "slot_unavailable",
  "alternatives": [
    { "starts_at": "2025-09-01T10:00:00+03:00", "ends_at": "..." },
    ...
  ]
}
```

#### 4.1.3 GET /booking

Параметры запроса (опционально):

- `center_id`, `service_id`, `specialist_id` — фильтрация по местоположению и специалисту.
- `phone`, `email` — поиск по контактам клиента (регистронезависимый, поддерживает частичное совпадение).
- `status` — может повторяться несколько раз (поддерживаем `reserved`, `confirmed`, `checked_in`, `completed`, `canceled`, `no_show`, `expired`, `simulated`).

Ответ `200 OK`:

```json
{
  "bookings": [
    {
      "bookingId": "demo-1234",
      "status": "reserved",
      "slotStart": "2025-09-01T09:00:00+03:00",
      "slotEnd": "2025-09-01T10:00:00+03:00",
      "centerId": "center-spb",
      "serviceId": "restoration-basic",
      "specialistId": "specialist-maria",
      "slotId": "slot-rule-maria-basic-weekdays-2025-09-01T06:00:00.000Z",
      "client": {
        "fullName": "Иван Иванов",
        "phone": "+79990000000",
        "email": "ivan@example.com"
      },
      "createdAt": "2025-08-20T12:15:00+03:00",
      "payment": {
        "policy": "deposit_required",
        "currency": "RUB",
        "totalAmount": 6500,
        "dueNowAmount": 1950,
        "dueLaterAmount": 4550,
        "depositDueAt": "2025-08-20T12:35:00+03:00"
      },
      "updatedAt": "2025-08-20T12:20:00+03:00",
      "statusHistory": [
        {
          "status": "reserved",
          "changedAt": "2025-08-18T12:15:00+03:00"
        },
        {
          "status": "confirmed",
          "changedAt": "2025-08-18T14:30:00+03:00",
          "previousStatus": "reserved",
          "note": "Оператор подтвердил бронь"
        }
      ]
    }
  ],
  "total": 1,
  "generatedAt": "2025-08-20T09:16:00Z"
}
```

Использование: клиентский кабинет, напоминания и ручная сверка статусов. В боевом окружении эндпоинт защищается аутентификацией и
автоматически фильтруется по текущему пользователю.

### 4.2 Приватные эндпоинты (кабинеты / админка)
Требуют аутентификации (JWT/Session). Префикс `/v1/internal`.

| Метод | Путь | Описание |
|-------|------|----------|
| GET | /internal/bookings | Фильтры по датам/статусу/специалисту |
| GET | /internal/bookings/{id} | Детали конкретной брони |
| PATCH | /internal/bookings/{id} | Изменение статуса, перенос |
| POST | /internal/bookings/{id}/check-in | Отметить посещение |
| POST | /internal/bookings/{id}/no-show | Отметить неявку |
| POST | /internal/bookings/{id}/follow-up | Назначить follow-up |
| POST | /internal/specialists/{id}/schedule | Обновить правила |
| POST | /internal/specialists/{id}/exceptions | Добавить исключение |
| DELETE | /internal/schedule-exceptions/{id} | Удалить исключение |

#### 4.2.1 PATCH /internal/bookings/{id}

Позволяет вручную изменить статус брони и оставить служебный комментарий. Используется сотрудниками центра для фиксации оплат,
отмен, неявок и завершения визита.

Пример запроса:

```json
{
  "status": "confirmed",
  "note": "Депозит внесён по ссылке"
}
```

Поддерживаются статусы `reserved`, `confirmed`, `checked_in`, `completed`, `canceled`, `no_show`, `expired`. Переходы валидируются — например, нельзя перевести `completed` обратно в `confirmed`.

Ответ `200 OK` возвращает актуальную запись с `statusHistory`, где фиксируются каждая смена статуса, отметки о неявках и комментарии операторов.

#### 4.2.2 POST /internal/bookings/{id}/follow-up

Назначает следующую встречу на основе уже оформленной брони. Сохраняет клиента, услугу и специалиста, но позволяет выбрать новый свободный слот и оставить комментарий для команды.

**Запрос**

```json
{
  "slotId": "slot-spb-schedule-002-2025-09-05T11:00:00.000Z",
  "note": "Повторная диагностика через неделю"
}
```

- `slotId` — обязательный идентификатор свободного слота для того же специалиста и услуги.
- `note` — необязательный служебный комментарий (до 500 символов). Добавляется в `statusHistory` новой и исходной броней.

**Ответ `201 Created`**

```json
{
  "bookingId": "demo-20250827-AB12CD",
  "status": "reserved",
  "slotStart": "2025-09-05T11:00:00.000Z",
  "slotEnd": "2025-09-05T12:00:00.000Z",
  "centerId": "spb-center-1",
  "serviceId": "service-rehab-60",
  "specialistId": "specialist-kuznetsova",
  "slotId": "slot-spb-schedule-002-2025-09-05T11:00:00.000Z",
  "client": {
    "fullName": "Анна Иванова",
    "phone": "+7 911 000-00-00",
    "email": "anna@example.com"
  },
  "createdAt": "2025-08-27T14:05:00.000Z",
  "payment": {
    "policy": "deposit_required",
    "totalAmount": 9000,
    "dueNowAmount": 2700,
    "dueLaterAmount": 6300,
    "depositHoldMinutes": 20,
    "depositDueAt": "2025-08-27T14:25:00.000Z"
  },
  "statusHistory": [
    {
      "status": "reserved",
      "changedAt": "2025-08-27T14:05:00.000Z",
      "note": "Follow-up для demo-20250818-XY91FF · Повторная диагностика через неделю"
    }
  ]
}
```

Исходная бронь получает дополнительную запись в `statusHistory` со служебным комментарием о назначенном follow-up, чтобы специалист видел, что клиент уже записан на следующий визит.

## 5. Генерация слотов
### 5.1 Алгоритм
1. Получаем все активные `schedules` для специалиста/услуги.
2. Для каждого schedule применяем `rrule` в заданном диапазоне `from..to`.
3. На каждый интервал накладываем `buffer_before_min` и `buffer_after_min` (например, при длительности 60 мин и буфере 10 мин, фактический слот — 60, но между слотами оставляем 10 минут).
4. Отфильтровываем слоты, пересекающиеся с `schedule_exceptions` (границы `[starts_at, ends_at)`).
5. Исключаем слоты, которые уже заняты бронями со статусами `confirmed` или `completed`.
6. Если у услуги есть `duration_min`, а `slot_duration_min` отличается, пересчитываем кратность (например, общая смена 240 минут, услуга 120 → порежем на 2 слота).
7. Возвращаем список слотов, отсортированных по времени.

### 5.2 Материализация
- Для MVP достаточно on-the-fly генерации.
- При росте нагрузки можно завести таблицу `generated_slots` (датасет на 14 дней вперёд, nightly refresh).
- `generated_slots` ускоряет выдачу и позволяет хранить `slot_id` для гонок.

## 6. Обработка гонок
- На уровне БД — уникальный индекс `(specialist_id, starts_at, ends_at)` в таблице `bookings`.
- При вставке брони используем транзакцию:
  1. `INSERT INTO clients ... ON CONFLICT (phone/email) DO UPDATE SET ... RETURNING id`.
  2. `INSERT INTO bookings (...) VALUES (...)`.
- Если получаем ошибку `unique_violation`, возвращаем `409` и вычисляем альтернативы (следующие свободные слоты по алгоритму генерации).
- Для блокировки во время процесса оплаты (в следующих этапах) появится `booking_holds`.

## 7. n8n-интеграция (MVP)
### 7.1 Webhooks из API → n8n
| Событие | Описание | Endpoint n8n |
|---------|----------|--------------|
| booking.created | новая бронь | `/webhook/devata/booking-created` |
| booking.canceled | отмена | `/webhook/devata/booking-canceled` |
| booking.rescheduled | перенос | `/webhook/devata/booking-rescheduled` |
| booking.checkin | отмечено посещение | `/webhook/devata/booking-checkin` |

Payload (пример):
```json
{
  "booking_id": "uuid",
  "center": { "id": "...", "name": "Центр на Невском" },
  "service": { "id": "...", "name": "Восстановление" },
  "specialist": { "id": "...", "full_name": "Анна Петрова" },
  "client": { "full_name": "Иван Иванов", "phone": "+7...", "email": "..." },
  "starts_at": "2025-09-01T09:00:00+03:00",
  "ends_at": "2025-09-01T10:00:00+03:00",
  "status": "confirmed"
}
```

### 7.2 Флоу подтверждения записи
1. Триггер: `booking.created` (Webhook).
2. Отправка email клиенту (`Email node`).
3. Отправка уведомления специалисту в Telegram (`Telegram node`).
4. Запись в Google Sheet «Журнал уведомлений».

### 7.3 Флоу напоминаний T-24/T-2
1. Крон `0 * * * *` (ежечасно) → запрос в API `/internal/bookings?starts_from=...&starts_to=...&status=confirmed`.
2. Фильтрация по `starts_at` (разница 24 часа или 2 часа).
3. Отправка email + Telegram (позже WhatsApp).
4. Логирование.

## 8. Критерии готовности (DoD)
- [ ] API проходит линтер, unit-тесты (минимум проверка генерации слотов и гонок).
- [ ] Swagger/OpenAPI с примером запросов для всех эндпоинтов.
- [ ] Фронтенд отображает расписание, корректно обрабатывает ошибку 409.
- [ ] n8n получает вебхуки и рассылает уведомления.
- [ ] В базе данных присутствуют аудит-таблицы (`booking_events`).
- [ ] Документация по запуску (README) обновлена.

## 9. Переход к следующему этапу
После успешного выполнения DoD можно переходить к Этапу 3:
- добавить депозиты (таблицы `orders`, `payments`, `booking_holds`),
- расширить API для создания платежей,
- обновить n8n-флоу под оплату и таймауты.
