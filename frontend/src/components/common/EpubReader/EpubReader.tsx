import { createEffect, createSignal, onCleanup, Show, type JSX } from 'solid-js';
import ReflowableReader from '@/components/common/ReflowableReader/ReflowableReader';
import LoadingScreen from '@/components/common/LoadingScreen/LoadingScreen';
import { useI18n } from '@/i18n/I18nProvider';
import { parseEpub } from './epubParser';
import type { EpubDocument } from './epubTypes';

function EpubReader(props: {
  epub: Blob;
  historyId?: string;
  class?: string;
  headerContent?: JSX.Element;
  onReady?: () => void;
}) {
  const { t } = useI18n();
  const [document, setDocument] = createSignal<EpubDocument>();
  const [error, setError] = createSignal<unknown>();
  let readyFor: Blob | undefined;

  createEffect(() => {
    const epub = props.epub;
    let disposed = false;

    setDocument(undefined);
    setError(undefined);
    void parseEpub(epub).then(
      (nextDocument) => {
        if (!disposed) setDocument(nextDocument);
      },
      (nextError) => {
        if (!disposed) setError(nextError);
      },
    );

    onCleanup(() => {
      disposed = true;
    });
  });

  createEffect(() => {
    if (!document() || readyFor === props.epub) return;

    readyFor = props.epub;
    props.onReady?.();
  });

  return (
    <Show
      when={document()}
      fallback={
        <Show when={error()} fallback={<LoadingScreen label={t('loading')} />}>
          <div role="alert">{t('epubCouldNotBeOpened')}</div>
        </Show>
      }
    >
      {(parsed) => (
        <ReflowableReader
          document={parsed()}
          historyId={props.historyId}
          class={props.class}
          headerContent={props.headerContent}
        />
      )}
    </Show>
  );
}

export default EpubReader;
