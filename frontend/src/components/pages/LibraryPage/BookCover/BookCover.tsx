import { FileText } from "lucide-solid";
import { createEffect, createSignal, Show } from "solid-js";
import { type Book, getBookCoverUrl } from "@/api/books";
import styles from "./BookCover.module.scss";

function BookCover(props: {
  bookId: string;
  format: Book["format"];
}) {
  const [failed, setFailed] = createSignal(false);

  createEffect(() => {
    props.bookId;
    setFailed(false);
  });

  return (
    <div class={styles.cover}>
      <Show
        when={!failed()}
        fallback={
          <div class={styles.coverFallback}>
            <FileText />
            <span>{props.format.toUpperCase()}</span>
          </div>
        }
      >
        <img
          src={getBookCoverUrl(props.bookId, "thumbnail")}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </Show>
    </div>
  );
}

export default BookCover;
