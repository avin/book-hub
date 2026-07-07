.DEFAULT_GOAL := help

COMPOSE ?= docker compose
BACKEND_DIR ?= backend
FRONTEND_DIR ?= frontend
BACKUP_DIR ?= backups
SERVICE ?=
MIGRATE_ARGS ?= up
COMPOSE_PROJECT_NAME ?= book-hub
STORAGE_VOLUME ?= $(COMPOSE_PROJECT_NAME)_book_storage

ifneq (,$(wildcard .env))
include .env
export
DEV_DATABASE_URL ?= $(subst @postgres:5432,@localhost:5432,$(BOOK_HUB_DATABASE_URL))
DEV_STORAGE_DIR ?= ./data/books
else
DEV_DATABASE_URL ?=
DEV_STORAGE_DIR ?= ./data/books
endif

BOOK_HUB_PUBLIC_PORT ?= 8080
PUBLIC_PORT ?= $(BOOK_HUB_PUBLIC_PORT)
BOOK_HUB_BASE_PATH ?= /
HEALTH_BASE_PATH := $(patsubst %/,%,$(BOOK_HUB_BASE_PATH))
HEALTH_PATH ?= $(if $(HEALTH_BASE_PATH),$(HEALTH_BASE_PATH)/api/readyz,/api/readyz)

.PHONY: help env \
	dev-db dev-backend dev-frontend dev-storybook \
	backend-test frontend-generate frontend-build test \
	docker-build docker-up docker-down docker-stop docker-restart \
	prod-deploy prod-update \
	migrate migrate-up migrate-down migrate-version admin \
	ps logs backend-shell db-shell health-http \
	backup-db backup-storage

help:
	@echo "Book Hub development commands"
	@echo ""
	@echo "Setup:"
	@echo "  make env                    Create .env from .env.example if missing"
	@echo ""
	@echo "Local development:"
	@echo "  make dev-db                 Start PostgreSQL and run migrations"
	@echo "  make dev-backend            Run backend locally with .env-derived values"
	@echo "  make dev-frontend           Run Vite dev server"
	@echo "  make dev-storybook          Run Storybook"
	@echo ""
	@echo "Checks and generation:"
	@echo "  make backend-test           Run Go tests"
	@echo "  make frontend-generate      Regenerate frontend API types"
	@echo "  make frontend-build         Type-check and build frontend"
	@echo "  make test                   Run backend tests and frontend build"
	@echo ""
	@echo "Docker and production:"
	@echo "  make docker-up              Build and start the full stack"
	@echo "  make docker-down            Stop and remove containers"
	@echo "  make prod-deploy            Build images, migrate DB, start services"
	@echo "  make prod-update            Pull images, build, migrate DB, start services"
	@echo ""
	@echo "Operations and debugging:"
	@echo "  make migrate-up             Apply migrations"
	@echo "  make migrate-down           Roll back one migration"
	@echo "  make admin                  Open admin CLI"
	@echo "  make logs [SERVICE=name]    Follow logs"
	@echo "  make ps                     Show compose status"
	@echo "  make db-shell               Open psql in postgres container"
	@echo "  make backend-shell          Open shell in backend container"
	@echo "  make backup-db              Dump PostgreSQL into $(BACKUP_DIR)"
	@echo "  make backup-storage         Archive book storage into $(BACKUP_DIR)"

env:
	@test -f .env || cp .env.example .env

dev-db:
	$(COMPOSE) up -d postgres
	$(COMPOSE) run --rm migrate up
	$(COMPOSE) stop frontend

dev-backend:
	BOOK_HUB_DATABASE_URL="$(DEV_DATABASE_URL)" BOOK_HUB_STORAGE_DIR="$(DEV_STORAGE_DIR)" go -C $(BACKEND_DIR) run ./cmd/book-hub-server

dev-frontend:
	npm --prefix $(FRONTEND_DIR) run dev

dev-storybook:
	npm --prefix $(FRONTEND_DIR) run storybook

backend-test:
	go -C $(BACKEND_DIR) test ./...

frontend-generate:
	npm --prefix $(FRONTEND_DIR) run generate:api

frontend-build:
	npm --prefix $(FRONTEND_DIR) run build

test: backend-test frontend-build

docker-build:
	$(COMPOSE) build

docker-up:
	$(COMPOSE) up -d --build

docker-down:
	$(COMPOSE) down

docker-stop:
	$(COMPOSE) stop

docker-restart:
	$(COMPOSE) restart

prod-deploy:
	$(COMPOSE) build
	$(COMPOSE) run --rm migrate up
	$(COMPOSE) up -d

prod-update:
	$(COMPOSE) pull --ignore-buildable
	$(COMPOSE) build
	$(COMPOSE) run --rm migrate up
	$(COMPOSE) up -d

migrate:
	$(COMPOSE) run --rm migrate $(MIGRATE_ARGS)

migrate-up:
	$(COMPOSE) run --rm migrate up

migrate-down:
	$(COMPOSE) run --rm migrate down

migrate-version:
	$(COMPOSE) run --rm migrate version

admin:
	$(COMPOSE) run --rm admin

ps:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs -f --tail=200 $(SERVICE)

backend-shell:
	$(COMPOSE) exec backend sh

db-shell:
	$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" "$$POSTGRES_DB"'

health-http:
	curl -fsS "http://localhost:$(PUBLIC_PORT)$(HEALTH_PATH)"

backup-db:
	mkdir -p "$(BACKUP_DIR)"
	$(COMPOSE) exec -T postgres sh -c 'pg_dump -U "$$POSTGRES_USER" "$$POSTGRES_DB"' > "$(BACKUP_DIR)/bookhub-$$(date +%Y%m%d-%H%M%S).sql"

backup-storage:
	mkdir -p "$(BACKUP_DIR)"
	docker run --rm -v $(STORAGE_VOLUME):/data/books:ro -v "$$(pwd)/$(BACKUP_DIR):/backup" alpine tar -czf /backup/book-storage-$$(date +%Y%m%d-%H%M%S).tar.gz -C /data/books .
