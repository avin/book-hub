import ReaderSidePanel from '@/components/common/ReaderSidePanel/ReaderSidePanel';
import TocList, { type TocEntry } from './TocList/TocList';

function TocPanel(props: {
  open: boolean;
  entries: TocEntry[];
  onClose: () => void;
  onSelect: (entry: TocEntry, path: number[]) => void;
}) {
  return (
    <ReaderSidePanel open={props.open} title="Оглавление" onClose={props.onClose}>
      <TocList entries={props.entries} onSelect={props.onSelect} />
    </ReaderSidePanel>
  );
}

export default TocPanel;
