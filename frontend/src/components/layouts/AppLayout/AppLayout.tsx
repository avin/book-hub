import { A, useNavigate } from "@solidjs/router";
import type { JSX } from "solid-js";
import { BookOpen, Library, LogOut, Settings, Upload } from "lucide-solid";
import { createLogoutMutation } from "@/api/auth";
import Button from "@/components/common/Button/Button";
import LanguageSelect from "@/components/common/LanguageSelect/LanguageSelect";
import { useI18n } from "@/i18n/I18nProvider";
import styles from "./AppLayout.module.scss";

function AppLayout(props: {
  children: JSX.Element;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const logoutMutation = createLogoutMutation();

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        navigate("/login", { replace: true });
      },
    });
  };

  return (
    <div class={styles.layout}>
      <aside class={styles.sidebar}>
        <div class={styles.sidebarHeader}>
          <div class={styles.brand}>
            <BookOpen />
            <span>{t("bookHub")}</span>
          </div>
        </div>

        <nav class={styles.nav}>
          <A href="/library">
            <Library />
            <span class={styles.navLabel}>{t("library")}</span>
          </A>
          <A href="/upload">
            <Upload />
            <span class={styles.navLabel}>{t("upload")}</span>
          </A>
          <A href="/settings">
            <Settings />
            <span class={styles.navLabel}>{t("settings")}</span>
          </A>
        </nav>

        <div class={styles.sidebarActions}>
          <LanguageSelect fullWidth placement="top-start" />
        </div>

        <div class={styles.sidebarFooter}>
          <Button
            class={styles.logoutButton}
            type="button"
            variant="ghost"
            loading={logoutMutation.isPending}
            iconStart={<LogOut />}
            onClick={handleLogout}
          >
            {t("signOut")}
          </Button>
        </div>
      </aside>
      <main class={styles.content}>{props.children}</main>
    </div>
  );
}

export default AppLayout;
