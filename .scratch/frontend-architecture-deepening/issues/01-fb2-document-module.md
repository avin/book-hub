# 01 — Вынести document module FB2 из reader-а

**What to build:** читалка FB2, импорт книги и получение текста файла используют один document module FB2; обработка кодировок, структуры книги, метаданных и binary-данных остаётся за его seam.

**Blocked by:** None — can start immediately.

Status: ready-for-agent

- [ ] Открытие FB2, извлечение названия и автоматическое получение обложки продолжают работать для поддерживаемых файлов.
- [ ] Изменения в разборе и декодировании FB2 проверяются через document module, а не через implementation reader-а.

