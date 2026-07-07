# План OpenAPI-спецификации

## Назначение

OpenAPI-спецификация должна быть первым артефактом реализации. Она фиксирует
контракт между будущим frontend, backend и CLI-related административной моделью.
CLI может не вызывать HTTP API, но должен работать с теми же сущностями и
ограничениями.

## Предлагаемое расположение

- `api/openapi.yaml` - основной OpenAPI-файл.
- `api/examples/` - примеры запросов и ответов, если спецификация станет большой.

## Base path

- OpenAPI paths описываются относительно API root.
- При размещении с корня домена API root снаружи доступен как `/api`.
- При размещении из подпапки, например `/hub`, API root снаружи доступен как
  `/hub/api`.

## Auth endpoints

## CSRF

Для cookie-session auth используется CSRF protection по double-submit схеме:

- backend выдает readable CSRF cookie;
- frontend отправляет значение CSRF cookie в header `X-CSRF-Token`;
- state-changing запросы `POST`, `PUT`, `PATCH`, `DELETE` должны проходить CSRF
  проверку;
- при ошибке CSRF возвращается `403 Forbidden` с кодом `csrf_invalid`.

### `GET /api/v1/auth/csrf`

Выдача CSRF token перед state-changing запросами.

Response:

- `csrf_token`

Правила:

- Endpoint выставляет readable CSRF cookie.
- Значение `csrf_token` в response совпадает со значением CSRF cookie.
- `POST /api/v1/auth/register` и `POST /api/v1/auth/login` также требуют
  `X-CSRF-Token`.

### `POST /api/v1/auth/register`

Регистрация пользователя.

Request:

- `login`
- `password`

Response:

- `user_id`
- `is_active: false`

Правила:

- Если публичная регистрация выключена, endpoint возвращает `403 Forbidden` с
  кодом `registration_disabled`.
- Новый пользователь не может войти до активации через CLI.
- Если включена автоматическая активация новых регистраций, пользователь
  создается с `is_active: true`.
- Если автоматическая активация выключена, пользователь создается с
  `is_active: false`.
- Login должен быть уникальным.
- Login валидируется по правилам: 3-64 символа, латинские буквы, цифры, `_`, `-`,
  `.`.
- Login нормализуется в lowercase.
- Уникальность login проверяется без учета регистра: `User` и `user` считаются
  одним login.
- Пароль хранится только в виде password hash.
- Пароль валидируется только как непустая строка длиной не больше 2048 символов.
- Сложность пароля не проверяется: пользователь может выбрать любой пароль.
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

- invalid credentials: `401 Unauthorized` с кодом `invalid_credentials`
- account inactive: `403 Forbidden` с кодом `account_inactive`

### `POST /api/v1/auth/logout`

Завершение сессии.

Правила:

- Logout идемпотентный.
- Возвращает `204 No Content`, даже если активной сессии нет.

### `GET /api/v1/me`

Получение текущего пользователя.

Response:

- `id`
- `login`
- `is_active`
- `quota_bytes`
- `used_bytes`
- `created_at`

Ошибки:

- Без валидной активной сессии возвращает `401 Unauthorized` с кодом
  `unauthorized`.

### `PUT /api/v1/me/password`

Самостоятельная смена пароля активированным пользователем.

Request:

- `current_password`
- `new_password`

Правила:

- При самостоятельной смене пароля текущая сессия остается активной.
- Все остальные сессии пользователя отзываются.

## User settings endpoints

### `GET /api/v1/me/settings`

Возвращает opaque JSON настроек frontend.

Правила:

- Если настройки еще не сохранялись, возвращается пустой объект `{}`.

### `PUT /api/v1/me/settings`

Сохраняет opaque JSON настроек frontend.

Response:

- Сохраненный JSON object.

Правила:

- Backend валидирует только то, что тело является JSON object.
- JSON array, string, number, boolean и null отклоняются с `validation_error`.
- Backend не парсит и не индексирует внутреннюю структуру.
- Размер JSON object ограничен хардкодом 64 KB. При превышении возвращается
  `validation_error`.

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

Правила пагинации:

- `limit` по умолчанию `50`.
- Максимальный `limit` - `200`.
- `offset` по умолчанию `0`.
- Отрицательные `limit` или `offset` возвращают `validation_error`.

Правила сортировки:

- Default sort: `created_at_desc`.
- Допустимые значения `sort`: `created_at_desc`, `created_at_asc`, `title_asc`,
  `title_desc`, `updated_at_desc`, `updated_at_asc`, `progress_desc`,
  `progress_asc`.
- Сортировка по title выполняется без учета регистра.
- Сортировка `updated_at_*` использует `user_books.updated_at`, не
  `reading_progress.updated_at`.
- При сортировке `progress_*` отсутствие строки прогресса считается как `0`.

Правила поиска:

- `q` нормализуется через trim.
- Если после trim `q` пустой, фильтр поиска не применяется.
- `q` ищет только по `title`.
- Сравнение выполняется как case-insensitive substring match.
- Поиск по содержимому книг не поддерживается и не планируется.

Правила фильтрации по тегам:

- `tags` - массив строк.
- `tags` нормализуются через trim.
- Пустые tags удаляются без ошибки.
- Дубликаты tags удаляются без учета регистра.
- Если после нормализации `tags` пустой, фильтр по тегам не применяется.
- Если указано несколько тегов, в выборку попадают только книги, у которых есть
  все указанные теги.
- Сравнение tags при фильтрации выполняется без учета регистра.

Правила фильтрации по избранному:

- Если `favorite` не передан или равен `null`, фильтр по избранному не
  применяется.
- `favorite: true` возвращает только избранные книги.
- `favorite: false` возвращает только не избранные книги.

Response:

- `items`
- `total`
- `limit`
- `offset`

Book DTO:

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
  `GET /api/v1/books/{book_id}/cover?variant=thumbnail` по `book_id` из списка.

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
- Формат определяется только по расширению имени файла.
- Расширение проверяется без учета регистра.
- В ответах и БД формат хранится нормализованным lowercase значением: `pdf` или
  `fb2`.
- Backend вычисляет hash файла.
- Backend проверяет квоту по размеру загружаемой книги.
- Title нормализуется через trim.
- Если title не передан, используется имя файла без последнего расширения.
- Если после нормализации title пустой, используется `untitled`.
- Если title длиннее 512 символов после нормализации, он обрезается до 512
  символов без ошибки.
- Одинаковые title у одного пользователя разрешены.
- Tags нормализуются: trim каждого тега, пустые теги удаляются без ошибки.
- Дубликаты tags удаляются без учета регистра, сохраняется первое написание.
- Максимум 50 tags на книгу; лишние tags отбрасываются без ошибки.
- Максимальная длина одного tag - 64 символа после trim; более длинные tags
  обрезаются без ошибки.
- Если физический файл уже есть, повторно на диск он не сохраняется.
- Если у пользователя уже есть книга с тем же hash, upload отклоняется с ошибкой
  `duplicate_book`.
- Если hash уже существует в `book_files`, но расширение нового upload
  определяет другой format, upload отклоняется с ошибкой `unsupported_format`.
- Содержимое файла не анализируется для определения формата.
- Обложка при загрузке книги не передается. Для обложки используется отдельный
  endpoint `PUT /api/v1/books/{book_id}/cover`.
- Порядок ключевых проверок upload: format/hash, duplicate book у пользователя,
  quota.

Response:

- `id`
- `title`
- `tags`
- `favorite`
- `format`
- `size_bytes`
- `progress_percent`
- `created_at`
- `updated_at`

Правило:

- Для новой книги `progress_percent` возвращается как `0`.

### `GET /api/v1/books/{book_id}`

Получение метаданных одной книги текущего пользователя.

Response:

- Book DTO.

### `PATCH /api/v1/books/{book_id}`

Изменение пользовательских метаданных.

Request:

- `title` optional
- `tags` optional
- `favorite` optional

Response:

- Book DTO.

Правила:

- PATCH частичный: отсутствующие поля не меняются.
- Title нормализуется через trim.
- Если после нормализации title пустой, используется `untitled`.
- Если title длиннее 512 символов после нормализации, он обрезается до 512
  символов без ошибки.
- Одинаковые title у одного пользователя разрешены.
- Если поле `tags` передано, tags заменяются целиком новым массивом после
  нормализации.
- Tags нормализуются: trim каждого тега, пустые теги удаляются без ошибки.
- Дубликаты tags удаляются без учета регистра, сохраняется первое написание.
- Максимум 50 tags на книгу; лишние tags отбрасываются без ошибки.
- Максимальная длина одного tag - 64 символа после trim; более длинные tags
  обрезаются без ошибки.

### `PUT /api/v1/books/{book_id}/cover`

Загрузка или замена обложки книги клиентом.

Content type:

- `multipart/form-data`

Fields:

- `file`

Правила:

- Доступно только владельцу пользовательской записи.
- Backend не извлекает обложку из книги.
- Обложку присылает клиент.
- Поддерживаемые форматы обложек: `jpg`, `jpeg`, `png`, `webp`.
- Формат обложки определяется только по расширению имени файла без учета
  регистра.
- Формат `jpeg` нормализуется в `jpg`.
- Содержимое файла обложки декодируется только для проверки валидности и
  создания миниатюры. Невалидное изображение отклоняется с `validation_error`.
- Backend сохраняет оригинал и JPEG-миниатюру размером не больше `184x240` px с
  сохранением пропорций.
- Максимальный размер файла обложки: 1 MB.
- Размер обложки не учитывается в пользовательской книжной квоте.
- Повторный upload заменяет предыдущую обложку.
- Успешная загрузка или замена возвращает `204 No Content`.
- Если книга не существует или не принадлежит пользователю, возвращается
  `404 not_found`.

### `DELETE /api/v1/books/{book_id}`

Удаление книги из библиотеки пользователя.

Правила:

- Удаляется пользовательская запись.
- Прогресс и пользовательские метаданные удаляются.
- Физический файл удаляется только если больше нет ссылок от других
  пользовательских записей.
- Успешное удаление возвращает `204 No Content`.
- Если книга не существует или не принадлежит пользователю, возвращается
  `404 not_found`.

### `GET /api/v1/books/{book_id}/file`

Получение файла книги для viewer.

Правила:

- Доступен только владельцу пользовательской записи.
- Отдает весь файл целиком.
- Content-Type для `pdf`: `application/pdf`.
- Content-Type для `fb2`: `application/xml`.
- Content-Disposition: `inline`.
- Filename для Content-Disposition формируется из sanitized `title` и `format`.

### `GET /api/v1/books/{book_id}/cover`

Получение обложки книги.

Query:

- `variant` optional: `full` или `thumbnail`, default `full`.

Правила:

- Доступно только владельцу пользовательской записи.
- `variant=full` отдает оригинальный файл обложки целиком.
- `variant=thumbnail` отдает JPEG-миниатюру. Если миниатюра отсутствует у
  старой записи после миграции, backend отдает оригинал.
- Content-Type для `jpg`: `image/jpeg`.
- Content-Type для `png`: `image/png`.
- Content-Type для `webp`: `image/webp`.
- Content-Disposition: `inline`.
- Если обложка не загружена, возвращается `404 not_found`.
- Если книга не существует или не принадлежит пользователю, возвращается
  `404 not_found`.

### `DELETE /api/v1/books/{book_id}/cover`

Удаление обложки книги.

Правила:

- Доступно только владельцу пользовательской записи.
- Если обложка есть, оригинал и миниатюра удаляются, а `cover_path` и
  `cover_thumbnail_path` очищаются.
- Если обложки нет, запрос все равно возвращает `204 No Content`.
- Если книга не существует или не принадлежит пользователю, возвращается
  `404 not_found`.

## Reading progress endpoints

### `GET /api/v1/books/{book_id}/progress`

Получение прогресса чтения.

Response:

- `progress_percent`
- `updated_at`

Правила:

- Если строки прогресса нет, возвращается `progress_percent: 0` и
  `updated_at: null`.

### `PUT /api/v1/books/{book_id}/progress`

Сохранение прогресса чтения.

Request:

- `progress_percent`

Response:

- `progress_percent`
- `updated_at`

Правила:

- `progress_percent` должен быть дробным числом в диапазоне `0..100`.
- Значение меньше `0` или больше `100` отклоняется с `validation_error`.
- Viewer сам интерпретирует позицию чтения по проценту. Дополнительные данные
  позиции backend не хранит.

### `DELETE /api/v1/books/{book_id}/progress`

Сброс прогресса чтения.

Правила:

- Удаляет строку `reading_progress`.
- Если строки прогресса уже нет, все равно возвращает `204 No Content`.
- Если книга не существует или не принадлежит пользователю, возвращается
  `404 not_found`.

## Health endpoints

### `GET /healthz`

Liveness check относительно API root.

### `GET /readyz`

Readiness check относительно API root с проверкой соединения с PostgreSQL и
доступности storage path.

## Ошибки

## Timestamps

- Все timestamps API отдаются в UTC в формате RFC3339.

Все ошибки API должны иметь единый формат:

- `code`
- `message`
- `details` optional
- `request_id`

Правила:

- Backend всегда генерирует `request_id` сам.
- Входящий request header `X-Request-Id`, если клиент его прислал, игнорируется.
- Каждый HTTP response содержит header `X-Request-Id`.
- При ошибке `request_id` в body совпадает с `X-Request-Id`.

Примеры кодов:

- `validation_error`
- `unauthorized`
- `forbidden`
- `not_found`
- `quota_exceeded`
- `unsupported_format`
- `duplicate_book`
- `account_inactive`
- `registration_disabled`
- `csrf_invalid`

Правила ownership:

- Для ресурсов, принадлежащих пользователю, чужой ресурс возвращается как
  `404 not_found`, а не `403`, чтобы не раскрывать его существование.
- Для приватных endpoints без валидной активной сессии возвращается
  `401 Unauthorized` с кодом `unauthorized`.
