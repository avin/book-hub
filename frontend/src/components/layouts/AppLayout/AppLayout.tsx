import { A, useNavigate } from "@solidjs/router";
import type { JSX } from "solid-js";
import { BookOpen, Library, LogOut, Settings, Upload } from "lucide-solid";
import { createLogoutMutation } from "@/api/auth";
import Button from "@/components/common/Button/Button";
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
