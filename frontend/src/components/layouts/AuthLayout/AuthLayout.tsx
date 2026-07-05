import { JSX } from "solid-js";
import LanguageSelect from "@/components/common/LanguageSelect/LanguageSelect";
import styles from "./AuthLayout.module.scss";

type AuthLayoutProps = {
  children: JSX.Element;
};

function AuthLayout(props: AuthLayoutProps) {
  return (
    <main class={styles.layout}>
      <section class={styles.panel}>
        {props.children}
      </section>

      <div class={styles.languageRow}>
        <LanguageSelect />
      </div>
    </main>
  );
}

export default AuthLayout;
