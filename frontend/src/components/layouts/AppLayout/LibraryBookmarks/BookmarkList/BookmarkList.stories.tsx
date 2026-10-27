import { createSignal, For } from 'solid-js';
import { I18nProvider } from '@/i18n/I18nProvider';
import BookmarkList from './BookmarkList';
import styles from '../LibraryBookmarks.module.scss';

export default { component: BookmarkList };
export const Default = () => {
  const [items, setItems] = createSignal(['Первая закладка', 'Вторая закладка', 'Третья закладка']);
  return (
    <I18nProvider>
      <div style={{ width: '248px' }}>
        <BookmarkList
          disabled={false}
          onMove={(id, index) => {
            const ordered = items().filter((item) => item !== id);
            ordered.splice(index, 0, id);
            setItems(ordered);
          }}
        >
          <For each={items()}>
            {(item) => (
              <div class={styles.row} data-bookmark-id={item}>
                <button
                  type="button"
                  class={styles.handle}
                  data-bookmark-drag-handle
                  aria-label={`Переместить ${item}`}
                >
                  ↕
                </button>
                <button type="button" class={styles.link}>
                  {item}
                </button>
              </div>
            )}
          </For>
        </BookmarkList>
      </div>
    </I18nProvider>
  );
};
