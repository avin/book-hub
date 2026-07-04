# План Docker Compose и README

## Docker Compose services

### `postgres`

Назначение:

- PostgreSQL database.

Требования:

- Persistent volume для данных.
- Healthcheck.
- Переменные окружения из `.env`.

### `backend`

Назначение:

- Go HTTP API.

Требования:

- Зависит от `postgres`.
- Получает `DATABASE_URL`.
- Получает `STORAGE_DIR`.
- Получает `BOOK_HUB_BASE_PATH`.
- Монтирует persistent volume или host directory для файлов книг.
- Открывает HTTP port только внутри Docker network.
- Имеет healthcheck на `{BOOK_HUB_BASE_PATH}/api/readyz`.

### `frontend`

Назначение:

- Отдача статического SolidJS build через отдельный nginx/static container.

Требования:

- На первой итерации показывает только `в разработке`.
- Backend не отдает frontend static files.
- Наружу публикуется только frontend/nginx port.
- Frontend/nginx маршрутизирует `{BOOK_HUB_BASE_PATH}/api` на backend внутри
  Docker network.
- Должен поддерживать SPA fallback rewrite: неизвестные frontend routes
  переписываются на `index.html`.
- Должен работать как с корня домена, так и из подпапки через общий base path.

## URL layout

Приложение должно поддерживать два режима размещения:

- С корня домена: frontend доступен по `/`, backend API доступен по `/api`.
- Из подпапки: например при base path `/hub` frontend доступен по `/hub`, backend
  API доступен по `/hub/api`.
- Health endpoints являются частью API root: `/api/healthz`, `/api/readyz` или
  `/hub/api/healthz`, `/hub/api/readyz`.
- Backend Docker healthcheck ходит напрямую на backend внутри Docker network по
  `{BOOK_HUB_BASE_PATH}/api/readyz`.
- Снаружи health endpoints доступны через frontend/nginx как обычные API routes.

Правила:

- Base path задается конфигурацией, например `BOOK_HUB_BASE_PATH`.
- Session cookie использует `Path`, равный `BOOK_HUB_BASE_PATH`.
- OpenAPI paths описываются относительно API root.
- Backend сам обслуживает API по `{BOOK_HUB_BASE_PATH}/api`; reverse proxy не
  должен делать strip-prefix для API.
- Reverse proxy/static server должен направлять API-запросы на backend, а все
  остальные запросы base path - на frontend static files.
- Для frontend routes нужен rewrite на `index.html`, чтобы SPA routing работал
  при прямом открытии вложенного URL.

### `migrate`

Назначение:

- One-shot service для применения миграций.

Правила:

- Не применять миграции неявно в `backend` startup.
- `migrate` использует тот же Docker image, что и `backend`.
- Миграции запускаются через `book-hub-migrate up|down|version`, который
  использует общий config из environment variables.
- В README явно описать команду:

```bash
docker compose run --rm migrate up
```

### `admin`

Назначение:

- Запуск admin CLI.

Правила:

- Не держать отдельный постоянно работающий service.
- `admin` использует тот же Docker image, что и `backend`.
- Использовать run-команду:

```bash
docker compose run --rm admin
```

## Volumes

Нужны persistent volumes:

- `postgres_data`
- `book_storage`

Альтернатива для сервера:

- bind mount вида `/srv/book-hub/books:/data/books`

## `.env.example`

Минимальные переменные:

```env
POSTGRES_DB=bookhub
POSTGRES_USER=bookhub
POSTGRES_PASSWORD=change-me

BOOK_HUB_HTTP_ADDR=:8080
BOOK_HUB_BASE_PATH=/
BOOK_HUB_LOG_LEVEL=info
BOOK_HUB_DATABASE_URL=postgres://bookhub:change-me@postgres:5432/bookhub?sslmode=disable
BOOK_HUB_STORAGE_DIR=/data/books
BOOK_HUB_DEFAULT_QUOTA_BYTES=314572800
BOOK_HUB_REGISTRATION_ENABLED=true
BOOK_HUB_REGISTRATION_AUTO_ACTIVATE=false
BOOK_HUB_MAX_UPLOAD_BYTES=314572800
BOOK_HUB_MAX_COVER_UPLOAD_BYTES=1048576
BOOK_HUB_SESSION_SECRET=change-me-long-random-secret
BOOK_HUB_SESSION_TTL=26280h
BOOK_HUB_COOKIE_SECURE=false
```

## README structure

README должен содержать:

1. Что такое Book Hub.
2. Требования к серверу.
3. Как подготовить `.env`.
4. Как запустить PostgreSQL и backend.
5. Как применить миграции.
6. Как открыть frontend.
7. Как настроить размещение с корня домена или из подпапки через base path.
8. Как запустить admin CLI.
9. Как создать и активировать первого пользователя.
10. Где лежат файлы книг.
11. Как менять квоты.
12. Как обновлять приложение.
13. Как делать backup.
14. Как откатывать миграции.

## Backup

Нужно документировать backup двух частей:

- PostgreSQL dump.
- Book storage directory.

Важное правило:

- Бэкап БД и файлов должен быть согласован по времени. Иначе возможны записи в БД
  без файла или файлы без записей.

Правила:

- Для маленькой self-hosted установки достаточно остановить сервисы, сделать
  `pg_dump` и архив storage directory, затем запустить сервисы обратно.

## Reverse proxy

В README нужно указать, что в production желательно ставить reverse proxy с TLS:

- Caddy
- nginx
- Traefik

Backend должен корректно работать за proxy:

- учитывать forwarded headers только если явно включено;
- при production-размещении за HTTPS reverse proxy выставлять
  `BOOK_HUB_COOKIE_SECURE=true`.
