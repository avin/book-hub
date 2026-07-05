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
  dashboard: {
    ru: "Обзор",
    en: "Dashboard",
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
  todo: {
    ru: "TODO",
    en: "TODO",
  },
  sectionPreparedImplementationLater: {
    ru: "Раздел подготовлен, реализация будет добавлена позже.",
    en: "The section is prepared. Implementation will be added later.",
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
  noOptions: {
    ru: "Нет вариантов",
    en: "No options",
  },
} satisfies Record<string, Translation>;

export type MessageKey = keyof typeof messages;
