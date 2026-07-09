import { FileText } from "lucide-solid";
import { createEffect, createSignal, Show, type JSX } from "solid-js";
import { type Book, getBookCoverUrl } from "@/api/books";
import styles from "./BookCover.module.scss";

function BookCover(props: {
  bookId: string;
  format: Book["format"];
  // Cache-buster: bumped whenever the cover actually changes (book.updated_at).
  // Prevents the browser/img cache from serving a stale cover after upload/delete.
  version?: string;
  // Optional override for the no-cover fallback. Defaults to a file icon + format.
  fallback?: JSX.Element;
}) {
  const [failed, setFailed] = createSignal(false);

  createEffect(() => {
    props.bookId;
    props.version;
    setFailed(false);
  });

  const src = () => {
    const base = getBookCoverUrl(props.bookId, "thumbnail");
    return props.version ? `${base}&v=${encodeURIComponent(props.version)}` : base;
  };

  return (
    <div class={styles.cover}>
      <Show
        when={!failed()}
        fallback={
          props.fallback ?? (
            <div class={styles.coverFallback}>
              <FileText />
              <span>{props.format.toUpperCase()}</span>
            </div>
          )
        }
      >
        <img
          src={src()}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </Show>
    </div>
  );
}

export default BookCover;
