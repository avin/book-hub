# Book Hub — для агентов

Приватное веб-приложение для хранения и чтения книг.

## Стек

- **Backend:** Go (`backend/`), PostgreSQL, файловое хранилище
- **Frontend:** SolidJS + Vite + TypeScript (`frontend/`)
- **API:** OpenAPI в `api/openapi.yaml`
- **Docs:** Документация (`docs/`)

## Правила документации

* Если меняется логика работы приложения, актуализируй `docs/APP.md`. В этом документе — краткая документация по работе программы. Не нужно писать туда разъяснения или прочую воду: там очень сухая документация, только по делу. Если делаешь незначительные изменения, можешь ничего туда не писать.

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles recorded as `Status:` in issue files. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.

