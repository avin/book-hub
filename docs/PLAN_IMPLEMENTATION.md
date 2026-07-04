# Пошаговый план реализации

## Фаза 1: OpenAPI

Цель: зафиксировать API-контракт до backend-кода.

Шаги:

1. Создать `api/openapi.yaml`.
2. Описать auth endpoints.
3. Описать user settings endpoints.
4. Описать books endpoints.
5. Описать reading progress endpoints.
6. Описать health endpoints.
7. Описать общую модель ошибок.
8. Добавить схемы DTO.
9. Прогнать OpenAPI validation.
10. Зафиксировать спорные решения в `PLAN.md`.

Критерии готовности:

- OpenAPI-файл валиден.
- Все endpoints из ТЗ представлены.
- Для upload, progress, quota и auth описаны основные ошибки.

## Фаза 2: Backend skeleton

Цель: создать рабочий Go backend без полной бизнес-логики.

Шаги:

1. Инициализировать Go module.
2. Настроить генерацию Go-кода из OpenAPI через `oapi-codegen`.
3. Создать server entrypoint.
4. Создать config loader.
5. Подключить router.
6. Добавить health endpoints.
7. Подключить PostgreSQL client/pool.
8. Добавить structured logging.
9. Добавить базовый graceful shutdown.

Критерии готовности:

- Server стартует локально.
- `/api/healthz` отвечает без БД при base path `/`.
- `/api/readyz` проверяет БД и storage directory при base path `/`.

## Фаза 3: Миграции и DB model

Цель: создать первую версию схемы PostgreSQL.

Шаги:

1. Выбрать migration tool.
2. Добавить initial migration up/down.
3. Создать таблицы users, book_files, user_books, reading_progress и sessions,
   если нужны server-side sessions.
4. Добавить constraints и индексы.
5. Добавить `backend/cmd/book-hub-migrate` с командами `up`, `down`, `version`.
6. Проверить up/down на чистой БД.

Критерии готовности:

- Миграции применяются на пустую БД.
- Down migration откатывает схему.
- Constraints отражают правила ownership, uniqueness и форматов.

## Фаза 4: Auth и users

Цель: реализовать регистрацию, вход, выход и текущего пользователя.

Шаги:

1. Реализовать password hashing.
2. Реализовать CSRF endpoint и CSRF middleware для state-changing запросов.
3. Реализовать регистрацию с учетом `BOOK_HUB_REGISTRATION_ENABLED` и
   `BOOK_HUB_REGISTRATION_AUTO_ACTIVATE`.
4. Реализовать login только для пользователей с `is_active = true`.
5. Реализовать logout.
6. Реализовать auth middleware.
7. Реализовать `GET /api/v1/me`.
8. Реализовать смену пароля пользователем.

Критерии готовности:

- Пользователь с `is_active = false` не может войти.
- Пользователь с `is_active = true` может войти.
- При самостоятельной смене пароля текущая сессия остается активной, остальные
  сессии отзываются.
- Деактивированный пользователь не может продолжать работу по старой сессии.
- Auth middleware закрывает приватные endpoints.

## Фаза 5: Admin CLI

Цель: обеспечить управление пользователями без web admin panel.

Шаги:

1. Создать `backend/cmd/book-hub-admin`.
2. Подключить общий config и DB layer.
3. Реализовать интерактивное меню.
4. Реализовать list/show users.
5. Реализовать create/activate/disable/delete user.
6. Реализовать set/change password.
7. Реализовать set quota с проверкой занятого объема.
8. Добавить подтверждение destructive operations.

Критерии готовности:

- Админ может активировать зарегистрированного пользователя.
- Квоту нельзя уменьшить ниже занятого объема.
- Смена пароля через CLI отзывает все сессии пользователя.
- Деактивация пользователя через CLI отзывает все сессии пользователя.
- Удаление пользователя чистит его данные и не ломает файлы других пользователей.

## Фаза 6: Book upload и storage

Цель: реализовать загрузку книг, дедупликацию и учет квоты.

Шаги:

1. Создать file storage abstraction.
2. Реализовать temp upload.
3. Реализовать SHA-256 calculation.
4. Реализовать format detection по расширению файла для PDF и FB2.
5. Реализовать quota check.
6. Реализовать single upload endpoint.
7. Реализовать обработку duplicate physical file.
8. Реализовать ошибку `duplicate_book`, если у пользователя уже есть книга с тем
   же hash.

Критерии готовности:

- PDF и FB2 загружаются.
- Unsupported format отклоняется.
- Quota exceeded отклоняется.
- Одинаковый файл физически хранится один раз.
- У разных пользователей одинаковая книга считается в квоту каждого.
- Повторная загрузка книги с уже существующим hash в коллекции пользователя
  отклоняется.

## Фаза 7: Book library

Цель: реализовать список, метаданные, обновление и удаление книг.

Шаги:

1. Реализовать `POST /api/v1/books/query` для списка книг с параметрами в body.
2. Реализовать get book metadata.
3. Реализовать patch metadata.
4. Реализовать tags validation.
5. Реализовать favorite flag.
6. Реализовать delete book.
7. Реализовать physical file cleanup when unused.
8. Реализовать file download endpoint с ownership check.
9. Реализовать upload/get/delete cover endpoints с ownership check.

Критерии готовности:

- Пользователь видит только свои книги.
- Удаление книги удаляет пользовательскую запись.
- Файл остается на диске, если используется другим пользователем.
- Файл удаляется с диска, если ссылок больше нет.

## Фаза 8: Reading progress и settings

Цель: реализовать server-side состояние чтения и настроек frontend.

Шаги:

1. Реализовать get progress.
2. Реализовать put progress.
3. Реализовать reset progress.
4. Реализовать settings get/put.
5. Добавить size limits для JSON payload.
6. Добавить tests для progress ownership.

Критерии готовности:

- Прогресс сохраняется на сервере.
- Прогресс доступен с другого устройства после login.
- Сброс прогресса возвращает книгу к 0%.
- Settings хранятся как opaque JSON.

## Фаза 9: Номинальный frontend

Цель: добавить минимальный SolidJS frontend без настоящей UI-логики.

Шаги:

1. Инициализировать SolidJS static app.
2. Создать страницу с текстом `в разработке`.
3. Настроить production build.
4. Настроить отдачу статики в Docker Compose.

Критерии готовности:

- Frontend собирается.
- Открытие сайта показывает `в разработке`.
- Нет лишней UI-логики, которая позже будет мешать полноценной разработке.

## Фаза 10: Docker Compose и README

Цель: сделать локальный/серверный запуск воспроизводимым.

Шаги:

1. Добавить Dockerfile для backend.
2. Добавить Dockerfile для frontend nginx/static container.
3. Добавить `docker-compose.yml`.
4. Добавить PostgreSQL service.
5. Добавить volume для PostgreSQL.
6. Добавить volume/bind mount для book storage.
7. Добавить `.env.example`.
8. Описать установку и запуск в README.
9. Описать запуск миграций.
10. Описать запуск admin CLI через `docker compose run --rm admin`.

Критерии готовности:

- `docker compose up` поднимает сервисы.
- Backend подключается к PostgreSQL.
- Storage directory сохраняет файлы между рестартами.
- README позволяет развернуть проект на сервере.
