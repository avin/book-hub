import { A } from "@solidjs/router";
import { Edit3, Heart, MoreVertical, Trash2 } from "lucide-solid";
import { type Accessor, createMemo, createSignal, Show } from "solid-js";
import { type Book } from "@/api/books";
import Dropdown from "@/components/common/Dropdown/Dropdown";
import Menu, { type MenuItem } from "@/components/common/Menu/Menu";
import { useI18n } from "@/i18n/I18nProvider";
import BookCover from "../BookCover/BookCover";
import styles from "./BookCardGrid.module.scss";

function BookCardGrid(props: {
  book: Accessor<Book>;
  onFavoriteToggle: (book: Book) => void;
  onEdit: (book: Book) => void;
  onDelete: (book: Book) => void;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = createSignal(false);
  const bookId = createMemo(() => props.book().id);
  const title = createMemo(() => props.book().title);
  const format = createMemo(() => props.book().format);
  const favorite = createMemo(() => props.book().favorite);
  const progressPercent = createMemo(() => props.book().progress_percent);

  const menuItems = (): MenuItem[] => [
    {
      id: "favorite",
      label: favorite() ? t("removeFromFavorites") : t("addToFavorites"),
      iconStart: <Heart />,
      onClick: () => props.onFavoriteToggle(props.book()),
    },
    {
      id: "edit",
      label: t("edit"),
      iconStart: <Edit3 />,
      onClick: () => props.onEdit(props.book()),
    },
    { type: "separator" },
    {
      id: "delete",
      label: t("delete"),
      iconStart: <Trash2 />,
      onClick: () => props.onDelete(props.book()),
    },
  ];

  return (
    <article class={styles.gridCard}>
      <A class={styles.coverLink} href={`/reader/${bookId()}`}>
        <BookCover
          bookId={bookId()}
          format={format()}
          version={props.book().updated_at}
          fallback={
            <div class={styles.titleFallback}>
              <span>{title()}</span>
            </div>
          }
        />
        <Show when={favorite()}>
          <span class={styles.favoriteBadge} aria-label={t("favorites")} title={t("favorites")}>
            <Heart />
          </span>
        </Show>
      </A>

      <Dropdown
        open={menuOpen()}
        onOpenChange={setMenuOpen}
        placement="bottom-end"
        minWidth={200}
        trigger={
          <button
            type="button"
            class={styles.menuTrigger}
            aria-label={t("bookActions")}
            aria-haspopup="menu"
            aria-expanded={menuOpen()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMenuOpen(!menuOpen());
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setMenuOpen(true);
              }
            }}
          >
            <MoreVertical />
          </button>
        }
      >
        <Menu items={menuItems()} />
      </Dropdown>

      <div class={styles.progress}>
        <span style={{ width: `${progressPercent()}%` }} />
      </div>
    </article>
  );
}

export default BookCardGrid;
