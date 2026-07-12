# Book Hub

Book Hub — персональный self-hosted-архив книг с удобной возможностью чтения в браузере.

## Требования

- Docker Engine с Docker Compose v2.
- Linux-сервер или локальная машина с доступом к Docker.
- Для production-размещения рекомендуется внешний reverse proxy с TLS: Caddy,
  nginx или Traefik.

## Настройка

Создайте рабочий `.env` из примера:

```bash
cp .env.example .env
```

Минимально замените:

- `POSTGRES_PASSWORD`
- пароль внутри `BOOK_HUB_DATABASE_URL`
- `BOOK_HUB_SESSION_SECRET` на случайную строку длиной не меньше 32 символов

`BOOK_HUB_PUBLIC_PORT` задает внешний порт frontend/nginx. Backend наружу не
публикуется и доступен только внутри Docker network.

## Запуск

Соберите и поднимите PostgreSQL, backend и frontend:

```bash
docker compose up -d --build
```

Примените миграции отдельной командой:

```bash
docker compose run --rm migrate up
```

После этого frontend доступен по адресу:

```text
http://localhost:8080/
```

Если вы изменили `BOOK_HUB_PUBLIC_PORT`, используйте выбранный порт.

## Base Path

По умолчанию приложение работает с корня домена:

```env
BOOK_HUB_BASE_PATH=/
```

В этом режиме frontend доступен по `/`, API - по `/api`.

Для размещения в подпапке задайте, например:

```env
BOOK_HUB_BASE_PATH=/hub
```

В этом режиме frontend доступен по `/hub/`, API - по `/hub/api`. После изменения
base path пересоберите frontend:

```bash
docker compose up -d --build frontend
```

## Admin CLI

Admin CLI запускается только через серверную консоль:

```bash
docker compose run --rm admin
```

Получить полный перечень команд внутри CLI:

```text
help
```

Создание и активация первого пользователя:

```text
admin> create user
login: user
password: password
admin> activate user
user login or id: user
```

Если пользователь зарегистрировался через сайт при
`BOOK_HUB_REGISTRATION_AUTO_ACTIVATE=false`, активируйте его той же командой
`activate user`.

## Квоты

Квота по умолчанию задается `BOOK_HUB_DEFAULT_QUOTA_BYTES` и составляет
`2147483648` байт (2 GB). Для изменения квоты пользователя используйте CLI:

```text
admin> set quota
user login or id: user
quota bytes: 1073741824
```

Квоту нельзя уменьшить ниже уже занятого пользователем объема.

## Файлы книг

Файлы книг, оригиналы обложек и миниатюры обложек хранятся в контейнере backend по пути
`BOOK_HUB_STORAGE_DIR`, по умолчанию `/data/books`. В Docker Compose этот путь
сохранен в volume `book_storage`, поэтому файлы переживают рестарты контейнеров.

Для серверного bind mount замените volume у сервисов `backend`, `migrate` и
`admin`, например:

```yaml
volumes:
  - /srv/book-hub/books:/data/books
```

## Миграции

Проверить текущую версию:

```bash
docker compose run --rm migrate version
```

Применить все новые миграции:

```bash
docker compose run --rm migrate up
```

Откатить одну миграцию:

```bash
docker compose run --rm migrate down
```

Миграции не запускаются автоматически при старте backend.

## Обновление

Обычный порядок обновления:

```bash
docker compose pull
docker compose build
docker compose run --rm migrate up
docker compose up -d
```

Если приложение собирается из локального исходного кода, `docker compose pull`
можно пропустить.

## Backup

Одна команда создает согласованный снимок PostgreSQL и файлового хранилища в
отдельной timestamp-директории внутри `./backup/`:

```bash
make backup
```

Для восстановления укажите путь к созданной директории. Команда заменяет текущие
данные PostgreSQL и файлового хранилища:

```bash
make restore BACKUP=./backup/20260712-120000
```

## Production Reverse Proxy

В production обычно ставят внешний reverse proxy с TLS перед frontend/nginx.
Backend напрямую наружу открывать не нужно. При HTTPS-размещении выставьте:

```env
BOOK_HUB_COOKIE_SECURE=true
```

Reverse proxy должен передавать запросы на опубликованный порт frontend/nginx.
API-запросы проксируются frontend/nginx дальше на backend внутри Docker network.
