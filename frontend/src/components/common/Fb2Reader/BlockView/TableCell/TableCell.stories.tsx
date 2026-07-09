import type { Fb2TableCell } from '../../fb2Types';
import TableCell from './TableCell';

export default { component: TableCell };

const cell: Fb2TableCell = {
  header: false,
  colspan: 1,
  rowspan: 1,
  inlines: [{ kind: 'text', text: 'Table cell content' }],
};

export const Default = () => (
  <table>
    <tbody>
      <tr>
        <TableCell
          cell={cell}
          imageSrc={() => undefined}
          onInternalLink={() => undefined}
          onFootnoteLink={() => undefined}
          isFootnoteTarget={() => false}
        />
      </tr>
    </tbody>
  </table>
);
