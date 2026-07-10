import { Show } from 'solid-js';
import type { Fb2SearchRange } from '../../fb2Search';
import type { Fb2TableCell } from '../../fb2Types';
import RenderInlines from '../../RenderInlines/RenderInlines';

function TableCell(props: {
  cell: Fb2TableCell;
  imageSrc: (id: string | undefined) => string | undefined;
  onInternalLink: (targetId: string) => void;
  onFootnoteLink: (targetId: string) => void;
  isFootnoteTarget: (targetId: string) => boolean;
  searchRanges?: Fb2SearchRange[];
  textOffset?: number;
}) {
  const alignmentStyle = () => (props.cell.align ? { 'text-align': props.cell.align } : undefined);
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
