import { A, useNavigate } from "@solidjs/router";
import { createMemo, createSignal, Show } from "solid-js";
import { ArrowLeft, FileUp, Heart, Upload } from "lucide-solid";
import { createUploadBookMutation } from "@/api/books";
import Button from "@/components/common/Button/Button";
import InputContainer from "@/components/common/InputContainer/InputContainer";
import TagsSelect from "@/components/common/TagsSelect/TagsSelect";
import TextInput from "@/components/common/TextInput/TextInput";
import AppLayout from "@/components/layouts/AppLayout/AppLayout";
import { useI18n } from "@/i18n/I18nProvider";
import styles from "./UploadPage.module.scss";

function titleFromFile(file: File | undefined) {
  if (!file) {
    return "";
  }

  return file.name.replace(/\.[^.]+$/, "");
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

function UploadPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [file, setFile] = createSignal<File>();
  const [title, setTitle] = createSignal("");
  const [tags, setTags] = createSignal<string[]>([]);
  const [favorite, setFavorite] = createSignal(false);
  const [dragActive, setDragActive] = createSignal(false);
  const [error, setError] = createSignal("");
  const uploadMutation = createUploadBookMutation();
  let fileInputEl: HTMLInputElement | undefined;

  const selectedFileName = createMemo(() => file()?.name ?? t("fileNotSelected"));
  const canSubmit = createMemo(() => Boolean(file()) && !uploadMutation.isPending);

  const applyFile = (nextFile: File | undefined) => {
    if (!nextFile) {
      return;
    }

    setFile(nextFile);
    if (!title().trim()) {
      setTitle(titleFromFile(nextFile));
    }
    setError("");
  };

  const handleSubmit = (event: Event) => {
    event.preventDefault();
    const currentFile = file();

    if (!currentFile) {
      setError(t("selectBookFile"));
      return;
    }

    uploadMutation.mutate(
      {
        file: currentFile,
        title: title().trim(),
        tags: tags(),
        favorite: favorite(),
      },
      {
        onSuccess: (book) => {
          navigate(`/reader/${book.id}`);
        },
        onError: (nextError) => setError(errorMessage(nextError, t("requestFailedTryAgain"))),
      },
    );
  };

  return (
    <AppLayout>
      <section class={styles.uploadPage}>
        <header class={styles.header}>
          <div>
            <p class={styles.kicker}>{t("upload")}</p>
            <h1>{t("addBook")}</h1>
          </div>
          <A href="/library" class={styles.backLink}>
            <ArrowLeft />
            {t("library")}
          </A>
        </header>

        <form class={styles.form} onSubmit={handleSubmit}>
          <button
            type="button"
            class={styles.dropzone}
            classList={{ [styles.dragActive]: dragActive() }}
            onClick={() => fileInputEl?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              applyFile(event.dataTransfer.files[0]);
            }}
          >
            <FileUp />
            <span>{selectedFileName()}</span>
            <small>{t("supportedBookFormats")}</small>
          </button>

          <input
            ref={fileInputEl}
            class={styles.fileInput}
            type="file"
            accept=".fb2,.pdf,application/pdf,application/xml,text/xml"
            onChange={(event) => applyFile(event.currentTarget.files?.[0])}
          />

          <div class={styles.fields}>
            <InputContainer label={t("title")} filled={Boolean(title())}>
              <TextInput value={title()} onInput={(event) => setTitle(event.currentTarget.value)} />
            </InputContainer>

            <InputContainer label={t("tags")} filled={tags().length > 0}>
              <TagsSelect value={tags()} onChange={setTags} />
            </InputContainer>

            <label class={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={favorite()}
                onChange={(event) => setFavorite(event.currentTarget.checked)}
              />
              <Heart />
              <span>{t("favorite")}</span>
            </label>
          </div>

          <Show when={error()}>
            <p class={styles.error}>{error()}</p>
          </Show>

          <footer class={styles.actions}>
            <Button type="submit" loading={uploadMutation.isPending} disabled={!canSubmit()} iconStart={<Upload />}>
              {t("uploadBook")}
            </Button>
          </footer>
        </form>
      </section>
    </AppLayout>
  );
}

export default UploadPage;
