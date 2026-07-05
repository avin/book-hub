import { A } from "@solidjs/router";
import { Edit3, Heart, Trash2 } from "lucide-solid";
import { type Accessor, createMemo, For, Show } from "solid-js";
import type { Book } from "@/api/books";
import Button from "@/components/common/Button/Button";
import { useI18n } from "@/i18n/I18nProvider";
import BookCover from "../BookCover/BookCover";
import styles from "./BookCard.module.scss";

function areTagsEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

function BookCard(props: {
  book: Accessor<Book>;
  onFavoriteToggle: (book: Book) => void;
  onEdit: (book: Book) => void;
  onDelete: (book: Book) => void;
}) {
  const { t } = useI18n();
  const bookId = createMemo(() => props.book().id);
  const title = createMemo(() => props.book().title);
  const favorite = createMemo(() => props.book().favorite);
  const format = createMemo(() => props.book().format);
  const progressPercent = createMemo(() => props.book().progress_percent);
  const tags = createMemo<Book["tags"]>(
    (previousTags) => {
      const nextTags = props.book().tags;

      return areTagsEqual(previousTags, nextTags) ? previousTags : nextTags;
    },
    [],
  );

  return (
    <article class={styles.bookCard}>
      <A class={styles.coverLink} href={`/reader/${bookId()}`}>
        <BookCover bookId={bookId()} format={format()} />
      </A>
      <div class={styles.bookContent}>
        <div class={styles.bookTitleRow}>
          <h2>
            <A href={`/reader/${bookId()}`}>{title()}</A>
          </h2>
          <div class={styles.bookActions}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={favorite() ? t("removeFromFavorites") : t("addToFavorites")}
              aria-pressed={favorite()}
              iconStart={<Heart />}
              classList={{ [styles.favoriteActive]: favorite() }}
              onClick={() => props.onFavoriteToggle(props.book())}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={t("edit")}
              iconStart={<Edit3 />}
              onClick={() => props.onEdit(props.book())}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={t("delete")}
              iconStart={<Trash2 />}
              onClick={() => props.onDelete(props.book())}
            />
          </div>
        </div>

        <div class={styles.progress}>
          <span style={{ width: `${progressPercent()}%` }} />
        </div>

        <Show when={tags().length > 0}>
          <div class={styles.cardTags}>
            <For each={tags()}>{(tag) => <span>{tag}</span>}</For>
          </div>
        </Show>
      </div>
    </article>
  );
}

export default BookCard;
