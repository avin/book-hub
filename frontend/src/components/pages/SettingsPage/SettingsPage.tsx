import { createMemo, createSignal, onMount, Show } from 'solid-js';
import { Database, KeyRound, Palette, RotateCcw } from 'lucide-solid';
import { createResetAllReadingProgressMutation } from '@/api/books';
import { createChangePasswordMutation, createCurrentUserQuery } from '@/api/user';
import Button from '@/components/common/Button/Button';
import InputContainer from '@/components/common/InputContainer/InputContainer';
import TextInput from '@/components/common/TextInput/TextInput';
import ThemeSelect from '@/components/common/ThemeSelect/ThemeSelect';
import AppLayout from '@/components/layouts/AppLayout/AppLayout';
import { useI18n } from '@/i18n/I18nProvider';
import { getThemePreference } from '@/storage/browserPreferences';
import { changeTheme } from '@/styles/ThemeSync';
import { defaultThemeId, type ThemeId } from '@/styles/themes';
import styles from './SettingsPage.module.scss';

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }

  const units = ['KB', 'MB', 'GB'];
  let nextValue = value / 1024;
  let unitIndex = 0;

  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }

  return `${nextValue.toFixed(nextValue >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function errorMessage(error: unknown, fallback: string) {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }

  return fallback;
}

function SettingsPage() {
  const { t } = useI18n();
  const currentUserQuery = createCurrentUserQuery();
  const changePasswordMutation = createChangePasswordMutation();
  const resetAllProgressMutation = createResetAllReadingProgressMutation();
  const [currentPassword, setCurrentPassword] = createSignal('');
  const [newPassword, setNewPassword] = createSignal('');
  const [repeatPassword, setRepeatPassword] = createSignal('');
  const [passwordError, setPasswordError] = createSignal('');
  const [passwordSaved, setPasswordSaved] = createSignal(false);
  const [progressResetError, setProgressResetError] = createSignal('');
  const [progressResetDone, setProgressResetDone] = createSignal(false);
  const [activeTheme, setActiveTheme] = createSignal<ThemeId>(defaultThemeId());
  const user = createMemo(() => currentUserQuery.data);

  onMount(() => {
    setActiveTheme(getThemePreference() ?? defaultThemeId());
  });

  const handleChangeTheme = (themeId: ThemeId) => {
    setActiveTheme(themeId);
    changeTheme(themeId);
  };

  const handleResetAllProgress = () => {
    if (!window.confirm(t('resetAllProgressConfirm'))) {
      return;
    }

    setProgressResetError('');
    setProgressResetDone(false);
    resetAllProgressMutation.mutate(undefined, {
      onSuccess: () => setProgressResetDone(true),
      onError: () => setProgressResetError(t('requestFailedTryAgain')),
    });
  };
  const usedPercent = createMemo(() => {
    const currentUser = user();
    if (!currentUser || currentUser.quota_bytes === 0) {
      return 0;
    }

    return Math.min(100, (currentUser.used_bytes / currentUser.quota_bytes) * 100);
  });

  const updatePasswordField = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPasswordError('');
    setPasswordSaved(false);
  };

  const handleChangePassword = (event: Event) => {
    event.preventDefault();
    setPasswordError('');
    setPasswordSaved(false);

    if (!currentPassword() || !newPassword()) {
      setPasswordError(t('fillField'));
      return;
    }

    if (newPassword() !== repeatPassword()) {
      setPasswordError(t('passwordsDoNotMatch'));
      return;
    }

    changePasswordMutation.mutate(
      {
        currentPassword: currentPassword(),
        newPassword: newPassword(),
      },
      {
        onSuccess: () => {
          setCurrentPassword('');
          setNewPassword('');
          setRepeatPassword('');
          setPasswordSaved(true);
        },
        onError: (nextError) =>
          setPasswordError(errorMessage(nextError, t('requestFailedTryAgain'))),
      },
    );
  };

  return (
    <AppLayout>
      <section class={styles.settingsPage}>
        <header class={styles.header}>
          <p class={styles.kicker}>{t('settings')}</p>
          <h1>
            {t('accountSettings')}
            <Show when={user()}>
              {(currentUser) => <span class={styles.accountName}> {currentUser().login}</span>}
            </Show>
          </h1>
        </header>

        <div class={styles.grid}>
          <form class={styles.panel} onSubmit={handleChangePassword}>
            <header class={styles.panelHeader}>
              <KeyRound />
              <h2>{t('changePassword')}</h2>
            </header>

            <InputContainer label={t('currentPassword')}>
              <TextInput
                type="password"
                value={currentPassword()}
                onInput={(event) =>
                  updatePasswordField(setCurrentPassword, event.currentTarget.value)
                }
              />
            </InputContainer>
            <InputContainer label={t('newPassword')}>
              <TextInput
                type="password"
                value={newPassword()}
                onInput={(event) => updatePasswordField(setNewPassword, event.currentTarget.value)}
              />
            </InputContainer>
            <InputContainer label={t('repeatPassword')}>
              <TextInput
                type="password"
                value={repeatPassword()}
                onInput={(event) =>
                  updatePasswordField(setRepeatPassword, event.currentTarget.value)
                }
              />
            </InputContainer>

            <Show when={passwordError()}>
              <p class={styles.error}>{passwordError()}</p>
            </Show>
            <Show when={passwordSaved()}>
              <p class={styles.success}>{t('passwordChanged')}</p>
            </Show>

            <footer class={styles.panelActions}>
              <Button type="submit" loading={changePasswordMutation.isPending}>
                {t('savePassword')}
              </Button>
            </footer>
          </form>

          <section class={styles.panel}>
            <header class={styles.panelHeader}>
              <Database />
              <h2>{t('storage')}</h2>
            </header>

            <Show when={user()}>
              {(currentUser) => (
                <>
                  <div class={styles.storageBar}>
                    <span style={{ width: `${usedPercent()}%` }} />
                  </div>
                  <p class={styles.storageText}>
                    {formatBytes(currentUser().used_bytes)} /{' '}
                    {formatBytes(currentUser().quota_bytes)}
                  </p>
                </>
              )}
            </Show>
          </section>
        </div>

        <section class={styles.panel}>
          <header class={styles.panelHeader}>
            <Palette />
            <h2>{t('appearance')}</h2>
          </header>

          <ThemeSelect value={activeTheme()} onChange={handleChangeTheme} />
        </section>

        <section class={styles.panel}>
          <header class={styles.panelHeader}>
            <RotateCcw />
            <h2>{t('data')}</h2>
          </header>

          <div class={styles.dangerRow}>
            <div class={styles.dangerText}>
              <p class={styles.dangerTitle}>{t('resetAllProgress')}</p>
              <p class={styles.dangerHint}>{t('resetAllProgressDescription')}</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              destructive
              loading={resetAllProgressMutation.isPending}
              onClick={handleResetAllProgress}
            >
              {t('resetAllProgress')}
            </Button>
          </div>
          <Show when={progressResetError()}>
            <p class={styles.error}>{progressResetError()}</p>
          </Show>
          <Show when={progressResetDone()}>
            <p class={styles.success}>{t('resetAllProgressDone')}</p>
          </Show>
        </section>
      </section>
    </AppLayout>
  );
}

export default SettingsPage;
