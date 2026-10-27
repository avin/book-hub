import Sortable from 'sortablejs';
import { createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './BookmarkList.module.scss';

function BookmarkList(props: {
  children: JSX.Element;
  disabled: boolean;
  onMove: (id: string, targetIndex: number) => void;
}) {
  const { t } = useI18n();
  const [sorting, setSorting] = createSignal(false);
  let element!: HTMLDivElement;
  let sortable: Sortable | undefined;
  createEffect(() => {
    const disabled = props.disabled;
    sortable?.option('disabled', disabled);
  });
  onMount(() => {
    sortable = Sortable.create(element, {
      disabled: props.disabled,
      animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      handle: '[data-bookmark-drag-handle]',
      draggable: '[data-bookmark-id]',
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: 4,
      ghostClass: styles.placeholder,
      fallbackClass: styles.dragging,
      onStart: () => setSorting(true),
      onEnd: ({ item, from, oldIndex, newIndex }) => {
        setSorting(false);
        const id = item.getAttribute('data-bookmark-id');
        if (!id || oldIndex === undefined || newIndex === undefined || oldIndex === newIndex)
          return;
        // Restore the DOM expected by Solid before its keyed list applies the new order.
        from.removeChild(item);
        from.insertBefore(item, from.children[oldIndex] ?? null);
        props.onMove(id, newIndex);
      },
    });
    onCleanup(() => sortable?.destroy());
  });
  return (
    <div
      ref={element}
      class={styles.list}
      classList={{ [styles.sorting]: sorting() }}
      aria-label={t('bookmarks')}
    >
      {props.children}
    </div>
  );
}

export default BookmarkList;
