import { Navigate, Route, Router, type RouteSectionProps } from '@solidjs/router';
import { lazy } from 'solid-js';
import AppLayout from '@/components/layouts/AppLayout/AppLayout';
import PageBoundary from './PageBoundary/PageBoundary';
import PrivateRoute from './PrivateRoute/PrivateRoute';
import PublicOnlyRoute from './PublicOnlyRoute/PublicOnlyRoute';

const loadAuthPage = () => import('@/components/pages/AuthPage/AuthPage');
const loadLibraryPage = () => import('@/components/pages/LibraryPage/LibraryPage');
const loadReaderPage = () => import('@/components/pages/ReaderPage/ReaderPage');
const loadSettingsPage = () => import('@/components/pages/SettingsPage/SettingsPage');
const loadUploadPage = () => import('@/components/pages/UploadPage/UploadPage');

const AuthPage = lazy(loadAuthPage);
const LibraryPage = lazy(loadLibraryPage);
const ReaderPage = lazy(loadReaderPage);
const SettingsPage = lazy(loadSettingsPage);
const UploadPage = lazy(loadUploadPage);

const routerBase = import.meta.env.BASE_URL.replace(/\/+$/, '');

function preloadPrivatePages() {
  void loadLibraryPage();
  void loadReaderPage();
  void loadSettingsPage();
  void loadUploadPage();
}

function PublicShell(props: RouteSectionProps) {
  return (
    <PublicOnlyRoute>
      <PageBoundary>{props.children}</PageBoundary>
    </PublicOnlyRoute>
  );
}

function AppShell(props: RouteSectionProps) {
  return (
    <PrivateRoute onReady={preloadPrivatePages}>
      <AppLayout>
        <PageBoundary>{props.children}</PageBoundary>
      </AppLayout>
    </PrivateRoute>
  );
}

function ReaderShell(props: RouteSectionProps) {
  return (
    <PrivateRoute>
      <PageBoundary>{props.children}</PageBoundary>
    </PrivateRoute>
  );
}

function App() {
  return (
    <Router base={routerBase}>
      <Route component={PublicShell}>
        <Route path={['/login', '/register']} component={AuthPage} />
      </Route>
      <Route component={AppShell}>
        <Route path="/library" component={LibraryPage} />
        <Route path="/upload" component={UploadPage} />
        <Route path="/settings" component={SettingsPage} />
      </Route>
      <Route component={ReaderShell}>
        <Route path="/reader/:bookId" component={ReaderPage} />
      </Route>
      <Route path="*404" component={() => <Navigate href="/library" />} />
    </Router>
  );
}

export default App;
