import { type JSX, createMemo, createSignal } from "solid-js";
import { ArrowUpDown, Check, Heart } from "lucide-solid";
import type { BookSort } from "@/api/books";
import Button from "@/components/common/Button/Button";
import Dropdown from "@/components/common/Dropdown/Dropdown";
import Menu, { type MenuItem } from "@/components/common/Menu/Menu";
import { useI18n } from "@/i18n/I18nProvider";
import styles from "./LibraryFiltersDropdown.module.scss";

const sortOptions: {
  value: BookSort;
  labelKey: "relevanceSort" | "titleAZ" | "titleZA";
}[] = [
  { value: "relevance", labelKey: "relevanceSort" },
  { value: "title_asc", labelKey: "titleAZ" },
  { value: "title_desc", labelKey: "titleZA" },
];

function FavoriteIcon(props: { filled?: boolean }) {
  return (
    <Heart
      class={styles.heart}
      classList={{ [styles.filledHeart]: props.filled }}
      fill={props.filled ? "currentColor" : "none"}
    />
  );
}

function LibraryFiltersDropdown(props: {
  sort: BookSort;
  favoriteFilter: "all" | "favorite" | "regular";
  onSortChange: (sort: BookSort) => void;
  onFavoriteFilterChange: (favoriteFilter: "all" | "favorite" | "regular") => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = createSignal(false);

  const items = createMemo<MenuItem<BookSort>[]>(() =>
    sortOptions.map((option) => ({
      id: option.value,
      label: t(option.labelKey),
      selected: option.value === props.sort,
      iconEnd: option.value === props.sort ? <Check /> : undefined,
      onClick: () => {
        props.onSortChange(option.value);
        setOpen(false);
      },
    })),
  );

  const favoriteOptions = createMemo<
    {
      value: "all" | "favorite" | "regular";
      label: string;
      icon: JSX.Element;
    }[]
  >(() => [
    {
      value: "all",
      label: t("all"),
      icon: (
        <>
          <FavoriteIcon />
          <FavoriteIcon filled />
        </>
      ),
    },
    {
      value: "favorite",
      label: t("favorites"),
      icon: <FavoriteIcon filled />,
    },
    {
      value: "regular",
      label: t("other"),
      icon: <FavoriteIcon />,
    },
  ]);

  return (
    <Dropdown
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-end"
      minWidth={220}
      fitReferenceToContent
      trigger={
        <Button
          type="button"
          variant="secondary"
          iconOnly
          iconStart={<ArrowUpDown />}
          class={styles.trigger}
          classList={{ [styles.activeTrigger]: props.favoriteFilter !== "all" }}
          aria-label={t("sort")}
          aria-haspopup="menu"
          aria-expanded={open()}
          title={t("sort")}
          onClick={() => setOpen(!open())}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
            }
          }}
        />
      }
    >
      <div class={styles.content}>
        <div class={styles.favoriteGroup} role="group" aria-label={t("favoritesFilter")}>
          {favoriteOptions().map((option) => (
            <button
              type="button"
              class={styles.favoriteButton}
              classList={{ [styles.activeFavoriteButton]: props.favoriteFilter === option.value }}
              aria-label={option.label}
              aria-pressed={props.favoriteFilter === option.value}
              title={option.label}
              onClick={() => props.onFavoriteFilterChange(option.value)}
            >
              {option.icon}
            </button>
          ))}
        </div>
        <Menu items={items()} />
      </div>
    </Dropdown>
  );
}

export default LibraryFiltersDropdown;
