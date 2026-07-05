import { Navigate, Route, Router } from "@solidjs/router";
import { type JSX, Show } from "solid-js";
import { createCurrentUserQuery } from "@/api/user";
import AuthPage from "@/components/pages/AuthPage/AuthPage";
import LibraryPage from "@/components/pages/LibraryPage/LibraryPage";
import ReaderPage from "@/components/pages/ReaderPage/ReaderPage";
import SettingsPage from "@/components/pages/SettingsPage/SettingsPage";
import UploadPage from "@/components/pages/UploadPage/UploadPage";

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
            <LibraryPage />
          </PrivateRoute>
        )}
      />
      <Route
        path="/upload"
        component={() => (
          <PrivateRoute>
            <UploadPage />
          </PrivateRoute>
        )}
      />
      <Route
        path="/settings"
        component={() => (
          <PrivateRoute>
            <SettingsPage />
          </PrivateRoute>
        )}
      />
      <Route
        path="/reader/:bookId"
        component={() => (
          <PrivateRoute>
            <ReaderPage />
          </PrivateRoute>
        )}
      />
      <Route
        path="*404"
        component={() => (
          <PrivateRoute>
            <Navigate href="/library" />
          </PrivateRoute>
        )}
      />
    </Router>
  );
}
