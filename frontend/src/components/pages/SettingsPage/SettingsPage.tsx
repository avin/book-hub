import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { Database, KeyRound, Save, User } from "lucide-solid";
import { createCurrentUserSettingsQuery, createUpdateCurrentUserSettingsMutation } from "@/api/settings";
import { createChangePasswordMutation, createCurrentUserQuery } from "@/api/user";
import Button from "@/components/common/Button/Button";
import InputContainer from "@/components/common/InputContainer/InputContainer";
import LanguageSelect from "@/components/common/LanguageSelect/LanguageSelect";
import TextInput from "@/components/common/TextInput/TextInput";
import AppLayout from "@/components/layouts/AppLayout/AppLayout";
import { useI18n } from "@/i18n/I18nProvider";
import styles from "./SettingsPage.module.scss";

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB"];
  let nextValue = value / 1024;
  let unitIndex = 0;

  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }

  return `${nextValue.toFixed(nextValue >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }

  return fallback;
}

function SettingsPage() {
  const { t } = useI18n();
  const currentUserQuery = createCurrentUserQuery();
  const settingsQuery = createCurrentUserSettingsQuery();
  const updateSettingsMutation = createUpdateCurrentUserSettingsMutation();
  const changePasswordMutation = createChangePasswordMutation();
  const [settingsJson, setSettingsJson] = createSignal("{}");
  const [currentPassword, setCurrentPassword] = createSignal("");
  const [newPassword, setNewPassword] = createSignal("");
  const [repeatPassword, setRepeatPassword] = createSignal("");
  const [settingsError, setSettingsError] = createSignal("");
  const [settingsSaved, setSettingsSaved] = createSignal(false);
  const [passwordError, setPasswordError] = createSignal("");
  const [passwordSaved, setPasswordSaved] = createSignal(false);
  const user = createMemo(() => currentUserQuery.data);
  const usedPercent = createMemo(() => {
    const currentUser = user();
    if (!currentUser || currentUser.quota_bytes === 0) {
      return 0;
    }

    return Math.min(100, (currentUser.used_bytes / currentUser.quota_bytes) * 100);
  });

  createEffect(() => {
    const settings = settingsQuery.data;
    if (!settings) {
      return;
    }

    setSettingsJson(JSON.stringify(settings, null, 2));
  });

  const handleSaveSettings = (event: Event) => {
    event.preventDefault();
    setSettingsError("");
    setSettingsSaved(false);

    let parsed: unknown;
    try {
      parsed = JSON.parse(settingsJson());
    } catch {
      setSettingsError(t("invalidJson"));
      return;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setSettingsError(t("settingsMustBeObject"));
      return;
    }

    updateSettingsMutation.mutate(parsed as Record<string, unknown>, {
      onSuccess: () => setSettingsSaved(true),
      onError: (nextError) => setSettingsError(errorMessage(nextError, t("requestFailedTryAgain"))),
    });
  };

  const handleChangePassword = (event: Event) => {
    event.preventDefault();
    setPasswordError("");
    setPasswordSaved(false);

    if (!currentPassword() || !newPassword()) {
      setPasswordError(t("fillField"));
      return;
    }

    if (newPassword() !== repeatPassword()) {
      setPasswordError(t("passwordsDoNotMatch"));
      return;
    }

    changePasswordMutation.mutate(
      {
        currentPassword: currentPassword(),
        newPassword: newPassword(),
      },
      {
        onSuccess: () => {
          setCurrentPassword("");
          setNewPassword("");
          setRepeatPassword("");
          setPasswordSaved(true);
        },
        onError: (nextError) => setPasswordError(errorMessage(nextError, t("requestFailedTryAgain"))),
      },
    );
  };

  return (
    <AppLayout>
      <section class={styles.settingsPage}>
        <header class={styles.header}>
          <p class={styles.kicker}>{t("settings")}</p>
          <h1>{t("accountSettings")}</h1>
        </header>

        <div class={styles.grid}>
          <section class={styles.panel}>
            <header class={styles.panelHeader}>
              <User />
              <h2>{t("profile")}</h2>
            </header>

            <Show when={user()}>
              {(currentUser) => (
                <div class={styles.profileRows}>
                  <div>
                    <span>{t("login")}</span>
                    <strong>{currentUser().login}</strong>
                  </div>
                  <div>
                    <span>{t("accountStatus")}</span>
                    <strong>{currentUser().is_active ? t("active") : t("inactive")}</strong>
                  </div>
                </div>
              )}
            </Show>

            <div class={styles.languageRow}>
              <span>{t("language")}</span>
              <LanguageSelect placement="bottom-start" />
            </div>
          </section>

          <section class={styles.panel}>
            <header class={styles.panelHeader}>
              <Database />
              <h2>{t("storage")}</h2>
            </header>

            <Show when={user()}>
              {(currentUser) => (
                <>
                  <div class={styles.storageBar}>
                    <span style={{ width: `${usedPercent()}%` }} />
                  </div>
                  <p class={styles.storageText}>
                    {formatBytes(currentUser().used_bytes)} / {formatBytes(currentUser().quota_bytes)}
                  </p>
                </>
              )}
            </Show>
          </section>

          <form class={styles.panel} onSubmit={handleChangePassword}>
            <header class={styles.panelHeader}>
              <KeyRound />
              <h2>{t("changePassword")}</h2>
            </header>

            <InputContainer label={t("currentPassword")}>
              <TextInput
                type="password"
                value={currentPassword()}
                onInput={(event) => setCurrentPassword(event.currentTarget.value)}
              />
            </InputContainer>
            <InputContainer label={t("newPassword")}>
              <TextInput
                type="password"
                value={newPassword()}
                onInput={(event) => setNewPassword(event.currentTarget.value)}
              />
            </InputContainer>
            <InputContainer label={t("repeatPassword")}>
              <TextInput
                type="password"
                value={repeatPassword()}
                onInput={(event) => setRepeatPassword(event.currentTarget.value)}
              />
            </InputContainer>

            <Show when={passwordError()}>
              <p class={styles.error}>{passwordError()}</p>
            </Show>
            <Show when={passwordSaved()}>
              <p class={styles.success}>{t("passwordChanged")}</p>
            </Show>

            <footer class={styles.panelActions}>
              <Button type="submit" loading={changePasswordMutation.isPending}>
                {t("savePassword")}
              </Button>
            </footer>
          </form>

          <form class={styles.panel} onSubmit={handleSaveSettings}>
            <header class={styles.panelHeader}>
              <Save />
              <h2>{t("frontendSettings")}</h2>
            </header>

            <label class={styles.textareaLabel}>
              <span>{t("frontendSettings")}</span>
              <textarea
                class={styles.textarea}
                value={settingsJson()}
                spellcheck={false}
                onInput={(event) => {
                  setSettingsJson(event.currentTarget.value);
                  setSettingsSaved(false);
                }}
              />
            </label>

            <Show when={settingsError()}>
              <p class={styles.error}>{settingsError()}</p>
            </Show>
            <Show when={settingsSaved()}>
              <p class={styles.success}>{t("settingsSaved")}</p>
            </Show>

            <footer class={styles.panelActions}>
              <Button type="submit" loading={updateSettingsMutation.isPending}>
                {t("save")}
              </Button>
            </footer>
          </form>
        </div>
      </section>
    </AppLayout>
  );
}

export default SettingsPage;
