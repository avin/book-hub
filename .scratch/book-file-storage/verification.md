# Проверка book-file-storage

Дата: 25 октября 2026 года. База задачи 12: `12f1a2b`.

## Выполненные проверки

- Полный Linux backend: `go test -p 2 -race ./...` — **пройден** с настоящими PostgreSQL 17,
  FTP, explicit FTPS, implicit FTPS и Garage 2.5.0. Пропусков протоколов или PostgreSQL
  в этом запуске не было. Пакет backup: 117 с, HTTP: 138 с; Go 1.26.5, pg_dump/psql 17.
- Запуск: `backend/testdata/storage/Run-Tests.ps1 -RepoRoot C:/_/book-hub-wt-12
  -RunnerName codex-book-storage-runner`, с `BOOK_HUB_TEST_FTP_ADDR=storage-fixtures:2121`,
  `BOOK_HUB_TEST_FTPS_EXPLICIT_ADDR=storage-fixtures:2122`,
  `BOOK_HUB_TEST_FTPS_IMPLICIT_ADDR=storage-fixtures:2990`,
  `BOOK_HUB_TEST_FTPS_CA_FILE=/fixtures/server.pem`,
  `BOOK_HUB_TEST_S3_ENDPOINT=http://storage-s3:3900`.
  PostgreSQL URL задан в изолированном runner; production `.env` не использовалась.
- Репозиторный `Start-Services.ps1` — **пройден** на новом префиксе `book-hub-storage-verify`
  с уже собранным тестовым образом: настоящие STOR/RETR/DELE, TLS trust rejection и
  S3 SigV4 put/get/list/delete. Сертификат и тестовый ключ сгенерированы в игнорируемом `.runtime/`.
  PowerShell snapshot runner проверен полным Go-запуском. POSIX-скрипты прошли `sh -n`;
  их отдельный первый запуск на Linux-хосте не повторялся.
- Все четыре приложения собраны: `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build
  -trimpath -ldflags='-s -w' -o DIR/ ./cmd/...` — **пройден**.
- Оба Compose-стека — **пройдены** в отдельных проектах `codex-storage-compose-sqlite`
  и `codex-storage-compose-postgres`: config, свежие миграции, readiness, реальная
  регистрация/вход/загрузка/скачивание/range, writable work/cache volumes, удаление
  оригинала и `--force-recreate` backend с успешным чтением из сохранённого кэша,
  остановка приложения, CLI backup/validate/restore, HTTP после восстановления,
  удаление записи и admin CLI. Восстановление запускалось от `bookhub` через тот же
  временный каталог и `su`, что использует Make. Тестовые проекты и их volumes удалены.
- Go-файлы прошли `gofmt -l`; diff относительно `ee89b7c` не содержит whitespace-ошибок.
  Исправлены CRLF в тикете 01 и смешанная UTF-8/CP1251-кодировка ответа тикета 07.
- Повторная генерация OpenAPI через openapi-typescript 7.13.0 совпала с
  `frontend/src/api/generated/schema.ts` без изменений.
- Frontend, проверенный координатором после изменения API в задаче 03:
  **86 unit-тестов, lint, typecheck/production build и 17 Playwright E2E пройдены**
  на Node 24.18.0/npm 11.16.0. После этого frontend-код и API не изменялись;
  в задаче 12 эти проверки не повторялись.

## Обязательные группы спецификации

| № | Гарантия | Проверенный источник evidence |
|---|---|---|
| 1 | Прежняя локальная установка, кэш выключен, конфигурация | files/config tests, старые пути, оба Compose smoke |
| 2 | Полный цикл каждого протокола | `TestFTP*`, `TestFTPS*`, `TestS3*`, `TestEveryStorageKeepsUploadedBooksCachedAcrossRestart` |
| 3 | Целый оригинал и локальные изображения | files/HTTP tests; remote backup HTTP проверяет cover/thumbnail после удаления source |
| 4 | HTTP-контракт и доступ | `TestRemoteOriginalHTTPContractAndAccessBeforeRetrieval`, download/filename/cache ownership tests |
| 5 | Нет обращений к оригиналу при попадании/старте/readiness | cache controlled-source tests; все реальные протоколы с удалённым оригиналом после restart |
| 6 | Полное получение и целостность | originals/cache/shared receive failure tests; real FTP/S3 corrupt-source tests |
| 7 | LRU, строгий бюджет и активные выдачи | `book_cache_test.go`: LRU/restart, pinned response, ready+receiving budget |
| 8 | Обход кэша и рабочий бюджет | HTTP workspace/cache bypass tests; настоящий ENOSPC отдельно пройден в задаче 07 |
| 9 | Одно получение, отмены, освобождение | `book_fetch_test.go`: one/all cancellation, shared failure/retry, independent offsets/last lease |
| 10 | Заполнение кэша из загрузки | upload seed tests и cache-enabled lifecycle всех пяти типов |
| 11 | Отказы source и запуск | originals/cache tests, auth/temporary error не сбрасывает сессию; backend без доступного original |
| 12 | Надёжное удаление | общий contract SQLite/PostgreSQL, persistence/independent connections и admin deletion |
| 13 | Несколько backend | четыре `TestMultipleBackends*` с реальной PostgreSQL и наблюдаемыми lock barriers |
| 14 | Полный backup без кэша | local/remote backup tests, missing/corrupt/auth failure при прогретом кэше, Make command harness |
| 15 | Переносимость restore | цепочка directory→FTP→explicit FTPS→implicit FTPS→S3→directory для обеих СУБД; source удалён перед HTTP |
| 16 | Старые копии и отказы restore | old SQLite/PG schemas, PG без manifest, `./` tar со служебными файлами, preflight preservation, interrupted/manual cleanup/retry |

## Ограничения проверки

Полная production multi-stage Docker-сборка в этой среде **не выполнялась**: на удалённой
Docker VM оставалось около 270 МиБ свободного диска, недостаточно для второго Go module/build
слоя. Пользовательские images/volumes не удалялись. Compose smoke использовал отдельный
`codex-book-storage-runtime:verify`: текущие Linux CGO=0 binaries поверх уже существовавшего
runtime-образа, с теми же каталогами и ownership `/data/books/tmp` и `/data/cache`.
Это подтверждает запуск, permissions и CLI/HTTP workflow, но не является прохождением
полной production multi-stage Docker-сборки. Сама сборка Go-приложений выполнена отдельно.

Amazon S3 с облачным аккаунтом не тестировался; реальный S3-совместимый сервис — Garage 2.5.0.
Официальный AWS SDK использует стандартный endpoint Amazon при пустом `BOOK_HUB_S3_ENDPOINT`.
Ограничение совместимости другими S3-продуктами не расширялось.
