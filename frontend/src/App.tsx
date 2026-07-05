import { Navigate, Route, Router } from "@solidjs/router";
import AuthPage from "@/components/pages/AuthPage/AuthPage";
import TodoPage from "@/components/pages/TodoPage/TodoPage";

export function App() {
  return (
    <Router>
      <Route path="/" component={() => <Navigate href="/login" />} />
      <Route path="/login" component={() => <AuthPage mode="login" />} />
      <Route path="/register" component={() => <AuthPage mode="register" />} />
      <Route path="/library" component={() => <TodoPage titleKey="library" />} />
      <Route path="/upload" component={() => <TodoPage titleKey="upload" />} />
      <Route path="/settings" component={() => <TodoPage titleKey="settings" />} />
      <Route path="/reader/:bookId" component={() => <TodoPage titleKey="reader" />} />
      <Route path="*404" component={() => <TodoPage titleKey="dashboard" />} />
    </Router>
  );
}
