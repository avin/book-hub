# Разработка Book Hub

Этот файл предназначен для разработки. Эксплуатация и установка на сервер — в [README.md](README.md).

## Стек и структура

- `backend/` — Go API, миграции и admin CLI;
- `frontend/` — SolidJS, Vite и TypeScript;
- `api/openapi.yaml` — контракт API;
- `docker-compose.yml` — production-стек: PostgreSQL, backend, frontend, мигратор и admin CLI.

Для локальной работы нужны Docker Engine с Docker Compose v2, GNU Make, Go 1.26.4, Node.js 24 и npm 11.

## Первичная настройка

```bash
make env
npm --prefix frontend install
```

Установка npm-пакетов нужна один раз и после изменения зависимостей. Заполните `.env`. Для доступа к PostgreSQL с хоста создайте `docker-compose.override.yml`:

```yaml
services:
  postgres:
    ports:
      - "5432:5432"
```

`BOOK_HUB_DATABASE_URL` в `.env` рассчитан на Docker и использует хост `postgres`. Цели `make dev-backend` автоматически заменяют его на `localhost`. Локальное файловое хранилище: `./data/books`.

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

`make storage-contract-test` выполняет общую contract-suite PostgreSQL adapter на реально применённых миграциях. URL должен указывать на отдельную тестовую базу, где пользователь может создавать schema; suite создаёт случайную schema через `search_path` и удаляет её после завершения. Не передавайте URL production-базы.

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

Миграции не запускаются при старте backend автоматически: для Docker-стека используйте `make migrate-up` или `make local-deploy`.

## Файловое хранилище

По умолчанию книги и обложки хранятся в Docker volume `book_storage`, подключённом к `/data/books` сервисов `backend`, `migrate` и `admin`. Чтобы использовать серверный каталог, замените volume у всех трёх сервисов, например:

```yaml
volumes:
  - /srv/book-hub/books:/data/books
```

## Документация

- [docs/APP.md](docs/APP.md) — поведение приложения;
- [api/openapi.yaml](api/openapi.yaml) — API-контракт;
- [CONTEXT.md](CONTEXT.md) и `docs/adr/` — предметная область и архитектурные решения.
