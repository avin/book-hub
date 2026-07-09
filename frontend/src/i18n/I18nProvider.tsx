import { createContext, createSignal, type JSX, useContext } from 'solid-js';
import { getLanguagePreference, setLanguagePreference } from '@/storage/browserPreferences';
import { type Language, languages, type MessageKey, messages } from './messages';

export type SetLanguageOptions = {
  saveToProfile?: boolean;
};

export type LanguageSaveRequest = {
  language: Language;
  version: number;
};

type I18nContextValue = {
  language: () => Language;
  languageSaveRequest: () => LanguageSaveRequest | undefined;
  setLanguage: (language: Language, options?: SetLanguageOptions) => void;
  t: (key: MessageKey) => string;
};

const I18nContext = createContext<I18nContextValue>();

function detectLanguage(): Language {
  const stored = getLanguagePreference();

  if (stored) {
    return stored;
  }

  const browserLanguage = navigator.languages
    .map((language) => language.toLowerCase().split('-')[0])
    .find((language) => languages.includes(language as Language));

  return (browserLanguage as Language | undefined) ?? 'en';
}

export function I18nProvider(props: { children: JSX.Element }) {
  const [language, setLanguageSignal] = createSignal<Language>(detectLanguage());
  const [languageSaveRequest, setLanguageSaveRequest] = createSignal<LanguageSaveRequest>();
  let nextLanguageSaveRequestVersion = 0;

  const setLanguage = (nextLanguage: Language, options?: SetLanguageOptions) => {
    setLanguagePreference(nextLanguage);
    setLanguageSignal(nextLanguage);

    if (options?.saveToProfile === false) {
      return;
    }

    nextLanguageSaveRequestVersion += 1;
    setLanguageSaveRequest({
      language: nextLanguage,
      version: nextLanguageSaveRequestVersion,
    });
  };

  const t = (key: MessageKey) => messages[key][language()];

  return (
    <I18nContext.Provider value={{ language, languageSaveRequest, setLanguage, t }}>
      {props.children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error('useI18n must be used inside I18nProvider');
  }

  return context;
}
