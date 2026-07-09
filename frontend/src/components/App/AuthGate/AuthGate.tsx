import { Navigate } from '@solidjs/router';
import { type JSX, Show } from 'solid-js';
import { createCurrentUserQuery } from '@/api/user';
import LoadingScreen from '@/components/common/LoadingScreen/LoadingScreen';

function AuthGate(props: { children: JSX.Element; fallbackHref: string; requireAuth: boolean }) {
  const currentUserQuery = createCurrentUserQuery();
  const isAuthenticated = () => Boolean(currentUserQuery.data) && !currentUserQuery.isError;

  return (
    <Show when={!currentUserQuery.isPending} fallback={<LoadingScreen />}>
      <Show
        when={isAuthenticated() === props.requireAuth}
        fallback={<Navigate href={props.fallbackHref} />}
      >
        {props.children}
      </Show>
    </Show>
  );
}

export default AuthGate;
