import { Check, ChevronDown, Languages } from "lucide-solid";
import { createMemo, createSignal } from "solid-js";
import Dropdown from "@/components/common/Dropdown/Dropdown";
import Menu, { MenuItem } from "@/components/common/Menu/Menu";
import { useI18n } from "@/i18n/I18nProvider";
import { Language } from "@/i18n/messages";
import styles from "./LanguageSelect.module.scss";

const languageOptions: { value: Language; label: string }[] = [
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
];

function LanguageSelect() {
  const { language, setLanguage, t } = useI18n();
  const [open, setOpen] = createSignal(false);

  const selectedLanguage = createMemo(
    () => languageOptions.find((option) => option.value === language()) ?? languageOptions[0],
  );

  const items = createMemo<MenuItem<Language>[]>(() =>
    languageOptions.map((option) => ({
      id: option.value,
      label: option.label,
      selected: option.value === language(),
      iconEnd: option.value === language() ? <Check /> : undefined,
      onClick: () => {
        setLanguage(option.value);
        setOpen(false);
      },
    })),
  );

  return (
    <Dropdown
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-end"
      minWidth={180}
      fitReferenceToContent
      trigger={
        <button
          type="button"
          class={styles.trigger}
          aria-label={t("language")}
          aria-haspopup="menu"
          aria-expanded={open()}
          onClick={() => setOpen(!open())}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          <span class={styles.icon} aria-hidden="true">
            <Languages />
          </span>
          <span class={styles.label}>{selectedLanguage().label}</span>
          <span class={styles.chevron} classList={{ [styles.open]: open() }} aria-hidden="true">
            <ChevronDown />
          </span>
        </button>
      }
    >
      <Menu items={items()} />
    </Dropdown>
  );
}

export default LanguageSelect;
