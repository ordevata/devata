
# DEVATA Next.js Starter (fixed)

Готовый каркас фронтенда под DEVATA (Next.js App Router + Tailwind).

## Запуск локально
```bash
npm i
npm run dev
```
Переменные среды: создайте `.env.local` и задайте `NEXT_PUBLIC_API_BASE=https://api.devata.ru/v1` (или оставьте значение по умолчанию `/api/v1` для встроенного демо-API).

## Демо-API внутри Next.js
Для разработки без внешнего backend в проект добавлены эндпоинты `app/api/v1/*`, которые отдают те же демо-данные, что и фронтенд.

- `GET /api/v1/catalog/centers` — центры DEVATA.
- `GET /api/v1/catalog/services?center_id=...` — услуги с учётом выбранного центра.
- `GET /api/v1/catalog/specialists?center_id=...&service_id=...` — специалисты.
- `GET /api/v1/booking/slots?center_id=...&service_id=...&specialist_id=...` — доступные слоты.
- `POST /api/v1/booking` — создание брони (возвращает `bookingId`, платёжные условия и учебный `funds`-разрез по фондам 26%/74%).

Эндпоинты используют общие демо-данные и позволяют фронтенду работать «из коробки», а также служат контрактом для будущего реального API.

## Серверная инфраструктура
В каталоге [`infra/`](./infra/README.md) лежит минимальный стек для backend-окружения DEVATA: Caddy с авто-HTTPS, демо-API на Node.js, PostgreSQL и Redis. Стек запускается командой `docker compose up -d` и совпадает с инфраструктурой из дорожной карты. Используйте его как основу для развёртывания на `api.devata.ru`.

## Деплой на Vercel
1) Загрузите содержимое репозитория в GitHub
2) Vercel → Add New Project → выберите репозиторий → Deploy
3) Привяжите домен `app.devata.ru` в Settings → Domains
