import { Navigate, Route, Router } from "@solidjs/router";
import AuthPage from "@/components/pages/AuthPage/AuthPage";
import LibraryPage from "@/components/pages/LibraryPage/LibraryPage";
import ReaderPage from "@/components/pages/ReaderPage/ReaderPage";
import SettingsPage from "@/components/pages/SettingsPage/SettingsPage";
import UploadPage from "@/components/pages/UploadPage/UploadPage";
import PrivateRoute from "./PrivateRoute/PrivateRoute";
import PublicOnlyRoute from "./PublicOnlyRoute/PublicOnlyRoute";

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

export default App;
