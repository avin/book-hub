import { RotateCcw, SlidersHorizontal } from 'lucide-solid';
import Button from '@/components/common/Button/Button';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './ReaderPanelActions.module.scss';

function ReaderPanelActions(props: { onReset: () => void; onAutoWidth: () => void }) {
  const { t } = useI18n();

  return (
    <div class={styles.panelActions}>
      <Button
        fullWidth
        variant="secondary"
        type="button"
        iconStart={<RotateCcw />}
        onClick={props.onReset}
      >
        {t('reset')}
      </Button>
      <Button
        fullWidth
        variant="secondary"
        type="button"
        iconStart={<SlidersHorizontal />}
        onClick={props.onAutoWidth}
      >
        {t('autoWidth')}
      </Button>
    </div>
  );
}

export default ReaderPanelActions;
