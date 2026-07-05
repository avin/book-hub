import { Navigate, Route, Router } from "@solidjs/router";
import { type JSX, Show } from "solid-js";
import { createCurrentUserQuery } from "@/api/user";
import AuthPage from "@/components/pages/AuthPage/AuthPage";
import TodoPage from "@/components/pages/TodoPage/TodoPage";

function AuthGate(props: {
  children: JSX.Element;
  fallbackHref: string;
  requireAuth: boolean;
}) {
  const currentUserQuery = createCurrentUserQuery();
  const isAuthenticated = () => Boolean(currentUserQuery.data) && !currentUserQuery.isError;

  return (
    <Show when={!currentUserQuery.isPending}>
      <Show when={isAuthenticated() === props.requireAuth} fallback={<Navigate href={props.fallbackHref} />}>
        {props.children}
      </Show>
    </Show>
  );
}

function PublicOnlyRoute(props: { children: JSX.Element }) {
  return (
    <AuthGate requireAuth={false} fallbackHref="/library">
      {props.children}
    </AuthGate>
  );
}

function PrivateRoute(props: { children: JSX.Element }) {
  return (
    <AuthGate requireAuth fallbackHref="/login">
      {props.children}
    </AuthGate>
  );
}

export function App() {
  return (
    <Router>
      <Route
        path="/"
        component={() => (
          <PrivateRoute>
            <Navigate href="/library" />
          </PrivateRoute>
        )}
      />
      <Route
        path="/login"
        component={() => (
          <PublicOnlyRoute>
            <AuthPage mode="login" />
          </PublicOnlyRoute>
        )}
      />
      <Route
        path="/register"
        component={() => (
          <PublicOnlyRoute>
            <AuthPage mode="register" />
          </PublicOnlyRoute>
        )}
      />
      <Route
        path="/library"
        component={() => (
          <PrivateRoute>
            <TodoPage titleKey="library" />
          </PrivateRoute>
        )}
      />
      <Route
        path="/upload"
        component={() => (
          <PrivateRoute>
            <TodoPage titleKey="upload" />
          </PrivateRoute>
        )}
      />
      <Route
        path="/settings"
        component={() => (
          <PrivateRoute>
            <TodoPage titleKey="settings" />
          </PrivateRoute>
        )}
      />
      <Route
        path="/reader/:bookId"
        component={() => (
          <PrivateRoute>
            <TodoPage titleKey="reader" />
          </PrivateRoute>
        )}
      />
      <Route
        path="*404"
        component={() => (
          <PrivateRoute>
            <TodoPage titleKey="dashboard" />
          </PrivateRoute>
        )}
      />
    </Router>
  );
}
