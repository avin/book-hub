# Refactor TODO

Результат статического аудита backend, frontend, API, тестов и сборочного контура. В список включены только подтверждённые проблемы или явно выраженный технический долг. Приоритеты: `P0` — риск потери данных/нарушения инварианта, `P1` — заметный дефект или дорогая поддержка, `P2` — плановый рефакторинг, `P3` — локальная чистка.

## P0 — целостность данных и контракт загрузки

- [ ] **Сделать загрузку книги атомарной относительно дедупликации файла.**  
  Файлы: `backend/internal/httpapi/server.go`, `backend/internal/storage/db/store.go`, `backend/internal/storage/files/files.go`.  
  Сейчас последовательность `GetBookFileByHash` → `MoveBook` → `CreateBook` не защищена от параллельных запросов. Два клиента с одним новым SHA-256 могут одновременно не увидеть запись, а проигравший `CreateBook` после конфликта удалит общий детерминированный `StoragePath`. Это способно удалить файл, на который уже ссылается успешная запись другого пользователя. Нужны транзакционная координация создания записи (например, уникальный insert с повторным чтением/блокировкой), безопасная публикация файла и компенсация, которая удаляет только файл, принадлежащий текущей операции.

- [ ] **Проверять квоту в той же транзакции, где создаётся `user_books`.**  
  Файлы: `backend/internal/httpapi/server.go`, `backend/internal/storage/db/store.go`.  
  `user.UsedBytes + temp.Size` проверяется до создания книги. Несколько параллельных загрузок одного пользователя проходят проверку одновременно и суммарно превышают квоту. Перенести проверку в репозиторий: заблокировать пользователя или использовать условный SQL-запрос/счётчик квоты в транзакции.

- [ ] **Вынести согласование БД и файлового хранилища в явный workflow с восстановлением.**  
  Файлы: `backend/internal/httpapi/server.go`, `backend/internal/storage/db/store.go`, `backend/internal/storage/files/files.go`, `backend/cmd/book-hub-admin/main.go`.  
  Создание сначала публикует файл, а затем пишет БД; удаление сначала коммитит БД, а потом делает `DeleteBestEffort`. При сбое остаются сироты, а при неудачной компенсации состояние не видно системе. Нужны состояния/журнал операций либо периодический reconciler, который безопасно находит и удаляет неиспользуемые файлы.

- [ ] **Перенести проверку формата и содержимого книг на backend.**  
  Файлы: `backend/internal/httpapi/server.go`, `frontend/src/components/pages/UploadPage/coverExtraction.ts`, `frontend/src/components/common/EpubReader/epubParser.ts`.  
  Сервер определяет формат только по расширению файла. Валидация EPUB/DJVU выполняется лишь в браузере и легко обходится прямым запросом; в библиотеку можно записать нечитаемый или не соответствующий заявленному формату файл. Это противоречит определению «корректного EPUB/DJVU» в `CONTEXT.md`. Валидация на клиенте должна остаться UX-оптимизацией, а источником истины — backend.

## P1 — API, надёжность и тестируемость backend

- [ ] **Устранить расхождение OpenAPI и реализации у `BookQueryRequest.limit`.**  
  Файлы: `api/openapi.yaml`, `backend/internal/domain/domain.go`, `backend/internal/httpapi/server.go`.  
  В контракте `limit: 0` допустим и выглядит как размер страницы 0, но `NormalizeBookQuery` заменяет любой ноль на 50. Либо запретить ноль в OpenAPI, либо различать отсутствующее значение и явно переданный ноль.

- [ ] **Добавить в OpenAPI код ошибки `service_unavailable`.**  
  Файлы: `api/openapi.yaml`, `backend/internal/httpapi/server.go`.  
  `/readyz` реально возвращает этот код, но он отсутствует в enum `ErrorCode`. Сгенерированные клиенты получают неполный контракт.

- [ ] **Не определять бизнес-ошибки по тексту имени SQL-constraint.**  
  Файл: `backend/internal/storage/db/store.go`.  
  `CreateUser` и `CreateBook` делают `strings.Contains(err.Error(), ...)`. Формат сообщения драйвера и имя constraint — неустойчивый внутренний API миграций. Использовать `*pgconn.PgError` и `Code`/`ConstraintName`; покрыть это интеграционными тестами PostgreSQL.

- [ ] **Сделать загрузку конфигурации fail-fast.**  
  Файл: `backend/internal/config/config.go`.  
  Неверные значения `BOOK_HUB_*` для чисел, boolean и duration молча заменяются значениями по умолчанию. В production это может незаметно включить регистрацию, ослабить лимиты или изменить срок сессии. Возвращать ошибку с именем переменной, валидировать диапазоны и допустимые уровни лога.

- [ ] **Разделить монолитный HTTP-сервер.**  
  Файл: `backend/internal/httpapi/server.go` (1017 строк).  
  В одном файле смешаны маршрутизация, middleware, auth, multipart-загрузка, все handlers, DTO, сериализация ошибок, logger и lifecycle HTTP-сервера. Разнести минимум на `router`, `middleware`, `auth_handlers`, `book_handlers`, `settings_handlers`, `responses` и `server_lifecycle`; общие зависимости передавать через узкие сервисы.

- [ ] **Разделить `storage.Store` и обе его реализации по предметным портам.**  
  Файлы: `backend/internal/storage/store.go`, `backend/internal/storage/db/store.go` (706 строк), `backend/internal/storage/memory/store.go` (610 строк).  
  Один интерфейс содержит более 30 методов пользователей, сессий, настроек, книг, тегов, обложек и прогресса. Это нарушает ISP, делает моки тяжёлыми и дублирует бизнес-правила между memory/DB. Выделить `UserRepository`, `SessionRepository`, `BookRepository`, `SettingsRepository` и сервис сценария загрузки.

- [ ] **Исправить неудачную абстракцию `bookQuerier`.**  
  Файл: `backend/internal/storage/db/store.go`.  
  Интерфейс объявляет `QueryRow`, но `scanBook` сразу приводит его к другому анонимному интерфейсу с `Query`. Это скрытая точка panic и не описывает фактическую зависимость. Объявить минимальный явный интерфейс с `Query` либо передавать конкретный `pgx`-совместимый queryer.

- [ ] **Убрать повторное отзыв сессий в admin CLI.**  
  Файл: `backend/cmd/book-hub-admin/main.go`.  
  `setActive(..., false)` вызывает `SetUserActive`, который и в DB, и in-memory уже отзывает сессии, а затем снова вызывает `RevokeUserSessions`. Оставить одно место ответственности — репозиторий или CLI.

- [ ] **Добавить интеграционные тесты PostgreSQL и конкурентные сценарии.**  
  Файлы: `backend/internal/storage/db/`, `backend/internal/httpapi/server_test.go`.  
  HTTP-тесты запускаются только с `memory.Store`, а у DB-реализации нет тестов. Поэтому не проверяются реальные SQL, FK, migration-совместимость, обработка constraint, дедупликация и квоты при конкуренции. Поднять PostgreSQL в testcontainers/Compose для тестов репозитория и добавить race/concurrency cases.

## P1 — frontend: память, доступность и локализация

- [ ] **Не держать крупные файлы книг в кеше TanStack Query без ограничений.**  
  Файл: `frontend/src/api/books.ts`.  
  `createBookFileBlobQuery` кеширует EPUB Blob, а `createBookFileTextQuery` — весь FB2-текст. При разрешённых upload до 300 МиБ это удерживает большие объекты после выхода из читалки и дублируется распаковкой/парсингом. Задать малый `gcTime`, удалять query при unmount, либо передавать поток/URL в читалку без глобального query cache.

- [ ] **Убрать синхронную тяжёлую обработку EPUB из UI-потока.**  
  Файл: `frontend/src/components/common/EpubReader/epubParser.ts`.  
  `unzipSync`, XML-парсинг, обработка CSS, base64-конвертация ресурсов и построение модели выполняются на главном потоке. Лимит распакованного EPUB — 512 МиБ, поэтому допустимый файл может надолго заморозить вкладку и потребить кратно больше памяти. Перенести разбор в Web Worker, ввести отдельные лимиты на текст/изображения и отказ до полной распаковки.

- [ ] **Завершить локализацию читалок и HTML-документа.**  
  Файлы: `frontend/src/components/common/DjvuReader/DjvuReader.tsx`, `frontend/src/components/common/PdfReader/PdfReader.tsx`, `frontend/src/components/common/TocPanel/TocPanel.tsx`, `frontend/src/components/common/Fb2Reader/Fb2Reader.tsx`, `frontend/src/components/common/Fb2Reader/ReaderChrome/ReaderChrome.tsx`, `frontend/src/components/common/TagsSelect/TagsSelect.tsx`, `frontend/index.html`.  
  При переключении на английский остаются русские `Оглавление`, `Оглавление недоступно`, `Ширина страницы`, `Сноска`; у удаления тега захардкожен английский `Remove`. Атрибут `<html lang>` всегда `ru`. Перенести строки в `messages.ts` и синхронизировать `document.documentElement.lang` с `I18nProvider`.

- [ ] **Довести модальные и выпадающие элементы до доступного поведения.**  
  Файлы: `frontend/src/components/common/ModalDialog/ModalDialog.tsx`, `frontend/src/components/common/Dropdown/Dropdown.tsx`, `frontend/src/components/common/TagsSelect/TagsSelect.tsx`, `frontend/src/components/common/Menu/Menu.tsx`.  
  `ModalDialog` не ловит Escape, не переводит и не удерживает фокус, не возвращает его триггеру и не изолирует фон. Самописный tags-select не имеет семантики combobox/listbox и полного keyboard flow; dropdown/menu не реализуют управление фокусом. Вынести общие primitives для focus trap, dismiss и roving focus, затем покрыть keyboard-тестами.

- [ ] **Освобождать или ограничивать per-book browser preferences.**  
  Файл: `frontend/src/storage/browserPreferences.ts`.  
  `pageWidthOverflows`, `horizontalScrollPositions` и `filterChains` растут для каждого когда-либо открытого ID и не очищаются при удалении книги. Добавить `removeBookPreferences(bookId)`, вызывать его из delete mutation, ввести лимит/версию миграции.

- [ ] **Устранить рассинхронизацию клиента и backend в определении PDF.**  
  Файлы: `frontend/src/components/pages/UploadPage/UploadPage.tsx`, `frontend/src/components/pages/UploadPage/coverExtraction.ts`, `backend/internal/domain/domain.go`.  
  Клиент принимает любой файл с MIME `application/pdf` даже без `.pdf`, а server определяет формат исключительно по расширению. Drag-and-drop может добавить файл, который заведомо завершится ошибкой API. Вынести единые правила выбора формата; окончательная проверка должна быть серверной.

## P2 — декомпозиция и устранение дублирования frontend

- [ ] **Выделить общий движок читалки фиксированной вёрстки.**  
  Файлы: `frontend/src/components/common/PdfReader/PdfReader.tsx` (1910 строк), `frontend/src/components/common/DjvuReader/DjvuReader.tsx` (1208 строк).  
  В двух компонентах повторяются ширина/overflow, scroll anchors, восстановление горизонтальной позиции, virtual rendering queue, IntersectionObserver, панели, фильтры, поиск, оглавление и navigation history. DJVU импортирует CSS и компоненты из папки PDF. Вынести `FixedLayoutReader`, `usePageViewport`, `useFixedLayoutPreferences`, `useFixedLayoutFilters` и адаптеры `PdfDocumentAdapter`/`DjvuDocumentAdapter`.

- [ ] **Переименовать PDF-специфичные сущности, уже используемые DJVU, в fixed-layout.**  
  Файлы: `frontend/src/components/common/PdfReader/pdfFilters.ts`, `pdfWebglFilter.ts`, `pdfPageSettings.ts`, `PdfFilterPanel/`, `frontend/src/storage/browserPreferences.ts`, `DjvuReader.tsx`.  
  Типы `PdfFilterChain`, `Pdf*Filter`, функции `getPdfReader*` и UI `PdfFilterPanel` обслуживают обе фиксированные читалки. Legacy-обёртки `getPdfReader*` вместе с новым `fixedLayout` создают двойной публичный API. Провести одну миграцию localStorage и оставить временные deprecated-адаптеры только при реальной необходимости.

- [ ] **Разбить `Fb2Reader` на parser adapter, layout/virtualization, reader state и presentation.**  
  Файл: `frontend/src/components/common/Fb2Reader/Fb2Reader.tsx` (1191 строк).  
  Компонент одновременно парсит вход, считает виртуальную раскладку, управляет resize/scroll-якорями, настройками, поиском, историей, панелями и сносками. EPUB также принуждён к `Fb2Document`/`Fb2Block`/`Fb2Reader`, что размывает границу форматов. Оставить формат-независимый `ReflowableReader` и нейтральные типы документа; FB2 и EPUB сделать адаптерами.

- [ ] **Разделить state machine и разметку страницы загрузки.**  
  Файл: `frontend/src/components/pages/UploadPage/UploadPage.tsx` (763 строки).  
  В компоненте находятся параллельная подготовка файлов, abort/generation guards, превью URL, валидация EPUB/DJVU, последовательная batch-загрузка, блокировка страницы и весь UI. Вынести `useBookUploadDrafts`, `DraftPreparationService`, `UploadDraftCard`; заменить набор взаимосвязанных строковых статусов на дискриминированное состояние черновика.

- [ ] **Разделить `TagsSelect` и использовать общие утилиты тегов.**  
  Файлы: `frontend/src/components/common/TagsSelect/TagsSelect.tsx` (737 строк), `frontend/src/components/pages/UploadPage/UploadPage.tsx`, `frontend/src/components/pages/LibraryPage/LibraryPage.tsx`.  
  Компонент совмещает поиск, debounce, async race handling, recent tags, keyboard navigation, измерение width и отображение. `uniqueTags` продублирован в двух страницах. Вынести hook/model, layout collapsed tags и утилиты объединения/нормализации тегов; это упростит и доступность.

- [ ] **Разделить транспорт API и TanStack Query cache orchestration.**  
  Файл: `frontend/src/api/books.ts` (595 строк).  
  В нём перемешаны raw HTTP, ручной `fetch` multipart, CSRF, query factories, мутации и сложная ручная перестройка обычных/бесконечных списков. Вынести `booksApi`, query-key factory и cache-updaters; унифицировать обработку ошибок и multipart вместо двух HTTP-стилей.

- [ ] **Декомпозировать browser preferences по доменам и завершить миграцию схемы.**  
  Файл: `frontend/src/storage/browserPreferences.ts` (467 строк).  
  Один файл знает language, theme, library view, recent tags, настройки адаптивной и фиксированной читалок, JSON-validation и legacy migration. Разделить schema/migration, UI preferences, reflowable preferences и fixed-layout preferences. Удалить PDF-legacy после контролируемой миграции.

- [ ] **Разбить `PdfFilterPanel` на описание фильтров и универсальный control renderer.**  
  Файл: `frontend/src/components/common/PdfReader/PdfFilterPanel/PdfFilterPanel.tsx` (624 строки).  
  Один UI-блок копирует разметку и pointer-commit обработчики для каждого slider. Описать фильтры декларативной конфигурацией (`id`, label, range, format, mutation) и отрисовывать общим компонентом; не дублировать логику затем в DJVU.

- [ ] **Сократить `messages.ts` и исключить неявные литералы в presentation-коде.**  
  Файл: `frontend/src/i18n/messages.ts` (598 строк) и компоненты читалки.  
  Плоский объект двух языков трудно проверять и расширять, а неполная локализация уже привела к literals в UI. Разнести переводы по namespace/языкам, добавить type-safe ключи и тест, который запрещает пользовательские строки вне переводов.

## P2 — кодовая база, контракты и процессы

- [ ] **Генерировать и проверять OpenAPI types в CI.**  
  Файлы: `api/openapi.yaml`, `frontend/src/api/generated/schema.ts`, `.github/workflows/*`.  
  Генерация существует только как ручной npm script; production build принимает устаревший `schema.ts`. В CI запускать `npm run generate:api` и проверять чистое дерево, чтобы API и frontend не расходились.

- [ ] **Сделать CI настоящим quality gate.**  
  Файл: `.github/workflows/build-images.yml`.  
  Workflow собирает контейнеры, но явно не запускает `go test ./...`, frontend lint, Playwright и интеграционные DB-тесты. Backend в Docker только компилируется. Добавить отдельные jobs/checks и сохранять артефакты Playwright при падении.

- [ ] **Добавить contract/e2e тесты без полного mock API.**  
  Файлы: `frontend/tests/`, `backend/internal/httpapi/server_test.go`.  
  Playwright перехватывает почти все API-запросы, а server-тесты используют in-memory store. Это не ловит несовпадения OpenAPI, cookies/CSRF, multipart, SQL и миграций между реальными слоями. Оставить быстрые mocked UI-тесты, но добавить минимальный набор против запущенного backend+PostgreSQL.

- [ ] **Убрать дублирование темы между inline script и TypeScript.**  
  Файлы: `frontend/index.html`, `frontend/src/styles/themes.ts`, `frontend/src/styles/ThemeSync.tsx`.  
  Список `known` и default theme продублированы вручную ради FOUC-защиты. Новая тема может корректно работать после hydration, но мигать/сбрасываться до неё. Генерировать inline fragment из одного списка или добавить проверку их эквивалентности.

- [ ] **Исправить неверные ссылки на ADR в theme-комментариях.**  
  Файлы: `frontend/index.html`, `frontend/src/styles/themes.ts`, `frontend/src/styles/ThemeSync.tsx`.  
  Комментарии ссылаются на `docs/adr/0001-theme-system.md`, которого нет; существующий `0001` посвящён блокировке страницы. Либо создать корректный ADR, либо убрать ссылку.

- [ ] **Исправить favicon для развёртывания в подкаталоге.**  
  Файл: `frontend/index.html`.  
  `href="/favicon.svg"` игнорирует `VITE_BASE_PATH`, в отличие от остального Vite build. При `BOOK_HUB_BASE_PATH=/hub` браузер запрашивает favicon из корня домена. Использовать `%BASE_URL%favicon.svg`.

## P3 — локальные упрощения

- [ ] **Убрать повторяющиеся helpers.**  
  Файлы: `UploadPage.tsx`, `SettingsPage.tsx`, `EditBookDialog.tsx`, `LibraryPage.tsx`.  
  `errorMessage` реализован трижды, `uniqueTags` — дважды. Вынести `apiErrorMessage` и `mergeTagOptions` в общие утилиты с тестами.

- [ ] **Привести формирование download filename к одному источнику истины.**  
  Файлы: `frontend/src/api/books.ts`, `backend/internal/httpapi/filename.go`.  
  Frontend и backend по-разному sanitise title. Это уже создаёт расхождение между `download` attribute и фактическим `Content-Disposition`. Оставить имя файла на сервере либо формировать его общей спецификацией.

- [ ] **Ограничить ответственность cover extraction.**  
  Файл: `frontend/src/components/pages/UploadPage/coverExtraction.ts` (426 строк).  
  Модуль одновременно извлекает обложки, валидирует EPUB/DJVU, читает метаданные, управляет PDF.js/DJVU workers, сжатием изображений и abort. Разделить адаптеры форматов, image pipeline и orchestration; отдельно проверить освобождение DJVU worker при abort во время его загрузки.

- [ ] **Добавить тесты на миграции localStorage и границы парсеров.**  
  Файлы: `frontend/src/storage/browserPreferences.ts`, `frontend/src/components/common/EpubReader/epubParser.ts`, `frontend/src/components/common/Fb2Reader/fb2Parser.ts`, `frontend/src/components/common/PdfReader/pdfFilters.ts`.  
  Важная логика sanitization/migration и разбор недоверенных файлов почти не имеет unit-тестов; сейчас её косвенно затрагивают e2e. Нужны таблицы edge cases: повреждённые/старые preferences, лимиты ZIP, XML/CSS, фильтры и последовательность миграций.

