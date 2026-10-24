import { Navigate, useLocation } from '@solidjs/router';
import { type JSX, Show } from 'solid-js';
import { createCurrentUserQuery } from '@/api/user';
import Button from '@/components/common/Button/Button';
import LoadingScreen from '@/components/common/LoadingScreen/LoadingScreen';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './AuthGate.module.scss';

export type AuthRedirectState = {
  from?: string;
};

export function authRedirectTarget(state: unknown, fallback: string) {
  const from = (state as AuthRedirectState | null | undefined)?.from;

  return typeof from === 'string' && from.startsWith('/') ? from : fallback;
}

function AuthGate(props: { children: JSX.Element; fallbackHref: string; requireAuth: boolean }) {
  const { t } = useI18n();
  const location = useLocation();
  const currentUserQuery = createCurrentUserQuery();
  const errorCode = () => (currentUserQuery.error as { code?: string } | null)?.code;
  const isAuthenticated = () => Boolean(currentUserQuery.data) && errorCode() !== 'unauthorized';
  const hasUnknownSession = () =>
    currentUserQuery.isError && errorCode() !== 'unauthorized' && !currentUserQuery.data;
  const allowed = () => !currentUserQuery.isPending && isAuthenticated() === props.requireAuth;

  const redirect = () =>
    props.requireAuth ? (
      <Navigate
        href={props.fallbackHref}
        state={{ from: `${location.pathname}${location.search}` } satisfies AuthRedirectState}
      />
    ) : (
      <Navigate href={authRedirectTarget(location.state, props.fallbackHref)} />
    );

  return (
    <Show when={!currentUserQuery.isPending} fallback={<LoadingScreen />}>
      <Show
        when={!hasUnknownSession()}
        fallback={
          <div class={styles.sessionError} role="alert">
            <p>
              {t(
                errorCode() === 'service_unavailable'
                  ? 'serverTemporarilyUnavailable'
                  : 'pageFailedToLoad',
              )}
            </p>
            <Button type="button" variant="secondary" onClick={() => currentUserQuery.refetch()}>
              {t('tryAgain')}
            </Button>
          </div>
        }
      >
        <Show when={allowed()} fallback={redirect()}>
          {props.children}
        </Show>
      </Show>
    </Show>
  );
}

export default AuthGate;
