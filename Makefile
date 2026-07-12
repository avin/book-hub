# Команда по умолчанию: показывает список доступных make-целей.
.DEFAULT_GOAL := help

# Базовые настройки путей и инструментов. Значения можно переопределять при запуске make.
COMPOSE ?= docker compose
BACKEND_DIR ?= backend
FRONTEND_DIR ?= frontend
BACKUP_DIR ?= ./backups
BACKUP ?=
SERVICE ?=
MIGRATE_ARGS ?= up
COMPOSE_PROJECT_NAME ?= book-hub
STORAGE_VOLUME ?= $(COMPOSE_PROJECT_NAME)_book_storage

# Если .env уже создан, подключаем его, чтобы команды использовали реальные настройки проекта.
ifneq (,$(wildcard .env))
include .env
export
DEV_DATABASE_URL ?= $(subst @postgres:5432,@localhost:5432,$(BOOK_HUB_DATABASE_URL))
DEV_STORAGE_DIR ?= ./data/books
else
DEV_DATABASE_URL ?=
DEV_STORAGE_DIR ?= ./data/books
endif

# Настройки HTTP-проверки готовности приложения.
BOOK_HUB_PUBLIC_PORT ?= 8080
PUBLIC_PORT ?= $(BOOK_HUB_PUBLIC_PORT)
BOOK_HUB_BASE_PATH ?= /
HEALTH_BASE_PATH := $(patsubst %/,%,$(BOOK_HUB_BASE_PATH))
HEALTH_PATH ?= $(if $(HEALTH_BASE_PATH),$(HEALTH_BASE_PATH)/api/readyz,/api/readyz)

.PHONY: help env \
	dev-db dev-backend dev-frontend dev-storybook \
	backend-test frontend-test frontend-generate frontend-build test \
	docker-build docker-up docker-down docker-stop docker-restart \
	prod-deploy prod-update \
	migrate migrate-up migrate-down migrate-version admin \
	ps logs backend-shell db-shell health-http \
	backup restore

# Печатает краткую справку по основным командам.
help:
	@echo "Book Hub commands"
	@echo ""
	@echo "Setup:"
	@echo "  env                    Create .env from .env.example if it does not exist"
	@echo ""
	@echo "Local development:"
	@echo "  dev-db                 Start PostgreSQL and apply migrations"
	@echo "  dev-backend            Start backend locally with .env settings"
	@echo "  dev-frontend           Start Vite dev server"
	@echo "  dev-storybook          Start Storybook"
	@echo ""
	@echo "Checks and generation:"
	@echo "  backend-test           Run Go tests"
	@echo "  frontend-test          Run frontend end-to-end tests"
	@echo "  frontend-generate      Regenerate frontend API types"
	@echo "  frontend-build         Type-check and build frontend"
	@echo "  test                   Run backend and frontend tests, then build frontend"
	@echo ""
	@echo "Docker and production:"
	@echo "  docker-up              Build and start the full stack"
	@echo "  docker-down            Stop and remove containers"
	@echo "  prod-deploy            Build images, apply migrations, and start services"
	@echo "  prod-update            Pull images, build, apply migrations, and start services"
	@echo ""
	@echo "Operations and debug:"
	@echo "  migrate-up             Apply migrations"
	@echo "  migrate-down           Roll back one migration"
	@echo "  admin                  Open admin CLI"
	@echo "  logs [SERVICE=name]    Follow logs for all services or one service"
	@echo "  ps                     Show compose service status"
	@echo "  db-shell               Open psql in the PostgreSQL container"
	@echo "  backend-shell          Open shell in the backend container"
	@echo "  backup                 Save a complete database and storage backup"
	@echo "  restore BACKUP=path    Restore database and storage from a backup"

# Создает .env из примера, но не перезаписывает существующий файл.
env:
	@test -f .env || cp .env.example .env

# Запускает PostgreSQL в Docker, применяет миграции и освобождает порт frontend.
dev-db:
	$(COMPOSE) up -d postgres
	$(COMPOSE) run --rm migrate up
	$(COMPOSE) stop frontend

# Запускает Go backend локально; URL базы меняется с docker-host postgres на localhost.
dev-backend:
	BOOK_HUB_DATABASE_URL="$(DEV_DATABASE_URL)" BOOK_HUB_STORAGE_DIR="$(DEV_STORAGE_DIR)" go -C $(BACKEND_DIR) run ./cmd/book-hub-server

# Запускает frontend в режиме разработки через Vite.
dev-frontend:
	npm --prefix $(FRONTEND_DIR) run dev

# Запускает Storybook для разработки и проверки UI-компонентов.
dev-storybook:
	npm --prefix $(FRONTEND_DIR) run storybook

# Запускает все Go-тесты backend.
backend-test:
	go -C $(BACKEND_DIR) test ./...

# Запускает end-to-end тесты frontend через Playwright.
frontend-test:
	npm --prefix $(FRONTEND_DIR) run test:e2e

# Генерирует TypeScript-типы API из api/openapi.yaml.
frontend-generate:
	npm --prefix $(FRONTEND_DIR) run generate:api

# Проверяет TypeScript и собирает production-версию frontend.
frontend-build:
	npm --prefix $(FRONTEND_DIR) run build

# Выполняет основные проверки проекта: backend-тесты, frontend E2E-тесты и сборку.
test: backend-test frontend-test frontend-build

# Собирает Docker-образы без запуска сервисов.
docker-build:
	$(COMPOSE) build

# Собирает и запускает полный Docker-стек в фоне.
docker-up:
	$(COMPOSE) up -d --build

# Останавливает и удаляет compose-контейнеры, сохраняя volumes.
docker-down:
	$(COMPOSE) down

# Останавливает compose-сервисы без удаления контейнеров.
docker-stop:
	$(COMPOSE) stop

# Перезапускает текущие compose-сервисы.
docker-restart:
	$(COMPOSE) restart

# Production-запуск из локального исходного кода: сборка, миграции, старт сервисов.
prod-deploy:
	$(COMPOSE) build
	$(COMPOSE) run --rm migrate up
	$(COMPOSE) up -d

# Production-обновление: подтянуть доступные образы, пересобрать локальные, применить миграции и запустить сервисы.
prod-update:
	$(COMPOSE) pull --ignore-buildable
	$(COMPOSE) build
	$(COMPOSE) run --rm migrate up
	$(COMPOSE) up -d

# Универсальный запуск мигратора; аргументы передаются через MIGRATE_ARGS, например make migrate MIGRATE_ARGS=version.
migrate:
	$(COMPOSE) run --rm migrate $(MIGRATE_ARGS)

# Применяет все новые миграции базы данных.
migrate-up:
	$(COMPOSE) run --rm migrate up

# Откатывает одну миграцию базы данных.
migrate-down:
	$(COMPOSE) run --rm migrate down

# Показывает текущую версию миграций базы данных.
migrate-version:
	$(COMPOSE) run --rm migrate version

# Открывает интерактивный admin CLI внутри Docker.
admin:
	$(COMPOSE) run --rm admin

# Показывает состояние compose-сервисов.
ps:
	$(COMPOSE) ps

# Показывает последние логи и продолжает следить за ними; SERVICE ограничивает вывод одним сервисом.
logs:
	$(COMPOSE) logs -f --tail=200 $(SERVICE)

# Открывает shell внутри запущенного backend-контейнера.
backend-shell:
	$(COMPOSE) exec backend sh

# Открывает psql внутри PostgreSQL-контейнера с настройками из окружения контейнера.
db-shell:
	$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" "$$POSTGRES_DB"'

# Проверяет HTTP readiness endpoint через опубликованный frontend/nginx порт.
health-http:
	curl -fsS "http://localhost:$(PUBLIC_PORT)$(HEALTH_PATH)"

# Создает согласованный backup PostgreSQL и файлового хранилища в одной директории.
backup:
	@set -eu; \
	backup_path="$(BACKUP_DIR)/$$(date +%Y%m%d-%H%M%S)"; \
	mkdir -p "$(BACKUP_DIR)"; \
	mkdir "$$backup_path"; \
	backup_path="$$(cd "$$backup_path" && pwd)"; \
	$(COMPOSE) stop backend frontend; \
	$(COMPOSE) exec -T postgres sh -c 'pg_dump --clean --if-exists --no-owner -U "$$POSTGRES_USER" "$$POSTGRES_DB"' > "$$backup_path/database.sql"; \
	docker run --rm -v $(STORAGE_VOLUME):/data/books:ro alpine tar -czf - -C /data/books . > "$$backup_path/storage.tar.gz"; \
	$(COMPOSE) up -d backend frontend; \
	echo "Backup saved to $$backup_path"

# Восстанавливает PostgreSQL и файловое хранилище из BACKUP=путь-к-директории-снимка.
restore:
	@set -eu; \
	test -n "$(BACKUP)" || { echo "Specify BACKUP, for example: make restore BACKUP=./backup/20260712-120000" >&2; exit 1; }; \
	test -f "$(BACKUP)/database.sql" || { echo "Database dump not found: $(BACKUP)/database.sql" >&2; exit 1; }; \
	test -f "$(BACKUP)/storage.tar.gz" || { echo "Storage archive not found: $(BACKUP)/storage.tar.gz" >&2; exit 1; }; \
	backup_path="$$(cd "$(BACKUP)" && pwd)"; \
	$(COMPOSE) stop backend frontend; \
	$(COMPOSE) exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$$POSTGRES_USER" "$$POSTGRES_DB"' < "$$backup_path/database.sql"; \
	docker run --rm -i -v $(STORAGE_VOLUME):/data/books alpine sh -c 'rm -rf /data/books/* /data/books/.[!.]* /data/books/..?* && tar -xzf - -C /data/books' < "$$backup_path/storage.tar.gz"; \
	$(COMPOSE) up -d backend frontend
