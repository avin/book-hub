import ReaderSidePanel from '@/components/common/ReaderSidePanel/ReaderSidePanel';
import { useI18n } from '@/i18n/I18nProvider';
import TocList, { type TocEntry } from './TocList/TocList';

function TocPanel(props: {
  open: boolean;
  entries: TocEntry[];
  onClose: () => void;
  onSelect: (entry: TocEntry, path: number[]) => void;
}) {
  const { t } = useI18n();

  return (
    <ReaderSidePanel open={props.open} title={t('tableOfContents')} onClose={props.onClose}>
      <TocList entries={props.entries} onSelect={props.onSelect} />
    </ReaderSidePanel>
  );
}

export default TocPanel;
