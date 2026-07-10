import { X } from 'lucide-solid';
import { type JSX, Show } from 'solid-js';
import Button from '@/components/common/Button/Button';
import styles from './ReaderSidePanel.module.scss';

function ReaderSidePanel(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: JSX.Element;
  footer?: JSX.Element;
}) {
  return (
    <aside
      class={styles.readerSidePanel}
      classList={{ [styles.panelOpen]: props.open }}
      aria-hidden={props.open ? undefined : true}
    >
      <div class={styles.panelHeader}>
        <h2>{props.title}</h2>
        <Button
          variant="secondary"
          type="button"
          iconOnly
          iconStart={<X />}
          title="Закрыть"
          aria-label="Закрыть"
          onClick={props.onClose}
        />
      </div>

      <div class={styles.panelBody}>{props.children}</div>

      <Show when={props.footer}>
        {(footer) => <div class={styles.panelFooter}>{footer()}</div>}
      </Show>
    </aside>
  );
}

export default ReaderSidePanel;
