import { createContext, createSignal, type JSX, useContext } from "solid-js";
import { type Language, languages, type MessageKey, messages } from "./messages";

const storageKey = "book-hub-language";

type I18nContextValue = {
  language: () => Language;
  setLanguage: (language: Language) => void;
  t: (key: MessageKey) => string;
};

const I18nContext = createContext<I18nContextValue>();

function detectLanguage(): Language {
  const stored = localStorage.getItem(storageKey);

  if (stored && languages.includes(stored as Language)) {
    return stored as Language;
  }

  const browserLanguage = navigator.languages
    .map((language) => language.toLowerCase().split("-")[0])
    .find((language) => languages.includes(language as Language));

  return (browserLanguage as Language | undefined) ?? "en";
}

export function I18nProvider(props: {
  children: JSX.Element;
}) {
  const [language, setLanguageSignal] = createSignal<Language>(detectLanguage());

  const setLanguage = (nextLanguage: Language) => {
    localStorage.setItem(storageKey, nextLanguage);
    setLanguageSignal(nextLanguage);
  };

  const t = (key: MessageKey) => messages[key][language()];

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {props.children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }

  return context;
}
