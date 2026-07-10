import { For, Show } from 'solid-js';
import styles from './TocList.module.scss';

export type TocEntry = {
  label: string;
  children?: TocEntry[];
};

function TocList(props: {
  entries: TocEntry[];
  depth?: number;
  onSelect: (entry: TocEntry, path: number[]) => void;
  pathPrefix?: number[];
}) {
  const depth = () => props.depth ?? 0;
  const pathPrefix = () => props.pathPrefix ?? [];

  return (
    <ul class={styles.tocList} role="list">
      <For each={props.entries}>
        {(entry, index) => {
          const path = () => [...pathPrefix(), index()];

          return (
            <li class={styles.tocItem} role="listitem">
              <button
                type="button"
                class={styles.tocButton}
                style={{ 'padding-left': `${12 + depth() * 16}px` }}
                onClick={() => props.onSelect(entry, path())}
              >
                {entry.label}
              </button>
              <Show when={entry.children?.length}>
                <TocList
                  entries={entry.children!}
                  depth={depth() + 1}
                  pathPrefix={path()}
                  onSelect={props.onSelect}
                />
              </Show>
            </li>
          );
        }}
      </For>
    </ul>
  );
}

export default TocList;
