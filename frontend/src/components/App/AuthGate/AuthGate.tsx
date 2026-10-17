import { Navigate, useLocation } from '@solidjs/router';
import { createEffect, type JSX, Show } from 'solid-js';
import { createCurrentUserQuery } from '@/api/user';
import LoadingScreen from '@/components/common/LoadingScreen/LoadingScreen';

export type AuthRedirectState = {
  from?: string;
};

export function authRedirectTarget(state: unknown, fallback: string) {
  const from = (state as AuthRedirectState | null | undefined)?.from;

  return typeof from === 'string' && from.startsWith('/') ? from : fallback;
}

function AuthGate(props: {
  children: JSX.Element;
  fallbackHref: string;
  requireAuth: boolean;
  onReady?: () => void;
}) {
  const location = useLocation();
  const currentUserQuery = createCurrentUserQuery();
  const isAuthenticated = () => Boolean(currentUserQuery.data) && !currentUserQuery.isError;
  const allowed = () => !currentUserQuery.isPending && isAuthenticated() === props.requireAuth;

  createEffect(() => {
    if (allowed()) {
      props.onReady?.();
    }
  });

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
      <Show when={allowed()} fallback={redirect()}>
        {props.children}
      </Show>
    </Show>
  );
}

export default AuthGate;
