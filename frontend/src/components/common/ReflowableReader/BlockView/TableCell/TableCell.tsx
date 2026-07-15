import { Show } from 'solid-js';
import type { ReflowableSearchRange } from '../../reflowableSearch';
import type { ReflowableTableCell } from '../../reflowableTypes';
import { readerTextStyle } from '../../readerTextStyle';
import RenderInlines from '../../RenderInlines/RenderInlines';

function TableCell(props: {
  cell: ReflowableTableCell;
  imageSrc: (id: string | undefined) => string | undefined;
  onInternalLink: (targetId: string) => void;
  onFootnoteLink: (targetId: string) => void;
  isFootnoteTarget: (targetId: string) => boolean;
  searchRanges?: ReflowableSearchRange[];
  textOffset?: number;
}) {
  const alignmentStyle = () => ({
    ...(readerTextStyle(props.cell.textStyle) ?? {}),
    ...(props.cell.align ? { 'text-align': props.cell.align } : {}),
  });
  const content = () => (
    <RenderInlines
      inlines={props.cell.inlines}
      imageSrc={props.imageSrc}
      onInternalLink={props.onInternalLink}
      onFootnoteLink={props.onFootnoteLink}
      isFootnoteTarget={props.isFootnoteTarget}
      searchRanges={props.searchRanges}
      textOffset={props.textOffset}
    />
  );

  return (
    <Show
      when={props.cell.header}
      fallback={
        <td colSpan={props.cell.colspan} rowSpan={props.cell.rowspan} style={alignmentStyle()}>
          {content()}
        </td>
      }
    >
      <th colSpan={props.cell.colspan} rowSpan={props.cell.rowspan} style={alignmentStyle()}>
        {content()}
      </th>
    </Show>
  );
}

export default TableCell;
