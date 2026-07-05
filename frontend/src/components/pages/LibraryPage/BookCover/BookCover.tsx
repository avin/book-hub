import { FileText } from "lucide-solid";
import { createEffect, createSignal, Show } from "solid-js";
import { type Book, getBookCoverUrl } from "@/api/books";
import styles from "./BookCover.module.scss";

function BookCover(props: {
  book: Book;
}) {
  const [failed, setFailed] = createSignal(false);

  createEffect(() => {
    props.book.id;
    setFailed(false);
  });

  return (
    <div class={styles.cover}>
      <Show
        when={!failed()}
        fallback={
          <div class={styles.coverFallback}>
            <FileText />
            <span>{props.book.format.toUpperCase()}</span>
          </div>
        }
      >
        <img
          src={getBookCoverUrl(props.book.id)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </Show>
    </div>
  );
}

export default BookCover;
