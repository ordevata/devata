# DEVATA Cabinets mu-plugin

Минимальный must-use плагин WordPress, который добавляет роли DEVATA, REST API эндпоинты и шорткоды для вывода личных кабинетов без сторонних решений.

## Возможности

- Роли `devata_partner`, `devata_student`, `devata_staff`, `devata_branch_admin`.
- REST API `/wp-json/devata/v1/me` и коллекции `/me/bookings`, `/me/orders`, `/me/courses`, `/me/network`, `/me/payouts`.
- Обновление профиля через `POST /wp-json/devata/v1/me/profile`.
- Шорткоды `[devata_dashboard]`, `[devata_partner]`, `[devata_student]`, `[devata_staff]`, `[devata_branch]`.
- Лёгкий фронтенд на ванильном JS: отображение профиля, таблиц записей, заказов, курсов, структуры и выплат.

## Установка

1. Скопируйте папку `devata-cabinets` в `wp-content/mu-plugins/` (или используйте git submodule).
2. Очистите кэш opcache (если включён) и откройте любую страницу сайта — роли и REST будут зарегистрированы автоматически.
3. Добавьте шорткод на нужную страницу, например `/cabinet`:
   ```html
   [devata_dashboard]
   ```
4. Авторизованные пользователи увидят карточку профиля и разделы, которые соответствуют их роли.

## Интеграция с CRM/n8n

Плагин отдаёт данные через фильтры, поэтому источником может быть Supabase, внешний API или ваш n8n.

| Коллекция | Фильтр | Ожидаемый формат |
|-----------|--------|------------------|
| bookings  | `devata_cabinets_bookings` | массив записей (`reference`, `service`, `slotStart`, `status`, `payment`) |
| orders    | `devata_cabinets_orders`   | массив заказов (`orderId`, `amount`, `status`, `updatedAt`) |
| courses   | `devata_cabinets_courses`  | массив курсов (`course`, `progress`, `accessUntil`, `status`) |
| network   | `devata_cabinets_network`  | массив партнёров (`level`, `name`, `role`, `joinedAt`, `active`) |
| payouts   | `devata_cabinets_payouts`  | массив выплат (`period`, `amount`, `status`, `availableAt`) |

Пример подключения к Supabase через n8n или кастомный REST-клиент:

```php
add_filter('devata_cabinets_bookings', function ($items, WP_User $user) {
    $response = wp_remote_get('https://api.devata.ru/bookings?user=' . $user->ID);
    if (is_wp_error($response)) {
        return $items;
    }
    $data = json_decode(wp_remote_retrieve_body($response), true);
    if (! is_array($data)) {
        return $items;
    }
    return $data['items'] ?? $data;
}, 10, 2);
```

## Кастомизация интерфейса

- Используйте CSS-переменную `--devata-font`, чтобы подменить шрифт.
- Добавьте собственные стили через тему, например:
  ```css
  .devata-card { background: #f8fafc; }
  ```
- Для расширения таблиц можно переопределить JavaScript (хук `wp_enqueue_scripts`) и загрузить свою версию `devata-cabinets`.

## Обновление профиля

`POST /wp-json/devata/v1/me/profile` принимает JSON:
```json
{
  "firstName": "Имя",
  "lastName": "Фамилия",
  "phone": "+7...",
  "telegram": "@username"
}
```

После обновления срабатывает хук `devata_cabinets_profile_updated` (можно использовать для отправки данных в CRM).

## Безопасность

- Все REST-запросы требуют авторизации WordPress.
- JS автоматически добавляет `X-WP-Nonce` для защиты от CSRF.
- Ответы очищаются и подставляются в DOM без использования `innerHTML` для пользовательских данных.

## План развития

- Поддержка загрузки документов (сертификатов) и ссылок на материалы.
- Настраиваемые колонки таблиц через PHP-фильтры.
- Переключатель языка и многоязычная поддержка.
- Интеграция с real-time уведомлениями (WebSocket / SSE) через n8n.
