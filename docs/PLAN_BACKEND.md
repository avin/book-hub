# План backend, БД, хранилища и CLI

## Go backend

Backend должен быть обычным HTTP-сервером на Go, построенным вокруг OpenAPI
контракта.

OpenAPI является source of truth. Go-типы и server handlers генерируются из
`api/openapi.yaml` через `oapi-codegen`.

PostgreSQL доступ выполняется через `pgx`/`pgxpool`, без ORM. SQL-запросы пишутся
явно.

Рекомендуемая структура:

- `backend/cmd/book-hub-server` - HTTP server entrypoint.
- `backend/cmd/book-hub-admin` - admin CLI entrypoint.
- `backend/cmd/book-hub-migrate` - migrations CLI entrypoint.
- `backend/internal/config` - конфигурация.
- `backend/internal/httpapi` - handlers, middleware, request/response mapping.
- `backend/internal/domain` - доменные типы и правила.
- `backend/internal/storage/db` - PostgreSQL repositories.
- `backend/internal/storage/files` - файловое хранилище книг.
- `backend/internal/auth` - password hashing and cookie sessions.
- `backend/migrations/` - SQL migration files.

## Конфигурация backend

Через environment variables:

- `BOOK_HUB_HTTP_ADDR`
- `BOOK_HUB_BASE_PATH`
- `BOOK_HUB_LOG_LEVEL`
- `BOOK_HUB_DATABASE_URL`
- `BOOK_HUB_STORAGE_DIR`
- `BOOK_HUB_DEFAULT_QUOTA_BYTES`
- `BOOK_HUB_REGISTRATION_ENABLED`
- `BOOK_HUB_REGISTRATION_AUTO_ACTIVATE`
- `BOOK_HUB_SESSION_SECRET`
- `BOOK_HUB_SESSION_TTL`
- `BOOK_HUB_COOKIE_SECURE`
- `BOOK_HUB_MAX_UPLOAD_BYTES`
- `BOOK_HUB_MAX_COVER_UPLOAD_BYTES`

Правила:

- `BOOK_HUB_DEFAULT_QUOTA_BYTES` по умолчанию `2147483648` байт, то есть 2 GB.
- `BOOK_HUB_MAX_UPLOAD_BYTES` по умолчанию `314572800` байт, то есть 300 MB.
- `BOOK_HUB_MAX_COVER_UPLOAD_BYTES` по умолчанию `1048576` байт, то есть 1 MB.
- При создании пользователя через сайт или CLI всегда используется default quota.
- Изменение квоты выполняется только отдельной CLI-командой `set quota`.
- `BOOK_HUB_REGISTRATION_ENABLED` управляет доступностью публичной регистрации.
- `BOOK_HUB_REGISTRATION_AUTO_ACTIVATE` управляет значением `is_active` для
  пользователей, созданных через публичную регистрацию.
- `BOOK_HUB_SESSION_SECRET` обязателен, минимальная длина - 32 символа. Если
  значение короче, backend не стартует.
- Backend сам монтирует API на `{BOOK_HUB_BASE_PATH}/api` и не требует strip-prefix
  от reverse proxy.
- Логи пишутся как structured JSON в stdout/stderr.
- `BOOK_HUB_LOG_LEVEL` по умолчанию `info`.
- Каждый HTTP request получает сгенерированный backend-ом `request_id`; входящий
  `X-Request-Id` игнорируется.
- `request_id` пишется в logs, response header `X-Request-Id` и error response
  body.
- Graceful shutdown timeout: 30 секунд, без env-параметра.

## База данных

Правила timestamps:

- Все timestamps хранятся в UTC.
- API отдает timestamps в формате RFC3339.

Правила идентификаторов:

- `users.id`, `book_files.id`, `user_books.id` и `sessions.id` имеют тип UUID.
- UUID генерируются в Go-коде, не в PostgreSQL.

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

- `login` хранится в lowercase.
- `login` уникален без учета регистра.
- Допустимый `login`: 3-64 символа, латинские буквы, цифры, `_`, `-`, `.`.
- Пароль валидируется только как непустая строка длиной не больше 2048 символов.
- Требований к сложности пароля нет.
- После публичной регистрации пользователь создается с `is_active`, зависящим от
  `BOOK_HUB_REGISTRATION_AUTO_ACTIVATE`.
- При создании пользователя через CLI пользователь создается с `is_active = false`.
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
- `format` хранит нормализованный lowercase формат книги: `pdf` или `fb2`.
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
- `cover_path` optional
- `cover_thumbnail_path` optional
- `created_at`
- `updated_at`

Правила:

- Unique constraint `(user_id, book_file_id)` обязателен: один пользователь не
  может добавить один и тот же физический файл несколько раз.
- `title` нормализуется через trim.
- Если после нормализации `title` пустой, сохраняется `untitled`.
- Если `title` длиннее 512 символов после нормализации, он обрезается до 512
  символов без ошибки.
- Одинаковые `title` у одного пользователя разрешены.
- Backend не извлекает обложки из файлов книг.
- Обложку загружает клиент через отдельный endpoint.
- Поддерживаемые форматы обложек: `jpg`, `jpeg`, `png`, `webp`.
- Формат обложки определяется только по расширению исходного имени файла без
  учета регистра.
- Формат `jpeg` нормализуется в `jpg`.
- Содержимое файла обложки декодируется только для проверки валидности и
  создания миниатюры. Невалидное изображение отклоняется с `validation_error`.
- При загрузке backend сохраняет оригинал и JPEG-миниатюру размером не больше
  `184x240` px с сохранением пропорций.
- Максимальный размер файла обложки: 1 MB.
- Размер обложки не учитывается в пользовательской книжной квоте.
- `user_books.updated_at` меняется при изменении метаданных книги или обложки.
- Изменение прогресса чтения не меняет `user_books.updated_at`; для прогресса
  используется `reading_progress.updated_at`.

### `tags`

Справочник тегов пользователя.

Поля:

- `id`
- `user_id`
- `name`
- `created_at`

Правила:

- Теги хранятся отдельно от `user_books`; связь книги и тегов задает
  `user_book_tags`.
- `name` всегда хранится в lowercase.
- Unique constraint `(user_id, name)` обязателен: одинаковые теги разных
  пользователей независимы, одинаковые теги одного пользователя не дублируются.
- Tags нормализуются: trim каждого тега, lowercase, пустые теги удаляются без
  ошибки.
- Дубликаты tags удаляются после lowercase-нормализации.
- Максимум 50 tags на книгу; лишние tags отбрасываются без ошибки.
- Максимальная длина одного tag - 64 символа после trim/lowercase; более
  длинные tags обрезаются без ошибки.
- Если тег больше не связан ни с одной книгой пользователя, backend удаляет
  его как неиспользуемый.

### `user_book_tags`

Many-to-many связь пользовательских книг и тегов.

Поля:

- `user_book_id`
- `tag_id`

Правила:

- Primary key `(user_book_id, tag_id)`.
- При удалении книги связи удаляются через cascade.
- При удалении тега связи удаляются через cascade.

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

- Raw session token хранится только в cookie.
- В БД хранится только hash session token в поле `token_hash`.
- Raw session token генерируется криптографически стойким random значением
  длиной 32 bytes.
- В cookie raw session token кодируется как base64url без padding.
- `token_hash` считается как SHA-256 от raw session token.
- По умолчанию сессия действует 3 года.
- `expires_at` выставляется как `created_at + BOOK_HUB_SESSION_TTL`.
- Если `BOOK_HUB_SESSION_TTL` не задан, используется 3 года.
- При самостоятельной смене пароля текущая сессия остается активной, остальные
  сессии пользователя отзываются.
- При смене пароля через CLI отзываются все сессии пользователя.
- При деактивации пользователя через CLI отзываются все сессии пользователя.

## Миграции

Требования:

- Пока проект в активной разработке без production-данных, целевая схема
  поддерживается в первой миграции `000001_initial`.
- После появления production-данных каждое изменение схемы оформляется
  отдельной новой миграцией.
- Нужны up/down файлы.
- Миграции запускаются только отдельной командой.

Решение:

- Использовать `golang-migrate/migrate`.
- Хранить файлы в `backend/migrations/`.
- `book-hub-migrate down` откатывает одну миграцию за запуск.
- Команды полного сброса БД в MVP нет.
- Не запускать миграции автоматически в production server startup.
- В Docker Compose добавить отдельный one-shot service `migrate` и
  документированную команду запуска.

## File storage

Физическое имя файла книги:

- `<storage_dir>/books/<first_2_hash_chars>/<sha256>.<format>`

Физическое имя файла обложки:

- `<storage_dir>/covers/<user_book_id>.<upload_stamp>.<format>`
- `<storage_dir>/covers/<user_book_id>.<upload_stamp>.thumbnail.jpg`

Правила:

- Загружаемый файл сначала пишется во временный файл.
- Во время загрузки считается SHA-256 и размер.
- SHA-256 считается только по байтам содержимого файла; исходное имя файла в hash
  не входит.
- Формат определяется только по расширению исходного имени файла.
- Расширение проверяется без учета регистра и нормализуется в lowercase формат.
- После проверки квоты файл перемещается в hash-based location.
- Если файл с таким hash уже есть, временный файл удаляется.
- Если hash уже есть в `book_files`, но format нового upload по расширению не
  совпадает с сохраненным format этого hash, upload отклоняется как
  `unsupported_format`.
- DB insert/update и file move должны быть спроектированы так, чтобы после сбоя
  можно было безопасно восстановиться.
- Обложки хранятся отдельно от книг и не дедуплицируются.
- При замене обложки старый оригинал и старая миниатюра удаляются.
- При удалении обложки оригинал и миниатюра удаляются, а `cover_path` и
  `cover_thumbnail_path` очищаются.
- При удалении пользовательской книги или пользователя обложка и миниатюра
  удаляются всегда.

Порядок сохранения нового файла:

- Сначала сохранить temp file и посчитать hash.
- Определить размер и формат по расширению исходного имени файла.
- Начать DB transaction.
- Проверить duplicate book у пользователя.
- Проверить quota.
- Найти `book_files` по hash.
- Если `book_files` уже существует, temp file после commit удаляется.
- Если `book_files` не существует, temp file перемещается в финальный hash-based
  path до commit.
- Создать `book_files`, если physical file новый.
- Создать `user_books`.
- Создать или переиспользовать normalized lowercase tags текущего пользователя.
- Создать связи в `user_book_tags`.
- Commit.
- Если commit не удался после перемещения нового physical file, выполнить
  best-effort удаление уже перемещенного файла.
- Если best-effort удаление не удалось, записать error log с hash/path; отдельного
  recovery flow в MVP нет.
- Temp file удаляется при любой ошибке upload.

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

Режим:

- Только интерактивный режим.

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
- CLI подтверждает destructive operations через `y/N`.
- Удаление пользователя должно удалить его sessions, `user_books`,
  `reading_progress` и физические файлы без оставшихся ссылок.
- Удаление пользователя является hard delete: строка из `users` удаляется
  физически, soft delete не используется.
- После hard delete `login` освобождается и может быть зарегистрирован заново.
- Смена пароля через CLI отзывает все сессии пользователя.
- Деактивация пользователя через CLI отзывает все сессии пользователя.
- Audit log административных действий в БД не ведется.
- CLI пишет сообщения и ошибки в stdout/stderr.

## Безопасность

- Password hashing: Argon2id.
- Параметры Argon2id: memory `64 MiB`, iterations `3`, parallelism `2`, salt
  length `16 bytes`, key length `32 bytes`.
- Session cookie: HttpOnly, SameSite=Lax.
- Session cookie name: `book_hub_session`.
- `Secure` для session cookie управляется `BOOK_HUB_COOKIE_SECURE`.
- По умолчанию `BOOK_HUB_COOKIE_SECURE=false`.
- Session cookie `Path` равен `BOOK_HUB_BASE_PATH`.
- CSRF protection используется для cookie-session auth по double-submit схеме:
  readable CSRF cookie плюс header `X-CSRF-Token` для state-changing запросов.
- CSRF cookie name: `book_hub_csrf`.
- CSRF cookie `Path` равен `BOOK_HUB_BASE_PATH`.
- CSRF cookie `Secure` управляется `BOOK_HUB_COOKIE_SECURE`.
- CSRF token stateless: random token с HMAC-подписью через
  `BOOK_HUB_SESSION_SECRET`.
- Raw часть CSRF token генерируется криптографически стойким random значением
  длиной 32 bytes.
- CSRF token кодируется как base64url без padding.
- CSRF tokens не хранятся в БД.
- Auth middleware на каждый приватный запрос проверяет, что сессия не отозвана и
  пользователь имеет `is_active = true`.
- CORS в MVP не включается: frontend и backend работают same-origin.
- Все book endpoints проверяют ownership через `user_books.user_id`.
- Для чужих пользовательских ресурсов API возвращает `404 not_found`, а не `403`.
- Upload endpoints определяют формат только по расширению исходного имени файла.
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
