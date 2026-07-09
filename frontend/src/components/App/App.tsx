import { Navigate, Route, Router } from '@solidjs/router';
import { lazy, Suspense } from 'solid-js';
import type { JSX } from 'solid-js';
import LoadingScreen from '@/components/common/LoadingScreen/LoadingScreen';
import { useI18n } from '@/i18n/I18nProvider';
import PrivateRoute from './PrivateRoute/PrivateRoute';
import PublicOnlyRoute from './PublicOnlyRoute/PublicOnlyRoute';

const AuthPage = lazy(() => import('@/components/pages/AuthPage/AuthPage'));
const LibraryPage = lazy(() => import('@/components/pages/LibraryPage/LibraryPage'));
const ReaderPage = lazy(() => import('@/components/pages/ReaderPage/ReaderPage'));
const SettingsPage = lazy(() => import('@/components/pages/SettingsPage/SettingsPage'));
const UploadPage = lazy(() => import('@/components/pages/UploadPage/UploadPage'));

function PageFallback() {
  const { t } = useI18n();

  return <LoadingScreen label={t('loading')} />;
}

function LazyPage(props: { children: JSX.Element }) {
  return <Suspense fallback={<PageFallback />}>{props.children}</Suspense>;
}

function App() {
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
            <LazyPage>
              <AuthPage mode="login" />
            </LazyPage>
          </PublicOnlyRoute>
        )}
      />
      <Route
        path="/register"
        component={() => (
          <PublicOnlyRoute>
            <LazyPage>
              <AuthPage mode="register" />
            </LazyPage>
          </PublicOnlyRoute>
        )}
      />
      <Route
        path="/library"
        component={() => (
          <PrivateRoute>
            <LazyPage>
              <LibraryPage />
            </LazyPage>
          </PrivateRoute>
        )}
      />
      <Route
        path="/upload"
        component={() => (
          <PrivateRoute>
            <LazyPage>
              <UploadPage />
            </LazyPage>
          </PrivateRoute>
        )}
      />
      <Route
        path="/settings"
        component={() => (
          <PrivateRoute>
            <LazyPage>
              <SettingsPage />
            </LazyPage>
          </PrivateRoute>
        )}
      />
      <Route
        path="/reader/:bookId"
        component={() => (
          <PrivateRoute>
            <LazyPage>
              <ReaderPage />
            </LazyPage>
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

export default App;
