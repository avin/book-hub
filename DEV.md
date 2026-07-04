# Локальная разработка

Для ежедневной работы удобнее не пересобирать Docker на каждое изменение, а держать в контейнере только PostgreSQL, а бэкенд и фронт запускать локально. Production-запуск целиком через Docker — в [README.md](README.md).

```text
PostgreSQL  → Docker
Backend     → go run (локально, :8080)
Frontend    → Vite dev server (локально, :5173)
```

## Настройка (один раз)

Скопируйте `.env` из `.env.example`.

**Проброс порта PostgreSQL.** В `.env` хост `postgres` — это имя Docker-сервиса, с хост-машины он недоступен. Создайте `docker-compose.override.yml`:

```yaml
services:
  postgres:
    ports:
      - "5432:5432"
```

**Прокси API во фронте.** Vite отдаёт UI на `:5173`, бэкенд слушает `:8080`. Без прокси запросы идут с другого origin — CORS в бэкенде нет, cookies сессии не работают. Добавьте в `frontend/vite.config.ts`:

```ts
server: {
  proxy: {
    "/api": {
      target: "http://localhost:8080",
      changeOrigin: true,
    },
  },
},
```

## Запуск

Три терминала.

**1. База и миграции** (из корня репозитория):

```powershell
docker compose up -d postgres
docker compose run --rm migrate up
docker compose stop frontend   # иначе займёт :8080
```

**2. Бэкенд:**

```powershell
cd backend
$env:BOOK_HUB_DATABASE_URL = "postgres://bookhub:ПАРОЛЬ@localhost:5432/bookhub?sslmode=disable"
$env:BOOK_HUB_STORAGE_DIR = "..\data\books"
$env:BOOK_HUB_SESSION_SECRET = "..."   # значение из .env
go run ./cmd/book-hub-server
```

Go не читает `.env` сам — переменные задаются вручную или через run configuration в IDE. Пароль и секрет берите из своего `.env`.

**3. Фронтенд:**

```powershell
cd frontend
npm install   # первый раз
npm run dev
```

Сайт: `http://localhost:5173`. Запросы на `/api` Vite проксирует на бэкенд.

## Переменные: Docker vs локальный go run

| Переменная | В Docker (.env) | Локально |
|------------|-----------------|----------|
| `BOOK_HUB_DATABASE_URL` | `...@postgres:5432/...` | `...@localhost:5432/...` |
| `BOOK_HUB_STORAGE_DIR` | `/data/books` | `..\data\books` |

Остальные переменные — те же, что в `.env`.

## Прочее

```powershell
cd backend && go test ./...              # unit-тесты, БД не нужна
docker compose run --rm admin            # admin CLI через Docker
go run ./cmd/book-hub-admin              # admin CLI локально (те же env)
docker compose up -d --build             # полная сборка как на сервере → :8080
```

## Base path `/hub`

Если `BOOK_HUB_BASE_PATH=/hub`, API живёт по `/hub/api`. Для Vite: `VITE_BASE_PATH=/hub` и прокси:

```ts
"/hub/api": { target: "http://localhost:8080", changeOrigin: true },
```
