import { JSX } from "solid-js";
import { BookOpen } from "lucide-solid";
import { Language, languages } from "@/i18n/messages";
import { useI18n } from "@/i18n/I18nProvider";
import styles from "./AuthLayout.module.scss";

type AuthLayoutProps = {
  children: JSX.Element;
};

function AuthLayout(props: AuthLayoutProps) {
  const { language, setLanguage, t } = useI18n();

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
          <label for="language-select">{t("language")}</label>
          <select
            id="language-select"
            value={language()}
            onChange={(event) => setLanguage(event.currentTarget.value as Language)}
          >
            <option value={languages[0]}>{t("russian")}</option>
            <option value={languages[1]}>{t("english")}</option>
          </select>
        </div>
        {props.children}
      </section>
    </main>
  );
}

export default AuthLayout;
