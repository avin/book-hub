import AppLayout from "@/components/layouts/AppLayout/AppLayout";
import type { MessageKey } from "@/i18n/messages";
import { useI18n } from "@/i18n/I18nProvider";
import styles from "./TodoPage.module.scss";

function TodoPage(props: {
  titleKey: MessageKey;
}) {
  const { t } = useI18n();

  return (
    <AppLayout>
      <section class={styles.todo}>
        <p class={styles.kicker}>{t("todo")}</p>
        <h1>{t(props.titleKey)}</h1>
        <p>{t("sectionPreparedImplementationLater")}</p>
      </section>
    </AppLayout>
  );
}

export default TodoPage;
