export const languages = ['ru', 'en'] as const;

export type Language = (typeof languages)[number];

type Translation = Record<Language, string>;

export const messages = {
  bookHub: {
    ru: 'Book Hub',
    en: 'Book Hub',
  },
  privateLibraryStoreReadBooks: {
    ru: 'Личная библиотека для хранения и чтения книг',
    en: 'A private library for storing and reading books',
  },
  signIn: {
    ru: 'Войти',
    en: 'Sign in',
  },
  signOut: {
    ru: 'Выйти',
    en: 'Sign out',
  },
  register: {
    ru: 'Регистрация',
    en: 'Register',
  },
  login: {
    ru: 'Логин',
    en: 'Login',
  },
  password: {
    ru: 'Пароль',
    en: 'Password',
  },
  repeatPassword: {
    ru: 'Повторите пароль',
    en: 'Repeat password',
  },
  createAccount: {
    ru: 'Создать аккаунт',
    en: 'Create account',
  },
  afterRegistrationAdminActivatesAccount: {
    ru: 'После регистрации аккаунт должен активировать администратор.',
    en: 'After registration, an administrator must activate the account.',
  },
  accountNotActivated: {
    ru: 'Данная учётная запись ещё не активирована.',
    en: 'This account has not been activated yet.',
  },
  showPassword: {
    ru: 'Показать пароль',
    en: 'Show password',
  },
  hidePassword: {
    ru: 'Скрыть пароль',
    en: 'Hide password',
  },
  fillField: {
    ru: 'Заполните поле',
    en: 'Fill in this field',
  },
  passwordsDoNotMatch: {
    ru: 'Пароли не совпадают',
    en: 'Passwords do not match',
  },
  requestFailedTryAgain: {
    ru: 'Запрос не выполнен. Проверьте данные и попробуйте ещё раз.',
    en: 'The request failed. Check the data and try again.',
  },
  requestCreatedWaitActivation: {
    ru: 'Заявка создана. Дождитесь активации аккаунта.',
    en: 'The request was created. Wait for account activation.',
  },
  language: {
    ru: 'Язык',
    en: 'Language',
  },
  accountMenu: {
    ru: 'Меню аккаунта',
    en: 'Account menu',
  },
  russian: {
    ru: 'Русский',
    en: 'Русский',
  },
  english: {
    ru: 'English',
    en: 'English',
  },
  library: {
    ru: 'Библиотека',
    en: 'Library',
  },
  upload: {
    ru: 'Загрузка',
    en: 'Upload',
  },
  settings: {
    ru: 'Настройки',
    en: 'Settings',
  },
  reader: {
    ru: 'Чтение',
    en: 'Reader',
  },
  bookSearch: {
    ru: 'Поиск по книге',
    en: 'Search in book',
  },
  bookSearchUnavailable: {
    ru: 'Поиск недоступен: в книге нет текстового слоя.',
    en: 'Search is unavailable: the book has no text layer.',
  },
  findPrevious: {
    ru: 'Найти предыдущее',
    en: 'Find previous',
  },
  findNext: {
    ru: 'Найти следующее',
    en: 'Find next',
  },
  page: {
    ru: 'Страница',
    en: 'Page',
  },
  pageNumber: {
    ru: 'Номер страницы',
    en: 'Page number',
  },
  pageWidth: {
    ru: 'Ширина страницы',
    en: 'Page width',
  },
  tableOfContents: {
    ru: 'Оглавление',
    en: 'Table of contents',
  },
  tableOfContentsUnavailable: {
    ru: 'Оглавление недоступно',
    en: 'Table of contents unavailable',
  },
  maxTextWidth: {
    ru: 'Максимальная ширина текста',
    en: 'Maximum text width',
  },
  pageWidthIncrease: {
    ru: 'Увеличение ширины',
    en: 'Width increase',
  },
  pdfFilters: {
    ru: 'Фильтры страницы',
    en: 'Page filters',
  },
  readerAppearance: {
    ru: 'Внешний вид',
    en: 'Appearance',
  },
  filters: {
    ru: 'Фильтры',
    en: 'Filters',
  },
  reset: {
    ru: 'Сбросить',
    en: 'Reset',
  },
  autoWidth: {
    ru: 'Автоширина',
    en: 'Auto width',
  },
  text: {
    ru: 'Текст',
    en: 'Text',
  },
  font: {
    ru: 'Шрифт',
    en: 'Font',
  },
  size: {
    ru: 'Размер',
    en: 'Size',
  },
  lineHeight: {
    ru: 'Интерлиньяж',
    en: 'Line height',
  },
  paragraphs: {
    ru: 'Абзацы',
    en: 'Paragraphs',
  },
  firstLineIndent: {
    ru: 'Отступ первой строки',
    en: 'First-line indent',
  },
  paragraphSpacing: {
    ru: 'Отступ после абзаца',
    en: 'Paragraph spacing',
  },
  colors: {
    ru: 'Цвета',
    en: 'Colors',
  },
  background: {
    ru: 'Фон',
    en: 'Background',
  },
  links: {
    ru: 'Ссылки',
    en: 'Links',
  },
  textEnhancement: {
    ru: 'Усиление текста',
    en: 'Text enhancement',
  },
  softTextEnhancement: {
    ru: 'Мягкое утолщение текста',
    en: 'Soft text thickening',
  },
  strokeWidth: {
    ru: 'Толщина штриха',
    en: 'Stroke width',
  },
  threshold: {
    ru: 'Порог',
    en: 'Threshold',
  },
  contrast: {
    ru: 'Контраст',
    en: 'Contrast',
  },
  grayLevels: {
    ru: 'Уровни серого',
    en: 'Gray levels',
  },
  toneShift: {
    ru: 'Сдвиг тона',
    en: 'Tone shift',
  },
  visualAdjustment: {
    ru: 'Яркость, контраст и гамма',
    en: 'Brightness, contrast and gamma',
  },
  brightness: {
    ru: 'Яркость',
    en: 'Brightness',
  },
  gamma: {
    ru: 'Гамма',
    en: 'Gamma',
  },
  warmth: {
    ru: 'Тёплый фильтр',
    en: 'Warm filter',
  },
  grayscale: {
    ru: 'Оттенки серого',
    en: 'Grayscale',
  },
  invert: {
    ru: 'Инверсия',
    en: 'Invert',
  },
  filterStrength: {
    ru: 'Сила',
    en: 'Strength',
  },
  moveFilter: {
    ru: 'Переместить фильтр',
    en: 'Move filter',
  },
  resetAll: {
    ru: 'Сбросить все',
    en: 'Reset all',
  },
  pdfFiltersUnavailable: {
    ru: 'Фильтры недоступны: браузер не поддерживает WebGL или обработка страницы завершилась ошибкой. Книга продолжает отображаться без фильтров.',
    en: 'Filters are unavailable: the browser does not support WebGL or page processing failed. The book remains available without filters.',
  },
  tags: {
    ru: 'Теги',
    en: 'Tags',
  },
  addTag: {
    ru: 'Добавить тег',
    en: 'Add tag',
  },
  findOrAddTag: {
    ru: 'Найти или добавить тег',
    en: 'Find or add tag',
  },
  findByTag: {
    ru: 'Найти по тегу',
    en: 'Find by tag',
  },
  findByTitle: {
    ru: 'Найти по названию',
    en: 'Find by title',
  },
  clearSearch: {
    ru: 'Очистить поиск',
    en: 'Clear search',
  },
  bookActions: {
    ru: 'Действия с книгой',
    en: 'Book actions',
  },
  viewList: {
    ru: 'Список',
    en: 'List',
  },
  viewGrid: {
    ru: 'Сетка',
    en: 'Grid',
  },
  noOptions: {
    ru: 'Нет вариантов',
    en: 'No options',
  },
  yourBooks: {
    ru: 'Ваши книги',
    en: 'Your books',
  },
  total: {
    ru: 'всего',
    en: 'total',
  },
  filtered: {
    ru: 'отфильтровано',
    en: 'filtered',
  },
  resetFilters: {
    ru: 'Сбросить фильтр',
    en: 'Reset filters',
  },
  uploadBook: {
    ru: 'Загрузить книгу',
    en: 'Upload book',
  },
  searchBooks: {
    ru: 'Поиск книг',
    en: 'Search books',
  },
  sort: {
    ru: 'Сортировка',
    en: 'Sort',
  },
  relevanceSort: {
    ru: 'Релевантные',
    en: 'Relevant',
  },
  recentlyAdded: {
    ru: 'Недавно добавленные',
    en: 'Recently added',
  },
  titleAZ: {
    ru: 'Название А-Я',
    en: 'Title A-Z',
  },
  titleZA: {
    ru: 'Название Я-А',
    en: 'Title Z-A',
  },
  favoritesFilter: {
    ru: 'Фильтр избранного',
    en: 'Favorites filter',
  },
  all: {
    ru: 'Все',
    en: 'All',
  },
  favorites: {
    ru: 'Избранные',
    en: 'Favorites',
  },
  other: {
    ru: 'Остальные',
    en: 'Other',
  },
  loading: {
    ru: 'Загрузка',
    en: 'Loading',
  },
  libraryEmpty: {
    ru: 'Библиотека пуста',
    en: 'Library is empty',
  },
  read: {
    ru: 'Читать',
    en: 'Read',
  },
  edit: {
    ru: 'Изменить',
    en: 'Edit',
  },
  delete: {
    ru: 'Удалить',
    en: 'Delete',
  },
  addToFavorites: {
    ru: 'Добавить в избранное',
    en: 'Add to favorites',
  },
  removeFromFavorites: {
    ru: 'Убрать из избранного',
    en: 'Remove from favorites',
  },
  showFullCover: {
    ru: 'Вызовите контекстное меню, чтобы показать обложку целиком',
    en: 'Open the context menu to show the full cover',
  },
  showFullCoverMenu: {
    ru: 'Показать обложку целиком',
    en: 'Show full cover',
  },
  downloadBook: {
    ru: 'Скачать книгу',
    en: 'Download book',
  },
  resetReadingProgress: {
    ru: 'Сбросить прогресс',
    en: 'Reset progress',
  },
  resetReadingProgressConfirm: {
    ru: 'Сбросить прогресс чтения этой книги?',
    en: "Reset this book's reading progress?",
  },
  back: {
    ru: 'Назад',
    en: 'Back',
  },
  forward: {
    ru: 'Вперёд',
    en: 'Forward',
  },
  editBook: {
    ru: 'Изменить книгу',
    en: 'Edit book',
  },
  close: {
    ru: 'Закрыть',
    en: 'Close',
  },
  closeFootnote: {
    ru: 'Закрыть сноску',
    en: 'Close footnote',
  },
  footnote: {
    ru: 'Сноска',
    en: 'Footnote',
  },
  noImage: {
    ru: 'Нет изображения',
    en: 'No image',
  },
  title: {
    ru: 'Название',
    en: 'Title',
  },
  favorite: {
    ru: 'Избранное',
    en: 'Favorite',
  },
  uploadCover: {
    ru: 'Загрузить обложку',
    en: 'Upload cover',
  },
  deleteCover: {
    ru: 'Удалить обложку',
    en: 'Delete cover',
  },
  cancel: {
    ru: 'Отмена',
    en: 'Cancel',
  },
  save: {
    ru: 'Сохранить',
    en: 'Save',
  },
  deleteBookConfirm: {
    ru: 'Удалить книгу из библиотеки?',
    en: 'Delete this book from the library?',
  },
  addBook: {
    ru: 'Добавить книгу',
    en: 'Add book',
  },
  addBooks: {
    ru: 'Добавить книги',
    en: 'Add books',
  },
  fileNotSelected: {
    ru: 'Файл не выбран',
    en: 'No file selected',
  },
  booksSelected: {
    ru: 'Выбрано книг: {count}',
    en: 'Books selected: {count}',
  },
  supportedBookFormats: {
    ru: 'DJVU, EPUB, FB2 или PDF, можно несколько файлов сразу',
    en: 'DJVU, EPUB, FB2 or PDF, multiple files are supported',
  },
  selectBookFile: {
    ru: 'Выберите файл книги',
    en: 'Select a book file',
  },
  extractingCover: {
    ru: 'Извлекаем обложку',
    en: 'Extracting cover',
  },
  coverNotFound: {
    ru: 'Обложка не найдена',
    en: 'Cover not found',
  },
  coverCouldNotBeExtracted: {
    ru: 'Не удалось извлечь обложку',
    en: 'Cover could not be extracted',
  },
  restoreCover: {
    ru: 'Извлечь обложку из файла',
    en: 'Extract cover from file',
  },
  coverExtracting: {
    ru: 'Извлечение обложки…',
    en: 'Extracting cover…',
  },
  extractTitle: {
    ru: 'Извлечь название',
    en: 'Extract title',
  },
  titleCouldNotBeExtracted: {
    ru: 'Не удалось извлечь название',
    en: 'Title could not be extracted',
  },
  epubCouldNotBeOpened: {
    ru: 'Не удалось открыть EPUB',
    en: 'Could not open EPUB',
  },
  validatingEpub: {
    ru: 'Проверяем EPUB',
    en: 'Validating EPUB',
  },
  invalidEpub: {
    ru: 'Некорректный EPUB нельзя загрузить',
    en: 'An invalid EPUB cannot be uploaded',
  },
  validatingDjvu: {
    ru: 'Проверяем DJVU',
    en: 'Validating DJVU',
  },
  invalidDjvu: {
    ru: 'Некорректный DJVU нельзя загрузить',
    en: 'An invalid DJVU cannot be uploaded',
  },
  uploadBooks: {
    ru: 'Загрузить книги',
    en: 'Upload books',
  },
  tagsForAll: {
    ru: 'Теги для всех книг',
    en: 'Tags for all books',
  },
  applyTagsToAll: {
    ru: 'Применить теги для всех',
    en: 'Apply tags to all',
  },
  uploadProgress: {
    ru: 'Загружено {count} из {total}',
    en: 'Uploaded {count} of {total}',
  },
  remove: {
    ru: 'Убрать',
    en: 'Remove',
  },
  accountSettings: {
    ru: 'Настройки аккаунта',
    en: 'Account settings',
  },
  storage: {
    ru: 'Хранилище',
    en: 'Storage',
  },
  data: {
    ru: 'Данные',
    en: 'Data',
  },
  resetAllProgress: {
    ru: 'Сбросить прогресс',
    en: 'Reset progress',
  },
  resetAllProgressDescription: {
    ru: 'Сбросить прогресс чтения всех книг до нуля. Сами книги не удаляются.',
    en: 'Reset reading progress for all books to zero. The books themselves are not removed.',
  },
  resetAllProgressConfirm: {
    ru: 'Сбросить прогресс чтения всех книг? Это действие нельзя отменить.',
    en: 'Reset reading progress for all books? This cannot be undone.',
  },
  resetAllProgressDone: {
    ru: 'Прогресс сброшен',
    en: 'Progress reset',
  },
  appearance: {
    ru: 'Оформление',
    en: 'Appearance',
  },
  theme: {
    ru: 'Тема',
    en: 'Theme',
  },
  themeLightClay: {
    ru: 'Глина',
    en: 'Clay',
  },
  themeLightSand: {
    ru: 'Песок',
    en: 'Sand',
  },
  themeLightMint: {
    ru: 'Мята',
    en: 'Mint',
  },
  themeDarkInk: {
    ru: 'Чернила',
    en: 'Ink',
  },
  themeDarkGreen: {
    ru: 'Малахит',
    en: 'Green',
  },
  themeDarkGraphite: {
    ru: 'Графит',
    en: 'Graphite',
  },
  themeDarkOcean: {
    ru: 'Океан',
    en: 'Ocean',
  },
  themeDarkAmethyst: {
    ru: 'Аметист',
    en: 'Amethyst',
  },
  changePassword: {
    ru: 'Смена пароля',
    en: 'Change password',
  },
  currentPassword: {
    ru: 'Текущий пароль',
    en: 'Current password',
  },
  newPassword: {
    ru: 'Новый пароль',
    en: 'New password',
  },
  passwordChanged: {
    ru: 'Пароль изменён',
    en: 'Password changed',
  },
  savePassword: {
    ru: 'Сохранить пароль',
    en: 'Save password',
  },
} satisfies Record<string, Translation>;

export type MessageKey = keyof typeof messages;
