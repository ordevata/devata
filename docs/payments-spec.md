# DEVATA Booking MVP — Этап 3. Частичная предоплата и биллинг

Дата обновления: 2025-08-27

## 1. Цели этапа
- Добавить сценарии частичной предоплаты (депозит) и полной предоплаты в онлайн-записи.
- Обеспечить корректное учётное отражение фонда 26%/74% для каждой оплаты (депозит + остаток).
- Настроить идемпотентную интеграцию с YooKassa и автоматические уведомления о статусах оплат.
- Подготовить данные для кабинетов (клиент, специалист, администрация) и отчётов.

## 2. Бизнес-правила
1. **Политика оплаты на уровне услуги** — администратор задаёт тип (`payment_policy`) и размер депозита (`deposit_percent`).
   - `deposit_required` — бронь активируется только после оплаты депозита.
   - `deposit_optional` — бронь создаётся сразу; депозит можно оплатить до визита (используем для мягкой мотивации).
   - `full_prepaid` — требуется полная оплата сразу (депозит = 100%).
   - `none` — оплаты онлайн нет; бронь подтверждается администратором.
2. **Размер депозита** — дробное значение от 0 до 100 с шагом 5% (хранится как decimal(5,2)). Минимум 10%, максимум 100%. Для `full_prepaid` автоматом 100%.
3. **Резервация слота** — при `deposit_required` и `full_prepaid` слот удерживается в статусе `reserved` на `booking.deposit_hold_minutes` (по умолчанию 15 минут). По истечении времени и отсутствии оплаты бронь отменяется автоматически.
4. **Остаточный платёж** — вносится до визита (до времени `starts_at`) или на месте. В онлайн-сценарии администратор может отправить ссылку на оплату остатка через кабинет или n8n.
5. **Отмена**
   - При отмене раньше `refund_policy.free_cancel_hours` (например, 24 ч.) депозит возвращается полностью.
   - При отмене позже — депозит удерживается (в `funds_ledger` отражаем как поступление в 74% / 26% в зависимости от правил). Возврат возможен вручную по решению администратора.
6. **Возвраты** — всегда инициируются администратором из админ-панели; создаётся `refund_request`, после успешного вебхука от YooKassa формируем отрицательные записи в `funds_ledger`.
7. **Фонд 26/74** — каждая успешная оплата формирует две проводки: фонд 26% (доступные начисления партнёрам) и операционный фонд 74%. Остаток фонда 26% при частичном начислении переносится на баланс фонда (см. регламент).
8. **Налоги и чеки** — формируются на стороне YooKassa (требуется передавать состав корзины и ставку НДС; пока используем одну позицию «Услуга DEVATA»).
9. **Коммуникации** — клиент получает email + TG (и позже WA) о необходимости оплатить депозит, подтверждение после успешного депозита, напоминание об остатке, уведомление об отмене/возврате.

### 2.1 Демонстрационная реализация в Next.js
- Встроенный демо-API (`POST /api/v1/booking`) уже возвращает объект `funds`, в котором для каждой составляющей оплаты показано
  разделение на фонд 26% и 74%, выплаты по уровням 10/3/3/1/1, профессиональный бонус 2% и остаток фонда 26%. Эти данные
  построены на базе модулей `lib/funds-ledger.ts` и `lib/demo-data.ts` и служат эталоном для будущих расчётов в таблице
  `funds_ledger`.
- Для операционного фонда 74% демо также показывает долю специалиста (45% от суммы услуги) и остаток средств на прочие расходы.

## 3. Модель данных (PostgreSQL)
```sql
create type payment_status as enum (
  'pending',       -- ссылка на оплату создана, ждём клиента
  'waiting_capture', -- YooKassa удержала средства, ждём подтверждения
  'succeeded',
  'canceled',
  'refunded',
  'failed'
);

create type payment_kind as enum ('deposit', 'balance', 'full', 'manual_adjustment');

create table payment_policies (
  service_id        uuid primary key references services(id) on delete cascade,
  payment_policy    text not null check (payment_policy in ('deposit_required','deposit_optional','full_prepaid','none')),
  deposit_percent   numeric(5,2) not null default 0,
  deposit_hold_minutes integer not null default 15,
  free_cancel_hours integer not null default 24,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table orders (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid not null references bookings(id) on delete cascade,
  total_amount      numeric(12,2) not null,
  currency          char(3) not null default 'RUB',
  status            text not null check (status in ('open','partially_paid','paid','canceled','refunding','refunded')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table payment_intents (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,
  payment_kind      payment_kind not null,
  amount            numeric(12,2) not null,
  description       text,
  expires_at        timestamptz,
  metadata          jsonb,
  created_at        timestamptz not null default now()
);

create table payments (
  id                uuid primary key default gen_random_uuid(),
  intent_id         uuid not null references payment_intents(id) on delete cascade,
  provider          text not null default 'yookassa',
  provider_payment_id text not null,
  status            payment_status not null,
  paid_at           timestamptz,
  amount            numeric(12,2) not null,
  currency          char(3) not null default 'RUB',
  raw_payload       jsonb not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (provider, provider_payment_id)
);

create table funds_ledger (
  id                bigint generated by default as identity primary key,
  booking_id        uuid references bookings(id),
  payment_id        uuid references payments(id),
  order_id          uuid references orders(id),
  entry_kind        text not null check (entry_kind in ('26_network','74_operations','adjustment','reversal')),
  percent           numeric(5,2) not null,
  amount            numeric(12,2) not null,
  description       text,
  occurred_at       timestamptz not null default now()
);

create table refund_requests (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,
  payment_id        uuid not null references payments(id) on delete cascade,
  amount            numeric(12,2) not null,
  reason            text,
  status            text not null check (status in ('requested','processing','succeeded','failed')),
  created_by        uuid references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
```

### 3.1 Обновления существующих сущностей
- `bookings` — добавить поля `deposit_status` (`none`, `required`, `paid`, `expired`, `refunded`) и `balance_due` (numeric).
- `booking_events` — новые типы: `deposit_link_sent`, `deposit_paid`, `deposit_expired`, `balance_paid`, `refund_requested`, `refund_succeeded`.
- `clients` — поле `preferred_payment_channel` (`email`, `telegram`, `whatsapp`).

## 4. Жизненный цикл брони с депозитом
1. **Создание брони** (API `POST /booking`)
   - Сервис определяет политику. Если `deposit_required` → создаём `order` со статусом `open`, `payment_intent` (вид `deposit`).
   - Возвращаем фронтенду `payment_intent_id` + ссылку на оплату (если создаётся сразу) либо команду «ожидаем оплату, ссылка отправлена на email».
   - В n8n отправляется событие `booking.deposit_pending` → письмо/сообщение с кнопкой «Оплатить депозит».
2. **Ожидание оплаты**
   - Таймер в API или background job проверяет `expires_at`. Если время истекло и нет `payments.status = 'succeeded'`, бронь переводится в `canceled`, добавляется событие `deposit_expired`, клиенту отправляется уведомление.
3. **Успешный депозит**
   - YooKassa шлёт `payment.succeeded` → webhook `/payments/yookassa` → сервис обрабатывает:
     1. Проверяем `provider_payment_id` по уникальному ключу (идемпотентность).
     2. Обновляем `payments.status = 'succeeded'`, заполняем `paid_at`.
     3. Обновляем `orders.status`: если депозит < 100%, то `partially_paid`; иначе `paid`.
     4. В `bookings.deposit_status` → `paid`, `status` → `confirmed`.
     5. Создаём 2 записи в `funds_ledger`: 26% и 74% от суммы депозита (в процентах от фактической оплаты).
     6. Отправляем n8n событие `payment.deposit_paid` → подтверждение клиенту/специалисту.
4. **Оплата остатка**
   - Администратор или система создаёт новый `payment_intent` вида `balance` на сумму `balance_due`. Ссылка отправляется клиенту.
   - После успешного вебхука обновляем `orders.status = 'paid'`, `bookings.balance_due = 0`, `bookings.status = 'confirmed'` (если был другой статус — например, `no_show` после визита, оставляем без изменений).
5. **Отмена и возвраты**
   - При отмене раньше дедлайна: создаём `refund_request`, инициируем YooKassa refund API, после успешного вебхука формируем отрицательные записи в `funds_ledger` (26% и 74%) и обновляем `bookings.deposit_status = 'refunded'`.
   - При отмене позже дедлайна: депозит удерживается. Запись в `funds_ledger` остаётся, `orders.status` меняется на `canceled`, добавляется событие `deposit_forfeited`.
   - Если визит состоялся, но необходимо вернуть депозит (например, услуга не оказана) — администратор создаёт возврат вручную, логика аналогичная ранней отмене.

## 5. API-контракты (дополнение к этапу 2)
Базовый URL: `https://api.devata.ru/v1`.

### 5.1 POST /booking
Расширение ответа:
```json
{
  "booking_id": "uuid",
  "status": "reserved",
  "deposit": {
    "required": true,
    "amount": 3000,
    "currency": "RUB",
    "payment_intent_id": "uuid",
    "payment_url": "https://yookassa.ru/pay/...",
    "expires_at": "2025-09-01T18:15:00+03:00"
  }
}
```
### 5.2 POST /orders/{orderId}/payment-intents
Создаёт новый intent (`deposit`, `balance`, `manual_adjustment`).
```json
{
  "payment_kind": "balance",
  "amount": 7000,
  "channel": "yookassa",
  "success_redirect_url": "https://app.devata.ru/booking/success?booking=...",
  "fail_redirect_url": "https://app.devata.ru/booking/fail?booking=..."
}
```
Ответ включает `payment_url`, `intent_id`, `expires_at`.

### 5.3 GET /bookings/{id}
Дополнить блоком `payments`:
```json
{
  "deposit_status": "paid",
  "balance_due": 7000,
  "payments": [
    {
      "kind": "deposit",
      "status": "succeeded",
      "amount": 3000,
      "paid_at": "2025-09-01T17:05:00+03:00"
    }
  ]
}
```

### 5.4 POST /payments/webhooks/yookassa
Идемпотентный обработчик вебхуков. Требования:
- Проверять HTTP заголовки `Idempotence-Key`, `Content-HMAC` (подписываем секретом).
- Логировать полный payload в `payments.raw_payload`.
- Возвращать 200 только после успешной фиксации данных.

### 5.5 POST /bookings/{id}/cancel
Расширить тело запроса:
```json
{
  "reason": "client_request",
  "requested_by": "client",
  "refund": {
    "mode": "auto" | "manual" | "none",
    "comment": "Возврат до дедлайна"
  }
}
```
Если `refund.mode = auto` и дедлайн соблюдён, создаём `refund_request` и инициируем API YooKassa.

## 6. Интеграция с YooKassa
1. **Создание платежа** — происходит при создании `payment_intent`. Используем YooKassa Payments API v3.
   - `amount.value` — сумма депозита/остатка.
   - `capture` — `true` (мгновенное списание) или `false` (двухфазный режим). Для MVP достаточно `true`.
   - `payment_method_data.type` — `bank_card` или `sbp` (добавим позже).
   - `metadata` — передаём `booking_id`, `order_id`, `payment_kind`, `intent_id`, `ref_id` (если есть). Это упрощает обработку вебхуков.
   - `confirmation.type` — `redirect`, `return_url` → успех, `cancel_url` → отказ.
2. **Webhook обработчик**
   - Слушаем события `payment.succeeded`, `payment.waiting_for_capture`, `payment.canceled`, `refund.succeeded`.
   - Для `waiting_for_capture` (если используем двухфазный режим) автоматически вызываем `capture` через API.
   - При `payment.canceled` → обновляем `payments.status`, отправляем уведомления.
3. **Refund API**
   - POST `/payments/{paymentId}/refunds`.
   - После `refund.succeeded` создаём отрицательные проводки в `funds_ledger` и обновляем статусы `orders`/`payments`/`bookings`.

## 6. Демо-снимок партнёрских начислений

Для согласования логики фонда 26% и минимума 50 000 ₽ в проект добавлен справочный эндпоинт, который агрегирует начисления партнёров по демо-бронированиям:

- `GET /api/v1/partners/payouts` — возвращает объект `snapshot` с полями:
  - `threshold` — действующий порог денежных выплат (по умолчанию 50 000 ₽);
  - `totals` — суммарные значения по всем партнёрам (`pendingAmount`, `approvedAmount`, `paidAmount`, `cashoutAvailable`, `partnersEligible`);
  - `summaries[]` — список партнёров с подробным балансом: суммы в статусах `pending` и `approved`, прогресс до порога, доступно к зачёту на услуги, а также полный журнал начислений (уровни 10/3/3/1/1 + профессиональный бонус 2%).
- Данные строятся на основе демо-бронирований: завершённая сессия (депозит + остаток оплачены), активная бронь с невнесённым депозитом и будущая диагностика с оплаченным депозитом.
- Леджер выдаёт строки для каждого уровня сети и профессионального бонуса, что позволяет проверить формулы 26% в реальном API до подключения настоящих платежей.

Эндпоинт нужен фронтенду кабинетов и n8n-воркфлоу выплат: на его основе формируются отчёты, уведомления о достижении порога, а также расчёт переноса начислений на услуги.

## 7. n8n Workflow (минимум)
1. **booking.deposit_pending**
   - Вход: событие из API.
   - Действия: сформировать письмо + сообщение в TG с кнопкой оплаты, записать в Google Sheet «Deposit Links».
2. **payment.deposit_paid**
   - Вход: событие из API после вебхука.
   - Действия: отправить подтверждение клиенту, уведомить специалиста, обновить CRM (Supabase) статус `deposit_paid_at`.
3. **deposit.expired**
   - Крон → запрос `/internal/deposits/expired` → отмена брони → уведомление клиенту.
4. **balance.reminder**
   - Крон: за 48 часов до визита проверяем `balance_due > 0` → отправляем напоминание.
5. **refund.succeeded**
   - Вебхук `refund.succeeded` → письмо клиенту + уведомление администратору, запись в журнал возвратов.

Все workflow должны логировать результаты и ошибки в таблицу `notification_logs` (Supabase) и иметь ретраи при сбое отправки.

## 8. Идемпотентность и безопасность
- Все публичные POST эндпоинты принимают заголовок `Idempotency-Key`. Сохраняем последнюю успешную операцию в таблице `idempotent_requests` (key + hash body + response).
- Webhook подписываем HMAC (секрет выдаётся YooKassa). При несоответствии возвращаем 401.
- Уровень доступа:
  - Клиентские операции (создание брони, получение ссылки оплаты) — по публичным токенам (captcha + rate limit).
  - Админские операции (создание intents на остаток, возвраты) — требуются JWT из админ-панели.
- Все денежные суммы храним в `numeric(12,2)`. В коде избегаем float.

## 9. Отчётность и аудит
- `funds_ledger` служит источником данных для отчётов 26%/74%. Для каждого платежа: две строки (26 и 74). При возврате — две отрицательные строки.
- Периодические отчёты (через n8n) агрегируют `funds_ledger` по дате `occurred_at`, фильтруя по статусам оплат.
- Для аудита храним `payments.raw_payload` и `refund_requests.reason`.
- Журналируем все изменения статусов `orders`, `bookings`, `payments` в `booking_events` и отдельной таблице `payment_events` (если потребуется более подробный аудит).

## 10. Критерии готовности (DoD)
- Создание брони с обязательным депозитом → клиент получает ссылку на оплату, бронь отменяется при просрочке.
- Получение вебхука `payment.succeeded` корректно обновляет `orders`, `bookings`, `funds_ledger` и триггерит уведомления.
- Остаточный платёж можно инициировать из админки → после оплаты `orders.status = paid`.
- Возврат до дедлайна создаёт `refund_request`, после `refund.succeeded` в `funds_ledger` появляются отрицательные записи.
- Все сценарии покрыты автоматическими напоминаниями (deposit pending, deposit paid, balance reminder, refund status).
- Идемпотентность: повторные вебхуки не дублируют записи; повторные клики клиента по кнопке оплаты создают новую ссылку только если предыдущая истекла.

