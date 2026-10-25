# Реальные хранилища для интеграционных тестов

Окружение запускает PostgreSQL 17, FTP, explicit/implicit FTPS и Garage 2.5.0
в отдельной Docker network. Облачный аккаунт не нужен. Данные тестовые; серверы
не публикуют порты хоста. Требуются Docker/Compose, `rg`, `tar` и PowerShell 7
либо POSIX shell. Go, GCC, pg_dump/psql 17, Make и Python находятся в тестовом образе.

Из корня репозитория:

```powershell
./backend/testdata/storage/Start-Services.ps1
./backend/testdata/storage/Run-Tests.ps1 -RepoRoot (Get-Location).Path
# Только один сценарий:
./backend/testdata/storage/Run-Tests.ps1 -RepoRoot (Get-Location).Path `
  -GoArguments @('test', '-p', '2', '-race', './internal/httpapi', '-run', 'TestEveryStorage')
```

```sh
./backend/testdata/storage/start-services.sh
./backend/testdata/storage/run-tests.sh "$PWD"
./backend/testdata/storage/run-tests.sh "$PWD" test -p 2 -race ./internal/httpapi -run TestEveryStorage
```

Runner получает все `BOOK_HUB_TEST_*` настройки при создании. Скрипты копируют
снимок `rg --files backend` и Makefile через tar и `docker cp`: это работает и
с удалённым Docker context, без bind mount локальных Windows-путей. `.env`,
runtime-книги, `.runtime/` и node_modules в снимок не входят. Успешный снимок
удаляется, неуспешный остаётся в `/worktrees/` для диагностики.

По умолчанию используется префикс `book-hub-storage-test`. Для параллельных
окружений выберите другой `-Prefix` и `-RunnerName` в PowerShell либо
`BOOK_HUB_TEST_PREFIX` в shell. `-SkipBuild -Image IMAGE` или
`BOOK_HUB_TEST_SKIP_BUILD=1 BOOK_HUB_TEST_IMAGE=IMAGE` использует уже собранный образ.
Повторный запуск сохраняет существующие сервисы и данные.

## Сервисы и место

- FTP: `storage-fixtures:2121`, explicit FTPS: `:2122`, implicit FTPS: `:2990`.
  Аккаунт `bookhub` / `bookhub-test-password`, каждый режим имеет собственный root.
- TLS-сертификат генерируется при первом запуске на 30 дней для `storage-fixtures`,
  `localhost` и `127.0.0.1`. Только тестовый ключ и сертификат сохраняются в
  игнорируемом `.runtime/` и копируются в контейнеры. CA для Go: `/fixtures/server.pem`.
  Для обновления удалите своё тестовое окружение и `.runtime/`, затем запустите заново.
- Garage: `http://storage-s3:3900`, регион `garage`, бакет `bookhub-test`,
  ключ `GK00000000000000000000000000000001`, secret
  `codex-bookhub-s3-test-secret-000000000000000000000000000000000000`.
  Это открытые тестовые данные, не параметры production.
- PostgreSQL: `postgres:5432`, БД `book_hub_test`, пользователь `postgres`,
  пароль `storage-test-password`. Тесты создают изолированные схемы/БД.

Каждый тест использует уникальный FTP-каталог или S3-префикс и удаляет только
свои объекты. `smoke.py` подтверждает работу сервисов; его успех не заменяет
Go-тесты адаптеров и HTTP.

PostgreSQL использует tmpfs 384 МиБ, `/tmp` и build cache runner — tmpfs по 768 МиБ
с разрешённым исполнением. При остановке контейнера содержимое tmpfs теряется.
Go modules сохраняются в volume `<prefix>-modules`. Для небольших VM используйте
`-p 2` и не запускайте несколько холодных сборок одновременно. Полный набор с
реальными отказами FTPS может занимать несколько минут: отсутствующий файл
проверяется с ограниченным сетевым deadline.

После работы удалите только контейнеры своего префикса (`-runner`, `-postgres`,
`-ftp`, `-s3`) и одноимённую network. Volume `<prefix>-modules` можно оставить
для следующих запусков или удалить отдельно. Production Compose и его volumes
к этому окружению не относятся.
