import type { JSX } from "solid-js";
import LanguageSelect from "@/components/common/LanguageSelect/LanguageSelect";
import styles from "./AuthLayout.module.scss";

function AuthLayout(props: {
  children: JSX.Element;
}) {
  return (
    <main class={styles.layout}>
      <section class={styles.panel}>
        {props.children}
      </section>

      <div class={styles.languageRow}>
        <LanguageSelect placement="top" />
      </div>
    </main>
  );
}

export default AuthLayout;
