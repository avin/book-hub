import { Eye, EyeOff } from 'lucide-solid';
import { A, useLocation, useNavigate } from '@solidjs/router';
import { createEffect, createMemo, createSignal, on, Show } from 'solid-js';
import Button from '@/components/common/Button/Button';
import InputContainer from '@/components/common/InputContainer/InputContainer';
import TextInput from '@/components/common/TextInput/TextInput';
import AuthLayout from '@/components/layouts/AuthLayout/AuthLayout';
import { createLoginMutation, createRegisterMutation } from '@/api/auth';
import { authRedirectTarget } from '@/components/App/AuthGate/AuthGate';
import { useI18n } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/messages';
import styles from './AuthPage.module.scss';

function apiErrorCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;

  return typeof code === 'string' ? code : undefined;
}

function authErrorMessage(error: unknown, isRegister: boolean): MessageKey {
  switch (apiErrorCode(error)) {
    case 'account_inactive':
      return 'accountNotActivated';
    case 'unauthorized':
      return isRegister ? 'requestFailedTryAgain' : 'invalidLoginOrPassword';
    case 'registration_disabled':
      return 'registrationDisabled';
    default:
      return 'requestFailedTryAgain';
  }
}

function AuthPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const loginMutation = createLoginMutation();
  const registerMutation = createRegisterMutation();

  const [login, setLogin] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [repeatPassword, setRepeatPassword] = createSignal('');
  const [showPassword, setShowPassword] = createSignal(false);
  const [formError, setFormError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal<string | null>(null);

  const isRegister = createMemo(() => location.pathname.endsWith('/register'));

  createEffect(
    on(
      isRegister,
      () => {
        setFormError(null);
        setSuccess(null);
      },
      { defer: true },
    ),
  );
  const isPending = createMemo(() => loginMutation.isPending || registerMutation.isPending);
  const loginError = createMemo(() =>
    formError() && !login().trim() ? t('fillField') : undefined,
  );
  const passwordError = createMemo(() => (formError() && !password() ? t('fillField') : undefined));
  const repeatPasswordError = createMemo(() => {
    if (!isRegister() || !formError()) {
      return undefined;
    }

    if (!repeatPassword()) {
      return t('fillField');
    }

    return password() !== repeatPassword() ? t('passwordsDoNotMatch') : undefined;
  });

  const updateField = (setter: (value: string) => void, value: string) => {
    setter(value);
    setFormError(null);
    setSuccess(null);
  };

  const validate = () => {
    if (!login().trim() || !password()) {
      setFormError(t('fillField'));
      return false;
    }

    if (isRegister() && password() !== repeatPassword()) {
      setFormError(t('passwordsDoNotMatch'));
      return false;
    }

    return true;
  };

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    setFormError(null);
    setSuccess(null);

    if (!validate()) {
      return;
    }

    try {
      const credentials = {
        login: login().trim(),
        password: password(),
      };

      if (isRegister()) {
        const registration = await registerMutation.mutateAsync(credentials);

        if (!registration.is_active) {
          setSuccess(t('requestCreatedWaitActivation'));
          return;
        }
      }

      await loginMutation.mutateAsync(credentials);
      navigate(authRedirectTarget(location.state, '/library'), { replace: true });
    } catch (error) {
      setFormError(t(authErrorMessage(error, isRegister())));
    }
  };

  return (
    <AuthLayout>
      <div class={styles.auth}>
        <header class={styles.header}>
          <h1>{t('bookHub')}</h1>
        </header>

        <div class={styles.tabs} role="tablist" aria-label={t('bookHub')}>
          <A
            classList={{ [styles.active]: !isRegister() }}
            href="/login"
            state={location.state}
            replace
            role="tab"
            aria-selected={!isRegister()}
          >
            {t('signIn')}
          </A>
          <A
            classList={{ [styles.active]: isRegister() }}
            href="/register"
            state={location.state}
            replace
            role="tab"
            aria-selected={isRegister()}
          >
            {t('register')}
          </A>
        </div>

        <form class={styles.form} onSubmit={submit}>
          <InputContainer label={t('login')} error={loginError()}>
            <TextInput
              id="login"
              value={login()}
              placeholder={t('login')}
              invalid={Boolean(loginError())}
              autocomplete="username"
              onInput={(event) => updateField(setLogin, event.currentTarget.value)}
            />
          </InputContainer>

          <InputContainer
            label={t('password')}
            error={passwordError()}
            endContent={
              <button
                type="button"
                class={styles.iconButton}
                aria-label={showPassword() ? t('hidePassword') : t('showPassword')}
                onClick={() => setShowPassword(!showPassword())}
              >
                <Show when={showPassword()} fallback={<Eye />}>
                  <EyeOff />
                </Show>
              </button>
            }
          >
            <TextInput
              id="password"
              type={showPassword() ? 'text' : 'password'}
              value={password()}
              placeholder={t('password')}
              invalid={Boolean(passwordError())}
              autocomplete={isRegister() ? 'new-password' : 'current-password'}
              onInput={(event) => updateField(setPassword, event.currentTarget.value)}
            />
          </InputContainer>

          <Show when={isRegister()}>
            <InputContainer label={t('repeatPassword')} error={repeatPasswordError()}>
              <TextInput
                id="repeat-password"
                type={showPassword() ? 'text' : 'password'}
                value={repeatPassword()}
                placeholder={t('repeatPassword')}
                invalid={Boolean(repeatPasswordError())}
                autocomplete="new-password"
                onInput={(event) => updateField(setRepeatPassword, event.currentTarget.value)}
              />
            </InputContainer>
          </Show>

          <Show when={formError() && !loginError() && !passwordError() && !repeatPasswordError()}>
            <div class={styles.alert} role="alert">
              {formError()}
            </div>
          </Show>

          <Show when={success()}>
            <div class={styles.success} role="status">
              {success()}
            </div>
          </Show>

          <Button type="submit" loading={isPending()}>
            {isRegister() ? t('createAccount') : t('signIn')}
          </Button>
        </form>

        <Show when={isRegister()}>
          <p class={styles.hint}>{t('afterRegistrationAdminActivatesAccount')}</p>
        </Show>
      </div>
    </AuthLayout>
  );
}

export default AuthPage;
