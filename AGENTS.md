# Book Hub — инструкции для агентов

Приватное self-hosted веб-приложение для хранения и чтения книг. Пользовательские тексты и ответы агенту — на русском; существующие комментарии в коде не переводить без отдельной причины.

## Быстрый старт

- Для разработки требуются Docker Compose v2, GNU Make, Go 1.26.4, Node.js 24 и npm 11 (точные версии Node/npm также закреплены в `frontend/package.json`).
- Создать локальную конфигурацию: `make env`, затем заполнить `.env`. Не показывать и не коммитить её содержимое.
- Установить зависимости frontend: `npm --prefix frontend install`.
- Запустить локальное окружение в отдельных терминалах: `make dev-db`, `make dev-backend`, `make dev-frontend`.
  Backend доступен на `http://localhost:8080`, Vite — на `http://localhost:5173`.
- Для краткой справки по операциям использовать `make help`; подробности локальной разработки — в `DEV.md`, развёртывания — в `README.md`.

## Карта репозитория

- `backend/` — Go HTTP API, доменная логика, storage-слой, файловое хранилище, миграции и CLI.
  - `cmd/book-hub-server`, `cmd/book-hub-migrate`, `cmd/book-hub-admin` — исполняемые приложения.
  - `internal/domain/` — сущности и инварианты; `internal/httpapi/` — HTTP-обработчики; `internal/storage/` — интерфейс и PostgreSQL-/in-memory-реализации; `internal/storage/files/` — операции с файлами.
  - `migrations/` — последовательные SQL-миграции `NNNNNN_name.up.sql` и обратные `NNNNNN_name.down.sql`.
- `frontend/` — SolidJS + Vite + TypeScript SPA.
  - `src/api/` — единственная точка доступа к API и TanStack Query-кэшу.
  - `src/components/pages/` — страницы, `src/components/common/` — повторно используемые компоненты и читалки, `src/styles/` — темы и глобальные стили.
  - Колокация принята для компонента, его `*.module.scss`, тестов и Storybook-историй.
- `api/openapi.yaml` — источник истины публичного HTTP-контракта.
- `frontend/src/api/generated/schema.ts` — сгенерированный файл; не редактировать вручную.
- `docs/APP.md` — сухое описание текущего поведения приложения.
- `docker-compose.yml` — production-подобный стек: PostgreSQL, backend, nginx/frontend, мигратор и admin CLI.

## Порядок работы

1. До изменения поведения прочитать относящиеся к задаче пользовательские требования и документацию о текущем поведении.
2. Найти ближайший аналог в коде и следовать его паттерну. Не смешивать несвязанные рефакторинги с функциональной доработкой.
3. При изменении API в одном наборе изменений обновить `api/openapi.yaml`, backend, frontend-обёртки в `src/api/`, затем выполнить `make frontend-generate`.
4. Добавить или обновить тесты на изменённое поведение и выполнить соразмерные проверки.
5. Актуализировать `docs/APP.md`, если меняется пользовательское поведение, формат файла или значимая логика. Документ должен оставаться кратким и фактическим.


## Frontend

- Использовать SolidJS-реактивность и существующие компонентные паттерны; серверное состояние размещать в `src/api/` через TanStack Query, а не в страницах.
- Новые state-changing API-вызовы получают CSRF-токен через `getCsrfToken()` и передают `X-CSRF-Token`; запросы используют `credentials: 'include'`.
- При мутациях поддерживать согласованность TanStack Query-кэша: использовать существующие query keys и либо обновлять кэш, либо инвалидировать связанные списки и сущности.
- Компонентные стили — SCSS modules. Использовать семантические CSS-переменные тем, а не фиксированные цвета, если элемент относится к интерфейсу приложения.
- PDF/DJVU — читалки фиксированной вёрстки, FB2/EPUB — общий адаптивный pipeline. Перед изменением этих зон изучить принятые архитектурные решения.
- Не редактировать вручную `public/pdfjs-assets/` и `public/djvujs-assets/`: они синхронизируются скриптами frontend. Не отключать эту синхронизацию при сборке.

## Проверки и стиль

- Перед передачей изменений запускать минимум релевантные проверки:
  - backend: `make backend-test`;
  - все frontend-тесты: `make frontend-test`;
  - frontend unit: `make frontend-unit-test`;
  - frontend lint: `npm --prefix frontend run lint`;
  - frontend typecheck/build: `make frontend-build`;
  - E2E: `make frontend-e2e-test` (Playwright использует мокированный API; сценарии — в `frontend/tests/`).
- Полный набор: `make test` (Go-тесты, frontend unit-тесты, Playwright E2E и production-сборка frontend). Не запускать E2E без необходимости для узкой правки, но сообщать, если они не были выполнены.
- Форматировать Go через `gofmt`; frontend — Prettier (`npm --prefix frontend run format`). Pre-commit hook запускает `lint-staged` для staged-файлов.
- Соблюдать TypeScript strictness, ESLint и принципы SOLID/KISS. Предпочитать небольшие понятные функции и удалять ставший неиспользуемым код.

## Документация

- Не менять `TODO.md`, `REFACTOR_TODO.md`, `.env`, `backups/`, `output/` или другие пользовательские незапрошенные изменения без явной необходимости задачи.

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles recorded as `Status:` in issue files. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.
