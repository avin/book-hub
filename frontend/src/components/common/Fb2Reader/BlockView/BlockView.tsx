import { For, Match, Show, Switch } from 'solid-js';
import { inlinesText, type Fb2SearchRange } from '../fb2Search';
import type { Fb2Block } from '../fb2Types';
import RenderInlines from '../RenderInlines/RenderInlines';
import TableCell from './TableCell/TableCell';
import styles from './BlockView.module.scss';

function BlockView(props: {
  block: Fb2Block;
  imageSrc: (id: string | undefined) => string | undefined;
  onInternalLink: (targetId: string) => void;
  onFootnoteLink: (targetId: string) => void;
  isFootnoteTarget: (targetId: string) => boolean;
  searchRanges?: Fb2SearchRange[];
}) {
  const tableCellTextOffset = (rowIndex: number, cellIndex: number) => {
    const rows = props.block.rows ?? [];
    let offset = 0;

    for (let currentRowIndex = 0; currentRowIndex < rowIndex; currentRowIndex += 1) {
      offset +=
        rows[currentRowIndex]?.cells.reduce(
          (rowLength, cell) => rowLength + inlinesText(cell.inlines).length,
          0,
        ) ?? 0;
    }

    return (
      offset +
      (rows[rowIndex]?.cells
        .slice(0, cellIndex)
        .reduce((rowLength, cell) => rowLength + inlinesText(cell.inlines).length, 0) ?? 0)
    );
  };

  return (
    <Switch>
      <Match when={props.block.kind === 'title'}>
        <h2 class={styles.title} data-level={props.block.level}>
          <RenderInlines
            inlines={props.block.inlines}
            imageSrc={props.imageSrc}
            onInternalLink={props.onInternalLink}
            onFootnoteLink={props.onFootnoteLink}
            isFootnoteTarget={props.isFootnoteTarget}
            searchRanges={props.searchRanges}
          />
        </h2>
      </Match>
      <Match when={props.block.kind === 'subtitle'}>
        <h3 class={styles.subtitle}>
          <RenderInlines
            inlines={props.block.inlines}
            imageSrc={props.imageSrc}
            onInternalLink={props.onInternalLink}
            onFootnoteLink={props.onFootnoteLink}
            isFootnoteTarget={props.isFootnoteTarget}
            searchRanges={props.searchRanges}
          />
        </h3>
      </Match>
      <Match when={props.block.kind === 'paragraph'}>
        <p
          class={styles.paragraph}
          classList={{
            [styles.annotation]:
              props.block.role === 'annotation' || props.block.role === 'metadata',
            [styles.quote]: props.block.role === 'cite' || props.block.role === 'epigraph',
          }}
        >
          <RenderInlines
            inlines={props.block.inlines}
            imageSrc={props.imageSrc}
            onInternalLink={props.onInternalLink}
            onFootnoteLink={props.onFootnoteLink}
            isFootnoteTarget={props.isFootnoteTarget}
            searchRanges={props.searchRanges}
          />
        </p>
      </Match>
      <Match when={props.block.kind === 'listItem'}>
        <p
          class={styles.listItem}
          classList={{
            [styles.annotation]:
              props.block.role === 'annotation' || props.block.role === 'metadata',
            [styles.quote]: props.block.role === 'cite' || props.block.role === 'epigraph',
          }}
        >
          <RenderInlines
            inlines={props.block.inlines}
            imageSrc={props.imageSrc}
            onInternalLink={props.onInternalLink}
            onFootnoteLink={props.onFootnoteLink}
            isFootnoteTarget={props.isFootnoteTarget}
            searchRanges={props.searchRanges}
          />
        </p>
      </Match>
      <Match when={props.block.kind === 'codeBlock'}>
        <pre class={styles.codeBlock}>
          <code class={styles.codeBlockContent}>
            <RenderInlines
              inlines={props.block.inlines}
              imageSrc={props.imageSrc}
              onInternalLink={props.onInternalLink}
              onFootnoteLink={props.onFootnoteLink}
              isFootnoteTarget={props.isFootnoteTarget}
              searchRanges={props.searchRanges}
            />
          </code>
        </pre>
      </Match>
      <Match when={props.block.kind === 'divider'}>
        <div class={styles.divider} aria-hidden="true">
          <span>
            <RenderInlines
              inlines={props.block.inlines}
              imageSrc={props.imageSrc}
              onInternalLink={props.onInternalLink}
              onFootnoteLink={props.onFootnoteLink}
              isFootnoteTarget={props.isFootnoteTarget}
              searchRanges={props.searchRanges}
            />
          </span>
        </div>
      </Match>
      <Match when={props.block.kind === 'poemLine'}>
        <p class={styles.poemLine}>
          <RenderInlines
            inlines={props.block.inlines}
            imageSrc={props.imageSrc}
            onInternalLink={props.onInternalLink}
            onFootnoteLink={props.onFootnoteLink}
            isFootnoteTarget={props.isFootnoteTarget}
            searchRanges={props.searchRanges}
          />
        </p>
      </Match>
      <Match when={props.block.kind === 'textAuthor'}>
        <p class={styles.textAuthor}>
          <RenderInlines
            inlines={props.block.inlines}
            imageSrc={props.imageSrc}
            onInternalLink={props.onInternalLink}
            onFootnoteLink={props.onFootnoteLink}
            isFootnoteTarget={props.isFootnoteTarget}
            searchRanges={props.searchRanges}
          />
        </p>
      </Match>
      <Match when={props.block.kind === 'date'}>
        <p class={styles.date}>
          <RenderInlines
            inlines={props.block.inlines}
            imageSrc={props.imageSrc}
            onInternalLink={props.onInternalLink}
            onFootnoteLink={props.onFootnoteLink}
            isFootnoteTarget={props.isFootnoteTarget}
            searchRanges={props.searchRanges}
          />
        </p>
      </Match>
      <Match when={props.block.kind === 'emptyLine'}>
        <div class={styles.emptyLine} aria-hidden="true" />
      </Match>
      <Match when={props.block.kind === 'image'}>
        <figure class={styles.figure}>
          <Show
            when={props.imageSrc(props.block.imageId)}
            fallback={<div class={styles.missingImage}>Нет изображения</div>}
          >
            {(src) => <img src={src()} alt="" loading="lazy" />}
          </Show>
        </figure>
      </Match>
      <Match when={props.block.kind === 'table'}>
        <div class={styles.tableScroller}>
          <table>
            <tbody>
              <For each={props.block.rows ?? []}>
                {(row, rowIndex) => (
                  <tr>
                    <For each={row.cells}>
                      {(cell, cellIndex) => (
                        <TableCell
                          cell={cell}
                          imageSrc={props.imageSrc}
                          onInternalLink={props.onInternalLink}
                          onFootnoteLink={props.onFootnoteLink}
                          isFootnoteTarget={props.isFootnoteTarget}
                          searchRanges={props.searchRanges}
                          textOffset={tableCellTextOffset(rowIndex(), cellIndex())}
                        />
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Match>
    </Switch>
  );
}

export default BlockView;
