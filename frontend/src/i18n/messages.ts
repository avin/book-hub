export const languages = ["ru", "en"] as const;

export type Language = (typeof languages)[number];

type Translation = Record<Language, string>;

export const messages = {
  bookHub: {
    ru: "Book Hub",
    en: "Book Hub",
  },
  privateLibraryStoreReadBooks: {
    ru: "Личная библиотека для хранения и чтения книг",
    en: "A private library for storing and reading books",
  },
  signIn: {
    ru: "Войти",
    en: "Sign in",
  },
  signOut: {
    ru: "Выйти",
    en: "Sign out",
  },
  register: {
    ru: "Регистрация",
    en: "Register",
  },
  login: {
    ru: "Логин",
    en: "Login",
  },
  password: {
    ru: "Пароль",
    en: "Password",
  },
  repeatPassword: {
    ru: "Повторите пароль",
    en: "Repeat password",
  },
  createAccount: {
    ru: "Создать аккаунт",
    en: "Create account",
  },
  afterRegistrationAdminActivatesAccount: {
    ru: "После регистрации аккаунт должен активировать администратор.",
    en: "After registration, an administrator must activate the account.",
  },
  checkWhetherAccountActive: {
    ru: "Если вход не работает, проверьте, активирован ли аккаунт.",
    en: "If sign-in fails, check whether the account is active.",
  },
  showPassword: {
    ru: "Показать пароль",
    en: "Show password",
  },
  hidePassword: {
    ru: "Скрыть пароль",
    en: "Hide password",
  },
  fillField: {
    ru: "Заполните поле",
    en: "Fill in this field",
  },
  passwordsDoNotMatch: {
    ru: "Пароли не совпадают",
    en: "Passwords do not match",
  },
  requestFailedTryAgain: {
    ru: "Запрос не выполнен. Проверьте данные и попробуйте ещё раз.",
    en: "The request failed. Check the data and try again.",
  },
  requestCreatedWaitActivation: {
    ru: "Заявка создана. Дождитесь активации аккаунта.",
    en: "The request was created. Wait for account activation.",
  },
  language: {
    ru: "Язык",
    en: "Language",
  },
  russian: {
    ru: "Русский",
    en: "Русский",
  },
  english: {
    ru: "English",
    en: "English",
  },
  library: {
    ru: "Библиотека",
    en: "Library",
  },
  upload: {
    ru: "Загрузка",
    en: "Upload",
  },
  settings: {
    ru: "Настройки",
    en: "Settings",
  },
  reader: {
    ru: "Чтение",
    en: "Reader",
  },
  tags: {
    ru: "Теги",
    en: "Tags",
  },
  addTag: {
    ru: "Добавить тег",
    en: "Add tag",
  },
  findOrAddTag: {
    ru: "Найти или добавить тег",
    en: "Find or add tag",
  },
  findByTag: {
    ru: "Найти по тегу",
    en: "Find by tag",
  },
  findByTitle: {
    ru: "Найти по названию",
    en: "Find by title",
  },
  noOptions: {
    ru: "Нет вариантов",
    en: "No options",
  },
  yourBooks: {
    ru: "Ваши книги",
    en: "Your books",
  },
  uploadBook: {
    ru: "Загрузить книгу",
    en: "Upload book",
  },
  searchBooks: {
    ru: "Поиск книг",
    en: "Search books",
  },
  sort: {
    ru: "Сортировка",
    en: "Sort",
  },
  recentlyAdded: {
    ru: "Недавно добавленные",
    en: "Recently added",
  },
  titleAZ: {
    ru: "Название А-Я",
    en: "Title A-Z",
  },
  titleZA: {
    ru: "Название Я-А",
    en: "Title Z-A",
  },
  progressHigh: {
    ru: "Прогресс выше",
    en: "Highest progress",
  },
  progressLow: {
    ru: "Прогресс ниже",
    en: "Lowest progress",
  },
  favoritesFilter: {
    ru: "Фильтр избранного",
    en: "Favorites filter",
  },
  all: {
    ru: "Все",
    en: "All",
  },
  favorites: {
    ru: "Избранные",
    en: "Favorites",
  },
  other: {
    ru: "Остальные",
    en: "Other",
  },
  loading: {
    ru: "Загрузка",
    en: "Loading",
  },
  libraryEmpty: {
    ru: "Библиотека пуста",
    en: "Library is empty",
  },
  read: {
    ru: "Читать",
    en: "Read",
  },
  edit: {
    ru: "Изменить",
    en: "Edit",
  },
  delete: {
    ru: "Удалить",
    en: "Delete",
  },
  addToFavorites: {
    ru: "Добавить в избранное",
    en: "Add to favorites",
  },
  removeFromFavorites: {
    ru: "Убрать из избранного",
    en: "Remove from favorites",
  },
  showFullCover: {
    ru: "Вызовите контекстное меню, чтобы показать обложку целиком",
    en: "Open the context menu to show the full cover",
  },
  back: {
    ru: "Назад",
    en: "Back",
  },
  forward: {
    ru: "Вперёд",
    en: "Forward",
  },
  editBook: {
    ru: "Изменить книгу",
    en: "Edit book",
  },
  close: {
    ru: "Закрыть",
    en: "Close",
  },
  title: {
    ru: "Название",
    en: "Title",
  },
  favorite: {
    ru: "Избранное",
    en: "Favorite",
  },
  uploadCover: {
    ru: "Загрузить обложку",
    en: "Upload cover",
  },
  deleteCover: {
    ru: "Удалить обложку",
    en: "Delete cover",
  },
  cancel: {
    ru: "Отмена",
    en: "Cancel",
  },
  save: {
    ru: "Сохранить",
    en: "Save",
  },
  deleteBookConfirm: {
    ru: "Удалить книгу из библиотеки?",
    en: "Delete this book from the library?",
  },
  addBook: {
    ru: "Добавить книгу",
    en: "Add book",
  },
  addBooks: {
    ru: "Добавить книги",
    en: "Add books",
  },
  fileNotSelected: {
    ru: "Файл не выбран",
    en: "No file selected",
  },
  booksSelected: {
    ru: "Выбрано книг: {count}",
    en: "Books selected: {count}",
  },
  supportedBookFormats: {
    ru: "FB2 или PDF, можно несколько файлов сразу",
    en: "FB2 or PDF, multiple files are supported",
  },
  selectBookFile: {
    ru: "Выберите файл книги",
    en: "Select a book file",
  },
  extractingCover: {
    ru: "Извлекаем обложку",
    en: "Extracting cover",
  },
  coverNotFound: {
    ru: "Обложка не найдена",
    en: "Cover not found",
  },
  coverCouldNotBeExtracted: {
    ru: "Не удалось извлечь обложку",
    en: "Cover could not be extracted",
  },
  extractTitle: {
    ru: "Извлечь название",
    en: "Extract title",
  },
  titleCouldNotBeExtracted: {
    ru: "Не удалось извлечь название",
    en: "Title could not be extracted",
  },
  uploadBooks: {
    ru: "Загрузить книги",
    en: "Upload books",
  },
  bookUploaded: {
    ru: "Книга загружена",
    en: "Book uploaded",
  },
  someBooksNotUploaded: {
    ru: "Некоторые книги не удалось загрузить. Проверьте ошибки в списке.",
    en: "Some books could not be uploaded. Check errors in the list.",
  },
  remove: {
    ru: "Убрать",
    en: "Remove",
  },
  accountSettings: {
    ru: "Настройки аккаунта",
    en: "Account settings",
  },
  profile: {
    ru: "Профиль",
    en: "Profile",
  },
  accountStatus: {
    ru: "Статус аккаунта",
    en: "Account status",
  },
  active: {
    ru: "Активен",
    en: "Active",
  },
  inactive: {
    ru: "Не активен",
    en: "Inactive",
  },
  storage: {
    ru: "Хранилище",
    en: "Storage",
  },
  changePassword: {
    ru: "Смена пароля",
    en: "Change password",
  },
  currentPassword: {
    ru: "Текущий пароль",
    en: "Current password",
  },
  newPassword: {
    ru: "Новый пароль",
    en: "New password",
  },
  passwordChanged: {
    ru: "Пароль изменён",
    en: "Password changed",
  },
  savePassword: {
    ru: "Сохранить пароль",
    en: "Save password",
  },
  frontendSettings: {
    ru: "Frontend-настройки",
    en: "Frontend settings",
  },
  invalidJson: {
    ru: "Некорректный JSON",
    en: "Invalid JSON",
  },
  settingsMustBeObject: {
    ru: "Настройки должны быть JSON-объектом",
    en: "Settings must be a JSON object",
  },
  settingsSaved: {
    ru: "Настройки сохранены",
    en: "Settings saved",
  },
} satisfies Record<string, Translation>;

export type MessageKey = keyof typeof messages;
