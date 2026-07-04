# План OpenAPI-спецификации

## Назначение

OpenAPI-спецификация должна быть первым артефактом реализации. Она фиксирует
контракт между будущим frontend, backend и CLI-related административной моделью.
CLI может не вызывать HTTP API, но должен работать с теми же сущностями и
ограничениями.

## Предлагаемое расположение

- `api/openapi.yaml` - основной OpenAPI-файл.
- `api/examples/` - примеры запросов и ответов, если спецификация станет большой.

## Auth endpoints

### `POST /api/v1/auth/register`

Регистрация пользователя.

Request:

- `login`
- `password`

Response:

- `user_id`
- `is_active: false`

Правила:

- Новый пользователь не может войти до активации через CLI.
- Login должен быть уникальным.
- Пароль хранится только в виде password hash.
- Email и восстановление пароля не поддерживаются.

### `POST /api/v1/auth/login`

Вход активированного пользователя.

Request:

- `login`
- `password`

Response:

- `user`
- HttpOnly session cookie.

Ошибки:

- invalid credentials
- account inactive

### `POST /api/v1/auth/logout`

Завершение сессии.

### `GET /api/v1/me`

Получение текущего пользователя.

Response:

- `id`
- `login`
- `is_active`
- `quota_bytes`
- `used_bytes`
- `created_at`

### `PUT /api/v1/me/password`

Самостоятельная смена пароля активированным пользователем.

Request:

- `current_password`
- `new_password`

## User settings endpoints

### `GET /api/v1/me/settings`

Возвращает opaque JSON настроек frontend.

### `PUT /api/v1/me/settings`

Сохраняет opaque JSON настроек frontend.

Правила:

- Backend валидирует только то, что тело является JSON.
- Backend не парсит и не индексирует внутреннюю структуру.
- Нужно ограничить размер JSON, например до 64 KB.

## Books endpoints

### `POST /api/v1/books/query`

Запрос списка книг текущего пользователя.

Request JSON:

- `limit`
- `offset`
- `sort`
- `tags`
- `favorite`
- `q` для поиска по пользовательскому названию.

Правила поиска:

- `q` ищет только по `title`.
- Сравнение выполняется как case-insensitive substring match.
- Поиск по содержимому книг не поддерживается и не планируется.

Правила фильтрации по тегам:

- `tags` - массив строк.
- Если указано несколько тегов, в выборку попадают только книги, у которых есть
  все указанные теги.

Response item:

- `id`
- `title`
- `tags`
- `favorite`
- `format`
- `size_bytes`
- `progress_percent`
- `created_at`
- `updated_at`

Правило для обложки:

- URL обложки не возвращается отдельным полем. Frontend использует
  `GET /api/v1/books/{book_id}/cover` по `book_id` из списка.

### `POST /api/v1/books`

Загрузка одной книги.

Content type:

- `multipart/form-data`

Fields:

- `file`
- `title` optional, default: filename without extension
- `tags` optional
- `favorite` optional, default: false

Правила:

- Поддерживаемые форматы первой версии: `pdf`, `fb2`.
- Backend вычисляет hash файла.
- Backend проверяет квоту по размеру загружаемой книги.
- Если физический файл уже есть, повторно на диск он не сохраняется.
- Если у пользователя уже есть книга с тем же hash, upload отклоняется с ошибкой
  `duplicate_book`.

### `POST /api/v1/books/batch`

Пакетная загрузка книг.

Content type:

- `multipart/form-data`

Fields:

- `files[]`

Правила:

- Batch upload принимает только файлы, без метаданных.
- Title по умолчанию берется из имени каждого файла без расширения.
- Tags по умолчанию пустые.
- Favorite по умолчанию `false`.
- Детальное редактирование выполняется после загрузки через
  `PATCH /api/v1/books/{book_id}`.

### `GET /api/v1/books/{book_id}`

Получение метаданных одной книги текущего пользователя.

### `PATCH /api/v1/books/{book_id}`

Изменение пользовательских метаданных.

Request:

- `title` optional
- `tags` optional
- `favorite` optional

### `DELETE /api/v1/books/{book_id}`

Удаление книги из библиотеки пользователя.

Правила:

- Удаляется пользовательская запись.
- Прогресс и пользовательские метаданные удаляются.
- Физический файл удаляется только если больше нет ссылок от других
  пользовательских записей.

### `GET /api/v1/books/{book_id}/file`

Получение файла книги для viewer.

Правила:

- Доступен только владельцу пользовательской записи.
- Отдает весь файл целиком.

### `GET /api/v1/books/{book_id}/cover`

Получение обложки книги, если она извлечена или загружена.

Рекомендация:

- В первой backend-версии можно возвращать placeholder или `404`, если extraction
  обложек отложен.

## Reading progress endpoints

### `GET /api/v1/books/{book_id}/progress`

Получение прогресса чтения.

Response:

- `progress_percent`
- `updated_at`

### `PUT /api/v1/books/{book_id}/progress`

Сохранение прогресса чтения.

Request:

- `progress_percent`

Правила:

- `progress_percent` должен быть дробным числом в диапазоне `0..100`.
- Viewer сам интерпретирует позицию чтения по проценту. Дополнительные данные
  позиции backend не хранит.

### `DELETE /api/v1/books/{book_id}/progress`

Сброс прогресса чтения.

## Health endpoints

### `GET /healthz`

Liveness check.

### `GET /readyz`

Readiness check с проверкой соединения с PostgreSQL и доступности storage path.

## Ошибки

Все ошибки API должны иметь единый формат:

- `code`
- `message`
- `details` optional

Примеры кодов:

- `validation_error`
- `unauthorized`
- `forbidden`
- `not_found`
- `quota_exceeded`
- `unsupported_format`
- `duplicate_book`
- `account_inactive`
