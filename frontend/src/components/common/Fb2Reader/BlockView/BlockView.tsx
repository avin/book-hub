import { For, Match, Show, Switch } from "solid-js";
import { Fb2Block, Fb2TableCell } from "../fb2Types";
import RenderInlines from "../RenderInlines/RenderInlines";
import styles from "./BlockView.module.scss";

type BlockViewProps = {
  block: Fb2Block;
  imageSrc: (id: string | undefined) => string | undefined;
  onInternalLink: (targetId: string) => void;
};

type TableCellProps = {
  cell: Fb2TableCell;
  imageSrc: (id: string | undefined) => string | undefined;
  onInternalLink: (targetId: string) => void;
};

function TableCell(props: TableCellProps) {
  const content = () => (
    <RenderInlines inlines={props.cell.inlines} imageSrc={props.imageSrc} onInternalLink={props.onInternalLink} />
  );

  return (
    <Show
      when={props.cell.header}
      fallback={
        <td colSpan={props.cell.colspan} rowSpan={props.cell.rowspan}>
          {content()}
        </td>
      }
    >
      <th colSpan={props.cell.colspan} rowSpan={props.cell.rowspan}>
        {content()}
      </th>
    </Show>
  );
}

function BlockView(props: BlockViewProps) {
  return (
    <Switch>
      <Match when={props.block.kind === "title"}>
        <h2 class={styles.title} data-level={props.block.level}>
          <RenderInlines inlines={props.block.inlines} imageSrc={props.imageSrc} onInternalLink={props.onInternalLink} />
        </h2>
      </Match>
      <Match when={props.block.kind === "subtitle"}>
        <h3 class={styles.subtitle}>
          <RenderInlines inlines={props.block.inlines} imageSrc={props.imageSrc} onInternalLink={props.onInternalLink} />
        </h3>
      </Match>
      <Match when={props.block.kind === "paragraph"}>
        <p
          class={styles.paragraph}
          classList={{
            [styles.annotation]: props.block.role === "annotation" || props.block.role === "metadata",
            [styles.quote]: props.block.role === "cite" || props.block.role === "epigraph",
          }}
        >
          <RenderInlines inlines={props.block.inlines} imageSrc={props.imageSrc} onInternalLink={props.onInternalLink} />
        </p>
      </Match>
      <Match when={props.block.kind === "poemLine"}>
        <p class={styles.poemLine}>
          <RenderInlines inlines={props.block.inlines} imageSrc={props.imageSrc} onInternalLink={props.onInternalLink} />
        </p>
      </Match>
      <Match when={props.block.kind === "textAuthor"}>
        <p class={styles.textAuthor}>
          <RenderInlines inlines={props.block.inlines} imageSrc={props.imageSrc} onInternalLink={props.onInternalLink} />
        </p>
      </Match>
      <Match when={props.block.kind === "date"}>
        <p class={styles.date}>
          <RenderInlines inlines={props.block.inlines} imageSrc={props.imageSrc} onInternalLink={props.onInternalLink} />
        </p>
      </Match>
      <Match when={props.block.kind === "emptyLine"}>
        <div class={styles.emptyLine} aria-hidden="true" />
      </Match>
      <Match when={props.block.kind === "image"}>
        <figure class={styles.figure}>
          <Show when={props.imageSrc(props.block.imageId)} fallback={<div class={styles.missingImage}>Нет изображения</div>}>
            {(src) => <img src={src()} alt="" loading="lazy" />}
          </Show>
        </figure>
      </Match>
      <Match when={props.block.kind === "table"}>
        <div class={styles.tableScroller}>
          <table>
            <tbody>
              <For each={props.block.rows ?? []}>
                {(row) => (
                  <tr>
                    <For each={row.cells}>
                      {(cell) => <TableCell cell={cell} imageSrc={props.imageSrc} onInternalLink={props.onInternalLink} />}
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
