# Разработка Book Hub

Этот файл предназначен для разработки. Эксплуатация и установка на сервер — в [README.md](README.md).

## Стек и структура

- `backend/` — Go API, миграции и admin CLI;
- `frontend/` — SolidJS, Vite и TypeScript;
- `api/openapi.yaml` — контракт API;
- `docker-compose.yml` — стек PostgreSQL; `docker-compose.sqlite.yml` — самостоятельный стек SQLite;
  в обоих есть backend, frontend, мигратор, admin и backup CLI.

Для локальной работы нужны Docker Engine с Docker Compose v2, GNU Make, Go 1.26.4, Node.js 24 и npm 11.

## Первичная настройка

```bash
make env
npm --prefix frontend install
```

Установка npm-пакетов нужна один раз и после изменения зависимостей. Заполните `.env`.
Для PostgreSQL и доступа с хоста создайте `docker-compose.override.yml`:

```yaml
services:
  postgres:
    ports:
      - "5432:5432"
```

В PostgreSQL-режиме `BOOK_HUB_DATABASE_URL` в `.env` рассчитан на Docker и использует хост `postgres`.
Цели `make dev-db` и `make dev-backend` автоматически заменяют его на `localhost`.
В SQLite-режиме задайте в `.env` `BOOK_HUB_DATABASE_URL=sqlite:///data/db/book-hub.sqlite`;
Make использует отдельный абсолютный путь хоста `./data/db/book-hub.sqlite` для локальной разработки.
`POSTGRES_*` и Docker для такой базы не нужны. Путь можно переопределить через `DEV_DATABASE_URL=sqlite:///абсолютный/путь`;
в Windows формат — `sqlite:///C:/book-hub/data/book-hub.sqlite`. Локальные книги и обложки: `./data/books`.
Для обоих режимов `make dev-db` запускает Go-мигратор на хосте; перед повторными миграциями остановите локальный backend.

`make dev-backend` использует каталоги хоста: `DEV_BOOKS_DIR`, `DEV_IMAGES_DIR` и `DEV_WORK_DIR`, по умолчанию
`books`, `covers` и `tmp` под `DEV_STORAGE_DIR`. Например, `make dev-backend DEV_BOOKS_DIR=/mnt/hdd/books`
отделяет оригиналы от локальных изображений и рабочих файлов. `BOOK_HUB_WORK_MAX_BYTES` ограничивает общий
объём временных загрузок и получений (по умолчанию 1 ГиБ). Для каждого backend нужен отдельный рабочий каталог.

Для проверки кэша задайте `BOOK_HUB_CACHE_DIR` и `BOOK_HUB_CACHE_MAX_BYTES`; без обоих параметров он выключен.
Кэш не должен пересекаться с каталогами оригиналов, изображений и рабочих файлов. Тесты кэша используют HTTP,
управляемый источник и временные файлы; `TestBookCacheDiskFullWriteFallsBackToBoundedWorkspace` дополнительно
запускается с `BOOK_HUB_TEST_SMALL_CACHE_DIR` на отдельном тестовом tmpfs меньше 128 КиБ, чтобы воспроизвести
настоящую ошибку записи при заполнении диска. Этот каталог должен быть выделен только для теста.

## Локальный запуск

Запустите базу и миграции:

```bash
make dev-db
```

В отдельных терминалах запустите backend и frontend:

```bash
make dev-backend
make dev-frontend
```

Backend слушает `http://localhost:8080`, Vite — `http://localhost:5173`.

В `frontend/vite.config.ts` для локального backend укажите proxy target `http://localhost:8080`. Текущий proxy target следует согласовать со средой, в которой запущен API. При `BOOK_HUB_BASE_PATH=/hub` задайте `VITE_BASE_PATH=/hub` и добавьте proxy для `/hub/api`.

## Команды разработки

```bash
make dev-storybook
make backend-test
make storage-contract-test BOOK_HUB_TEST_DATABASE_URL=postgres://...
make frontend-test
make frontend-e2e-test
make frontend-generate
make frontend-build
make test
```

`make frontend-generate` запускайте после изменений в `api/openapi.yaml`.

`make backend-test` включает SQLite contract-suite на временных файлах без внешнего сервиса.
`make storage-contract-test` запускает SQLite и PostgreSQL contract-suite на реально применённых миграциях.
URL должен указывать на отдельную тестовую PostgreSQL-базу, где пользователь может создавать schema;
suite создаёт случайную schema через `search_path` и удаляет её после завершения. Не передавайте URL production-базы.
Проверки PostgreSQL backup/restore в `internal/backup` при наличии `BOOK_HUB_TEST_DATABASE_URL` требуют
`pg_dump`, `psql` и права создавать отдельную временную БД. Они проверяют новый и старый формат копий.
Для запуска backup CLI на хосте нужны `pg_dump` и `psql` той же основной версии, что и PostgreSQL-сервер.
Docker-образ содержит клиенты PostgreSQL 16 и 17 и выбирает нужную версию автоматически.

## CI

Workflow `.github/workflows/verify.yml` запускается для каждого push и pull request. Он проверяет Go-тесты,
SQLite и PostgreSQL contract-suite, backup/restore, сборку четырёх CLI без CGO, Docker-образ backend и четыре
Compose-набора (обе СУБД, локальная сборка и GHCR). Также проверяются frontend lint/unit/typecheck/build и Playwright;
при сбое Playwright сохраняются его артефакты. Отдельная job генерирует API-типы и проверяет отсутствие diff.
Workflow не публикует образы.

## Docker и диагностика

```bash
make docker-build
make docker-up
make docker-down
make migrate-up
make migrate-down
make migrate-version
make backend-shell
make db-shell
```

`make help` выводит полный список целей. Для диагностики сервисов используйте `make ps` и `make logs`, при необходимости ограничив журнал: `make logs SERVICE=backend`.

Make выбирает файл стека по `BOOK_HUB_DATABASE_URL`; production-цели используют явный файл и не подключают
`docker-compose.override.yml`. `make dev-db` для PostgreSQL подключает override с портом хоста.
Миграции не запускаются при старте backend автоматически. `make docker-up` собирает и запускает стек без миграций;
`make docker-restart` только перезапускает контейнеры. Для развёртывания с миграциями используйте `make local-deploy`.
`make migrate`, `make migrate-up`, `make migrate-down` и `make ghcr-migrate` останавливают приложение и оставляют
его выключенным; запускайте его после проверки результата. `make migrate-version` только читает версию.

`make backup` и `make restore BACKUP=...` останавливают backend и frontend и запускают их после успешного завершения, даже если до команды сервисы были выключены. При ошибке после остановки они остаются выключенными; перед повторным запуском проверьте причину сбоя и состояние данных.

## Файловое хранилище

По умолчанию книги и обложки хранятся в Docker volume `book_storage`, подключённом к `/data/books` сервисов
`backend`, `migrate`, `admin` и `backup`. Чтобы использовать серверный каталог, замените volume у всех четырёх сервисов, например:

```yaml
volumes:
  - /srv/book-hub/books:/data/books
```

В SQLite-стеке у этих же четырёх сервисов есть отдельный volume `sqlite_data:/data/db`.
SQLite-файл должен лежать на локальном диске; сетевое файловое хранилище и несколько backend не поддерживаются.
Миграции PostgreSQL сохраняются в `backend/migrations/`, SQLite — в `backend/migrations/sqlite/`.
Оба набора встроены в CLI. Запуск server/admin проверяет точную версию схемы и отсутствие dirty-состояния.

## Документация

- [docs/APP.md](docs/APP.md) — поведение приложения;
- [api/openapi.yaml](api/openapi.yaml) — API-контракт;
- [CONTEXT.md](CONTEXT.md) и `docs/adr/` — предметная область и архитектурные решения.
