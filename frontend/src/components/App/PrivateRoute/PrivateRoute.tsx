import { type JSX } from 'solid-js';
import AuthGate from '../AuthGate/AuthGate';

function PrivateRoute(props: { children: JSX.Element; onReady?: () => void }) {
  return (
    <AuthGate requireAuth fallbackHref="/login" onReady={props.onReady}>
      {props.children}
    </AuthGate>
  );
}

export default PrivateRoute;
