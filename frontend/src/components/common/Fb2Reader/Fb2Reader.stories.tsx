import Fb2Reader from "./Fb2Reader";

export default { component: Fb2Reader };

const coverImage =
  "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NDAiIGhlaWdodD0iOTAwIiB2aWV3Qm94PSIwIDAgNjQwIDkwMCI+PHJlY3Qgd2lkdGg9IjY0MCIgaGVpZ2h0PSI5MDAiIGZpbGw9IiNmN2YzZWEiLz48cmVjdCB4PSI1NCIgeT0iNTQiIHdpZHRoPSI1MzIiIGhlaWdodD0iNzkyIiByeD0iMTgiIGZpbGw9IiMyNDUyN2EiLz48cmVjdCB4PSI5MCIgeT0iMTA0IiB3aWR0aD0iNDYwIiBoZWlnaHQ9IjEyMCIgZmlsbD0iI2YwZGZiNyIvPjx0ZXh0IHg9IjMyMCIgeT0iMTc4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXNpemU9IjQ2IiBmb250LWZhbWlseT0iR2VvcmdpYSIgZmlsbD0iIzE0MTcxZiI+RkIyPC90ZXh0Pjx0ZXh0IHg9IjMyMCIgeT0iMzMwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXNpemU9IjM0IiBmb250LWZhbWlseT0iR2VvcmdpYSIgZmlsbD0iI2ZmZmZmZiI+Qm9vayBIdWI8L3RleHQ+PHRleHQgeD0iMzIwIiB5PSIzODgiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtc2l6ZT0iMjIiIGZvbnQtZmFtaWx5PSJHZW9yZ2lhIiBmaWxsPSIjZGJlYWY0Ij5zYW1wbGUgY292ZXI8L3RleHQ+PC9zdmc+";

const repeatedSections = Array.from(
  { length: 700 },
  (_, index) => `
      <section id="stress-${index + 1}">
        <title><p>Виртуальная секция ${index + 1}</p></title>
        <p>Это длинный проверочный абзац номер ${index + 1}: он содержит обычный текст, <strong>полужирный фрагмент</strong>, <emphasis>курсив</emphasis>, <a l:href="https://example.com">внешнюю ссылку</a>, мягкие переносы и достаточно слов, чтобы Pretext мог измерить несколько строк при разных настройках ширины.</p>
        <p>Второй абзац нужен для проверки отступов, межстрочного интервала, первой строки и стабильности виртуализированного списка при быстрой прокрутке документа.</p>
      </section>`,
).join("");

const sampleFb2 = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink" xmlns:xlink="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <genre>sf</genre>
      <author>
        <first-name>Анна</first-name>
        <middle-name>Петровна</middle-name>
        <last-name>Тестова</last-name>
      </author>
      <book-title>Максимально насыщенный FB2</book-title>
      <annotation>
        <p>Аннотация показывает, что viewer умеет отображать служебные блоки описания книги до основного body.</p>
        <p>Здесь также есть <strong>strong</strong>, <emphasis>emphasis</emphasis> и <a l:href="#chapter-1">внутренняя ссылка</a>.</p>
      </annotation>
      <keywords>fb2, reader, virtualization, solidjs</keywords>
      <date value="2026-07-05">5 июля 2026</date>
      <coverpage>
        <image xlink:href="#cover.svg" />
      </coverpage>
      <lang>ru</lang>
      <src-lang>ru</src-lang>
      <sequence name="Book Hub Samples" number="1" />
    </title-info>
    <document-info>
      <author><nickname>Codex</nickname></author>
      <program-used>Storybook</program-used>
      <date value="2026-07-05">5 июля 2026</date>
      <id>book-hub-fb2-reader-story</id>
      <version>1.0</version>
    </document-info>
    <publish-info>
      <book-name>Максимально насыщенный FB2</book-name>
      <publisher>Book Hub</publisher>
      <city>Localhost</city>
      <year>2026</year>
      <isbn>978-0-000000-0-0</isbn>
    </publish-info>
    <custom-info info-type="review-state">visual-test</custom-info>
  </description>
  <body>
    <title>
      <p>Максимально насыщенный FB2</p>
      <subtitle>Тестовый документ для компонента просмотра</subtitle>
    </title>
    <epigraph>
      <p>Эпиграф должен визуально отличаться от обычного текста и сохранять вложенные inline-элементы.</p>
      <text-author>Неизвестный тестировщик</text-author>
    </epigraph>
    <section id="chapter-1">
      <title><p>Глава 1. Базовые блоки</p></title>
      <p>Обычный параграф с <strong>strong</strong>, <emphasis>emphasis</emphasis>, <strikethrough>strikethrough</strikethrough>, <sub>sub</sub>, <sup>sup</sup>, <code>code()</code>, <style name="custom">style</style> и картинкой внутри строки <image l:href="#cover.svg" />.</p>
      <p>Ссылка может вести наружу: <a l:href="https://example.com">example.com</a>, может быть локальной: <a l:href="#chapter-2">переход ко второй главе</a>, а может выглядеть как FB2-сноска<a l:href="#note-1" type="note">[1]</a>.</p>
      <empty-line />
      <subtitle>Отдельный подзаголовок</subtitle>
      <p>После пустой строки и подзаголовка должен продолжаться нормальный поток чтения веб-страницы с прокруткой.</p>
      <image l:href="#cover.svg" />
      <poem>
        <title><p>Стихотворный блок</p></title>
        <stanza>
          <v>Первая строка строфы</v>
          <v>Вторая строка строфы с <emphasis>курсивом</emphasis></v>
          <v>Третья строка строфы</v>
        </stanza>
        <stanza>
          <v>Новая строфа отделяется пустым интервалом</v>
          <v>И остаётся частью общего документа</v>
        </stanza>
        <text-author>Автор стихов</text-author>
        <date value="2026">2026</date>
      </poem>
      <cite>
        <p>Цитата поддерживает параграфы, автора и дату.</p>
        <p>Внутри цитаты могут быть <strong>акценты</strong> и ссылки.</p>
        <text-author>Источник цитаты</text-author>
      </cite>
      <table>
        <tr>
          <th>Элемент FB2</th>
          <th align="center">Ожидаемый рендер</th>
          <th align="right">Проверка</th>
        </tr>
        <tr>
          <td>title</td>
          <td align="center">Центрированный заголовок</td>
          <td align="right">Размер зависит от уровня секции</td>
        </tr>
        <tr>
          <td>p + inline</td>
          <td align="center">Абзац с вложенными тегами</td>
          <td align="right">Измеряется через Pretext</td>
        </tr>
        <tr>
          <td colspan="2">Ячейка с colspan</td>
          <td align="right">Широкая ячейка таблицы</td>
        </tr>
      </table>
    </section>
    <section id="chapter-2">
      <title><p>Глава 2. Списки, код и разделители</p></title>
      <p>Не все FB2-файлы используют отдельную семантику списков: некоторые конвертеры пишут пункты обычными параграфами с маркером.</p>
      <p>   • Первый пункт маркированного списка</p>
      <p>   • Второй пункт с <emphasis>курсивом</emphasis></p>
      <p>   • Третий пункт с <strong>полужирным текстом</strong></p>
      <empty-line />
      <p>Нумерованные списки из markdown-конвертеров выглядят так же:</p>
      <p>   1. Первый пункт нумерованного списка</p>
      <p>   2. Второй пункт с <code>inlineCode()</code></p>
      <p>   3. Третий пункт</p>
      <empty-line />
      <p>Многострочный код в FB2 часто хранится как параграф с единственным вложенным тегом code:</p>
      <p><code>#include &lt;stdio.h&gt;

int main()
    {
    printf("*Hello* **world!**\\n");
    }
</code></p>
      <subtitle>* * *</subtitle>
      <p>Разделитель выше пришёл из subtitle, но должен восприниматься как визуальная пауза, а не как очередной заголовок.</p>
    </section>
    <section id="chapter-3">
      <title><p>Глава 3. Длинный поток</p></title>
      ${repeatedSections}
    </section>
  </body>
  <body name="notes">
    <title><p>Примечания</p></title>
    <section id="note-1">
      <title><p>1</p></title>
      <p>Это тестовая FB2-сноска из отдельного body name="notes". Клик по маркеру [1] должен открыть этот текст в мини-диалоге, а <a l:href="#chapter-1">обратная ссылка</a> возвращает к первой главе.</p>
    </section>
  </body>
  <binary id="cover.svg" content-type="image/svg+xml">${coverImage}</binary>
</FictionBook>`;

export const Default = () => <Fb2Reader fb2={sampleFb2} />;
