import { type JSX } from "solid-js";
import AuthGate from "../AuthGate/AuthGate";

function PublicOnlyRoute(props: { children: JSX.Element }) {
  return (
    <AuthGate requireAuth={false} fallbackHref="/library">
      {props.children}
    </AuthGate>
  );
}

export default PublicOnlyRoute;
