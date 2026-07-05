---
name: frontend-solidjs-components
description: Создание и изменение SolidJS-компонентов в проекте.
---

# SolidJS Components

## Размещение компонентов

- Публичные переиспользуемые компоненты размещать в `src/components/common/ComponentName/`.
- Компоненты, которые используются только внутри одной страницы, формы, layout, dialog или другого компонента, размещать дочерней папкой внутри папки владельца.
- Не выносить локальный подкомпонент в `common`, если он не нужен за пределами текущего владельца.
- Выносить компонент в `common` только когда он реально предполагается к использованию в нескольких независимых местах.
- Вложенные подкомпоненты располагать по цепочке владения, а не плоским списком в родительской папке.
- Страницы размещать в `src/components/pages/PageName/`.
- Layout-компоненты размещать в `src/components/layouts/LayoutName/`.

## Файлы компонента

- Папку компонента называть в PascalCase: `ComponentName/`.
- Основной файл называть так же: `ComponentName.tsx`.
- Каждый SolidJS-компонент должен лежать в собственной папке `ComponentName/`, даже если у него нет отдельного SCSS Module, Storybook story или ассетов.
- SCSS Module добавлять рядом: `ComponentName.module.scss`.
- Storybook story добавлять рядом для визуальных компонентов: `ComponentName.stories.tsx`.
- Локальные изображения и иконки класть в `images/` внутри папки компонента.
- Barrel-файлы `index.ts` для компонентов не создавать.
- Импортировать компоненты напрямую: `@/components/common/ComponentName/ComponentName`.

## Структура

Переиспользуемый компонент:

```text
src/components/common/ComponentName/
├── ComponentName.tsx
├── ComponentName.module.scss
└── ComponentName.stories.tsx
```

Локальный подкомпонент:

```text
src/components/pages/PageName/ParentComponent/ChildComponent/
├── ChildComponent.tsx
├── ChildComponent.module.scss
└── ChildComponent.stories.tsx
```

Компонент с ассетами:

```text
src/components/common/ComponentName/
├── ComponentName.tsx
├── ComponentName.module.scss
└── images/
```

## Код

- Использовать SolidJS, TypeScript, `export default ComponentName`.
- Перед созданием нового UI-контрола проверять существующие компоненты в `src/components/common/` и переиспользовать их.
- Если существующий common-компонент почти подходит, но не поддерживает нужный вариант, дорабатывать этот common-компонент вместо локальной повторной реализации.
- Компоненты, которые потенциально могут использоваться в нескольких местах, размещать в `src/components/common/`, а не внутри локального владельца.
- Тип пропов компонента писать inline в сигнатуре функции: `function Component(props: { value: string }) { ... }`. Не создавать отдельные `type ComponentProps = { ... }` или `interface ComponentProps` для пропов компонента.
- SCSS Modules импортировать как `styles` из `./ComponentName.module.scss`.
- Импорты изображений, передаваемые в `src` элемента `<img>`, называть с суффиксом `ImgSrc`: `import cashbackImgSrc from './images/cashback.png'`.
- Абсолютные импорты делать через `@/`.
- Соседние и вложенные подкомпоненты импортировать относительным путём.

## Переводы

- Переводы добавлять в `src/i18n/messages.ts`.
- Ключ перевода должен быть коротким английским вариантом самой фразы в lower camelCase.
- В ключе опускать артикли и неключевые слова: `maximumTransferAmount`, `saveCard`, `payFewTaps`.
- Не называть ключи по компоненту, теме, месту использования или UI-роли: не использовать префиксы и суффиксы вроде `alfaEcom3`, `Sheet`, `Button`, `Title`, `Subtitle`, `Description`, `Message`, если они не являются смысловой частью самой фразы.
- Если одинаковый текст уже есть в `src/i18n/messages.ts`, переиспользовать существующий ключ вместо добавления дубля.


## SCSS

- Основной класс компонента называть по смыслу, чаще всего нижним camelCase.
- Подключать `@use '@/styles/_variables.scss' as *;` и `@use '@/styles/_mixins.scss' as *;` всегда в SCSS модулях.

## Stories

- Story размещать рядом с компонентом: `ComponentName.stories.tsx`.
- Импортировать компонент из `./ComponentName`.
- Экспортировать default как `{ component: ComponentName }`.
- Основной сценарий называть `Default`.
