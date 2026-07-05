import { A } from "@solidjs/router";
import { Edit3, Heart, Trash2 } from "lucide-solid";
import { For, Show } from "solid-js";
import type { Book } from "@/api/books";
import Button from "@/components/common/Button/Button";
import { useI18n } from "@/i18n/I18nProvider";
import BookCover from "../BookCover/BookCover";
import styles from "./BookCard.module.scss";

function BookCard(props: {
  book: Book;
  onFavoriteToggle: (book: Book) => void;
  onEdit: (book: Book) => void;
  onDelete: (book: Book) => void;
}) {
  const { t } = useI18n();

  return (
    <article class={styles.bookCard}>
      <A class={styles.coverLink} href={`/reader/${props.book.id}`}>
        <BookCover book={props.book} />
      </A>
      <div class={styles.bookContent}>
        <div class={styles.bookTitleRow}>
          <h2>
            <A href={`/reader/${props.book.id}`}>{props.book.title}</A>
          </h2>
          <div class={styles.bookActions}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={props.book.favorite ? t("removeFromFavorites") : t("addToFavorites")}
              iconStart={<Heart />}
              classList={{ [styles.favoriteActive]: props.book.favorite }}
              onClick={() => props.onFavoriteToggle(props.book)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={t("edit")}
              iconStart={<Edit3 />}
              onClick={() => props.onEdit(props.book)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={t("delete")}
              iconStart={<Trash2 />}
              onClick={() => props.onDelete(props.book)}
            />
          </div>
        </div>

        <div class={styles.progress}>
          <span style={{ width: `${props.book.progress_percent}%` }} />
        </div>

        <Show when={props.book.tags.length > 0}>
          <div class={styles.cardTags}>
            <For each={props.book.tags}>{(tag) => <span>{tag}</span>}</For>
          </div>
        </Show>
      </div>
    </article>
  );
}

export default BookCard;
