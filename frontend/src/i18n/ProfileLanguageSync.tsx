import { createEffect, createSignal, on, untrack } from 'solid-js';
import {
  createCurrentUserSettingsQuery,
  createMergeCurrentUserSettingsMutation,
  type Settings,
} from '@/api/settings';
import { createCurrentUserQuery } from '@/api/user';
import { useI18n, type LanguageSaveRequest } from './I18nProvider';
import { type Language, languages } from './messages';

const languageSettingsKey = 'language';

function settingsLanguage(settings: Settings | undefined) {
  const language = settings?.[languageSettingsKey];

  if (typeof language === 'string' && languages.includes(language as Language)) {
    return language as Language;
  }

  return undefined;
}

function ProfileLanguageSync() {
  const { language, languageSaveRequest, setLanguage } = useI18n();
  const currentUserQuery = createCurrentUserQuery();
  const settingsQuery = createCurrentUserSettingsQuery(() => Boolean(currentUserQuery.data));
  const mergeSettingsMutation = createMergeCurrentUserSettingsMutation();
  const [authenticatedLanguageSaveRequest, setAuthenticatedLanguageSaveRequest] =
    createSignal<LanguageSaveRequest>();
  let currentSettingsUserId: string | undefined;
  let lastSavedRequestVersion = 0;

  createEffect(
    on(languageSaveRequest, (request) => {
      if (!request || !untrack(() => currentUserQuery.data)) {
        return;
      }

      setAuthenticatedLanguageSaveRequest(request);
    }),
  );

  createEffect(() => {
    const currentUser = currentUserQuery.data;
    const settings = settingsQuery.data;

    if (!currentUser) {
      currentSettingsUserId = undefined;
      setAuthenticatedLanguageSaveRequest(undefined);
      return;
    }

    if (settingsQuery.isPending || !settings) {
      return;
    }

    const isFirstSettingsLoadForUser = currentSettingsUserId !== currentUser.id;
    currentSettingsUserId = currentUser.id;

    const nextLanguage = settingsLanguage(settings);
    if (!nextLanguage) {
      return;
    }

    if (isFirstSettingsLoadForUser) {
      const pendingRequest = untrack(authenticatedLanguageSaveRequest);
      if (pendingRequest) {
        lastSavedRequestVersion = Math.max(lastSavedRequestVersion, pendingRequest.version);
        setAuthenticatedLanguageSaveRequest(undefined);
      }
    } else {
      const pendingRequest = untrack(authenticatedLanguageSaveRequest);
      if (pendingRequest && pendingRequest.version > lastSavedRequestVersion) {
        return;
      }
    }

    if (nextLanguage !== untrack(language)) {
      setLanguage(nextLanguage, { saveToProfile: false });
    }
  });

  createEffect(() => {
    const request = authenticatedLanguageSaveRequest();
    const currentUser = currentUserQuery.data;

    if (
      !request ||
      !currentUser ||
      request.version <= lastSavedRequestVersion ||
      settingsQuery.isPending ||
      settingsQuery.isError ||
      mergeSettingsMutation.isPending
    ) {
      return;
    }

    lastSavedRequestVersion = request.version;
    mergeSettingsMutation.mutate(
      { [languageSettingsKey]: request.language },
      {
        onError: () => {
          lastSavedRequestVersion = Math.min(lastSavedRequestVersion, request.version - 1);
        },
      },
    );
  });

  return null;
}

export default ProfileLanguageSync;
