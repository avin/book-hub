import { JSX } from "solid-js";
import { BookOpen } from "lucide-solid";
import LanguageSelect from "@/components/common/LanguageSelect/LanguageSelect";
import { useI18n } from "@/i18n/I18nProvider";
import styles from "./AuthLayout.module.scss";

type AuthLayoutProps = {
  children: JSX.Element;
};

function AuthLayout(props: AuthLayoutProps) {
  const { t } = useI18n();

  return (
    <main class={styles.layout}>
      <section class={styles.intro} aria-labelledby="auth-title">
        <div class={styles.brandMark} aria-hidden="true">
          <BookOpen />
        </div>
        <div>
          <h1 id="auth-title">{t("bookHub")}</h1>
          <p>{t("privateLibraryStoreReadBooks")}</p>
        </div>
      </section>

      <section class={styles.panel}>
        <div class={styles.languageRow}>
          <LanguageSelect />
        </div>
        {props.children}
      </section>
    </main>
  );
}

export default AuthLayout;
