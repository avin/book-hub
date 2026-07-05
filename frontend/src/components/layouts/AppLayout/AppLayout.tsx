import { A } from "@solidjs/router";
import { JSX } from "solid-js";
import { BookOpen, Library, Settings, Upload } from "lucide-solid";
import { useI18n } from "@/i18n/I18nProvider";
import styles from "./AppLayout.module.scss";

type AppLayoutProps = {
  children: JSX.Element;
};

function AppLayout(props: AppLayoutProps) {
  const { t } = useI18n();

  return (
    <div class={styles.layout}>
      <aside class={styles.sidebar}>
        <div class={styles.brand}>
          <BookOpen />
          <span>{t("bookHub")}</span>
        </div>
        <nav class={styles.nav}>
          <A href="/library">
            <Library />
            {t("library")}
          </A>
          <A href="/upload">
            <Upload />
            {t("upload")}
          </A>
          <A href="/settings">
            <Settings />
            {t("settings")}
          </A>
        </nav>
      </aside>
      <main class={styles.content}>{props.children}</main>
    </div>
  );
}

export default AppLayout;
