# План backend, БД, хранилища и CLI

## Go backend

Backend должен быть обычным HTTP-сервером на Go, построенным вокруг OpenAPI
контракта.

Рекомендуемая структура:

- `cmd/book-hub-server` - HTTP server entrypoint.
- `cmd/book-hub-admin` - admin CLI entrypoint.
- `internal/config` - конфигурация.
- `internal/httpapi` - handlers, middleware, request/response mapping.
- `internal/domain` - доменные типы и правила.
- `internal/storage/db` - PostgreSQL repositories.
- `internal/storage/files` - файловое хранилище книг.
- `internal/auth` - password hashing and cookie sessions.
- `migrations/` - SQL migration files.

## Конфигурация backend

Через environment variables:

- `BOOK_HUB_HTTP_ADDR`
- `BOOK_HUB_BASE_PATH`
- `BOOK_HUB_DATABASE_URL`
- `BOOK_HUB_STORAGE_DIR`
- `BOOK_HUB_DEFAULT_QUOTA_BYTES`
- `BOOK_HUB_SESSION_SECRET`
- `BOOK_HUB_SESSION_TTL`
- `BOOK_HUB_MAX_UPLOAD_BYTES`
- `BOOK_HUB_SETTINGS_MAX_BYTES`

## База данных

### `users`

Поля:

- `id`
- `login`
- `password_hash`
- `is_active`
- `quota_bytes`
- `settings_json`
- `created_at`
- `updated_at`

Правила:

- После регистрации пользователь создается с `is_active = false`.
- Войти может только пользователь с `is_active = true`.
- Активация и деактивация через CLI меняют только `is_active`.

### `book_files`

Физические файлы, дедуплицированные по hash.

Поля:

- `id`
- `sha256`
- `storage_path`
- `size_bytes`
- `format`
- `created_at`

Правила:

- `sha256` unique.
- `format` хранит нормализованный формат книги, например `pdf` или `fb2`.
- Отдельное оригинальное расширение файла не хранится.
- `ref_count` не хранится.
- Количество ссылок на физический файл считается из `user_books`.
- При удалении пользовательской книги или пользователя физический файл удаляется
  только если после удаления пользовательских записей на него больше нет ссылок.

### `user_books`

Книги в библиотеке конкретного пользователя.

Поля:

- `id`
- `user_id`
- `book_file_id`
- `title`
- `favorite`
- `tags`
- `cover_path` optional
- `created_at`
- `updated_at`

Правила:

- `tags` хранится как `text[]`.
- Unique constraint `(user_id, book_file_id)` обязателен: один пользователь не
  может добавить один и тот же физический файл несколько раз.

### `reading_progress`

Поля:

- `user_book_id`
- `progress_percent` decimal/double precision
- `updated_at`

Правила:

- `user_book_id` unique.
- `progress_percent` должен поддерживать дробные значения в диапазоне `0..100`.
- Viewer сам интерпретирует позицию чтения по `progress_percent`.
- Сброс прогресса удаляет строку `reading_progress`.
- Отсутствие строки прогресса трактуется как 0%.

### `sessions`

Server-side сессии для cookie-session auth.

Поля:

- `id`
- `user_id`
- `token_hash`
- `expires_at`
- `created_at`
- `revoked_at`

Правила:

- По умолчанию сессия действует 3 года.
- `expires_at` выставляется как `created_at + BOOK_HUB_SESSION_TTL`.
- Если `BOOK_HUB_SESSION_TTL` не задан, используется 3 года.

## Миграции

Требования:

- Каждое изменение схемы оформляется отдельной миграцией.
- Нужны up/down файлы.
- Миграции запускаются только отдельной командой.

Рекомендация:

- Использовать `golang-migrate/migrate`.
- Хранить файлы в `migrations/`.
- Не запускать миграции автоматически в production server startup.
- В Docker Compose добавить отдельный one-shot service или документированную
  команду.

## File storage

Физическое имя файла:

- `<storage_dir>/<first_2_hash_chars>/<sha256>.<ext>`

Правила:

- Загружаемый файл сначала пишется во временный файл.
- Во время загрузки считается SHA-256 и размер.
- После проверки квоты файл перемещается в hash-based location.
- Если файл с таким hash уже есть, временный файл удаляется.
- DB insert/update и file move должны быть спроектированы так, чтобы после сбоя
  можно было безопасно восстановиться.

Рекомендация для первой версии:

- Сначала сохранить temp file и посчитать hash.
- Проверить quota.
- Начать DB transaction.
- Найти или создать `book_files`.
- Создать `user_books`.
- Commit.
- После commit удалить temp file, если physical file уже существовал.
- Для нового physical file переместить temp file до commit или использовать
  cleanup job для orphan files. Перед реализацией нужно выбрать точный порядок.

## Quota accounting

Занятый объем пользователя:

```sql
select coalesce(sum(bf.size_bytes), 0)
from user_books ub
join book_files bf on bf.id = ub.book_file_id
where ub.user_id = $1;
```

Правила:

- При upload проверять `used_bytes + new_file_size <= quota_bytes`.
- Для duplicate physical file размер все равно считается в квоту пользователя.
- При изменении квоты через CLI проверять `new_quota_bytes >= used_bytes`.

## Admin CLI

CLI должен использовать тот же config и database layer, что backend.

Режимы:

- Интерактивный режим по умолчанию.
- Неинтерактивные команды полезны для автоматизации, но могут быть добавлены
  после MVP.

Команды интерактивного режима:

- list users
- show user
- create user
- activate user
- disable user
- delete user
- set quota
- set password
- show storage stats

Правила:

- CLI не требует пароля.
- CLI должен явно подтверждать destructive operations.
- Удаление пользователя должно удалить его `user_books`, `reading_progress` и
  физические файлы без оставшихся ссылок.

## Безопасность

- Password hashing: Argon2id или bcrypt.
- Рекомендация: Argon2id с параметрами, зафиксированными в коде и документации.
- Session cookie: HttpOnly, Secure, SameSite=Lax.
- Все book endpoints проверяют ownership через `user_books.user_id`.
- Upload endpoints проверяют MIME/extension/signature, но не доверяют только
  имени файла.
- Endpoint получения файла отдает весь файл целиком после проверки authorization.
- Логи не должны содержать пароли, session tokens и полный JSON настроек.
- Пользовательского восстановления пароля нет; смена забытого пароля выполняется
  только администратором через CLI.

## Тестирование backend

Минимальный набор:

- Unit tests для quota calculation.
- Unit tests для file hash/dedup logic.
- Integration tests для auth flow.
- Integration tests для upload/delete lifecycle.
- Integration tests для migration up/down.
- CLI tests на критичные admin operations.
