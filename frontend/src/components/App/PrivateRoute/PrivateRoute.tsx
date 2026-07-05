import { type JSX } from "solid-js";
import AuthGate from "../AuthGate/AuthGate";

function PrivateRoute(props: { children: JSX.Element }) {
  return (
    <AuthGate requireAuth fallbackHref="/login">
      {props.children}
    </AuthGate>
  );
}

export default PrivateRoute;
