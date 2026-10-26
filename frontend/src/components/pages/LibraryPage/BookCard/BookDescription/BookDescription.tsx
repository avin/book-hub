import { Ellipsis } from 'lucide-solid';
import { createEffect, createSignal, onCleanup, onMount, Show, untrack } from 'solid-js';
import Button from '@/components/common/Button/Button';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './BookDescription.module.scss';

function BookDescription(props: { text: string }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = createSignal(false);
  const [preview, setPreview] = createSignal<string | null>(null);
  let container!: HTMLDivElement;
  let measurement!: HTMLParagraphElement;
  let measurementText!: HTMLSpanElement;
  let measurementButton!: HTMLButtonElement;

  const measure = () => {
    if (container.clientWidth === 0) return;

    const text = props.text;
    const maxHeight = Number.parseFloat(getComputedStyle(measurement).lineHeight) * 2;
    measurementText.textContent = text;
    measurementButton.style.display = 'none';
    if (measurement.getBoundingClientRect().height <= maxHeight + 0.5) {
      setPreview(null);
      return;
    }

    measurementButton.style.display = 'inline-flex';
    const characters = Array.from(text);
    let low = 0;
    let high = characters.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      measurementText.textContent = `${characters.slice(0, middle).join('').trimEnd()} `;
      if (measurement.getBoundingClientRect().height <= maxHeight + 0.5) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    setPreview(`${characters.slice(0, low).join('').trimEnd()} `);
  };

  createEffect(() => {
    void props.text;
    void t('expand');
    setExpanded(false);
    measure();
  });

  onMount(() => {
    const observer = new ResizeObserver(() => untrack(measure));
    observer.observe(container);
    let disposed = false;
    void document.fonts.ready.then(() => {
      if (!disposed) untrack(measure);
    });
    onCleanup(() => {
      disposed = true;
      observer.disconnect();
    });
  });

  return (
    <div ref={container} class={styles.bookDescription}>
      <p class={styles.text}>
        {expanded() || preview() === null ? props.text : preview()}
        <Show when={!expanded() && preview() !== null}>
          <Button
            type="button"
            variant="ghost"
            iconOnly
            iconStart={<Ellipsis />}
            class={styles.expand}
            aria-label={t('expand')}
            aria-expanded={false}
            onClick={() => setExpanded(true)}
          />
        </Show>
      </p>
      <p ref={measurement} class={`${styles.text} ${styles.measurement}`} aria-hidden="true">
        <span ref={measurementText} />
        <Button
          ref={measurementButton}
          type="button"
          variant="ghost"
          iconOnly
          iconStart={<Ellipsis />}
          class={styles.expand}
          tabIndex={-1}
        />
      </p>
    </div>
  );
}

export default BookDescription;
