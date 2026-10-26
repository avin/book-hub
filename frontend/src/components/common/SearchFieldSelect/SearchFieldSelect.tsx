import { Check, ChevronDown } from 'lucide-solid';
import { createMemo, createSignal } from 'solid-js';
import type { BookSearchField } from '@/api/books';
import Button from '@/components/common/Button/Button';
import Dropdown from '@/components/common/Dropdown/Dropdown';
import Menu, { type MenuItem } from '@/components/common/Menu/Menu';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './SearchFieldSelect.module.scss';

function SearchFieldSelect(props: {
  value: BookSearchField;
  onChange: (field: BookSearchField) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = createSignal(false);
  let trigger!: HTMLButtonElement;
  const options = createMemo(() => [
    { value: 'title' as const, label: t('byTitle') },
    { value: 'description' as const, label: t('byDescription') },
  ]);
  const items = createMemo<MenuItem<BookSearchField>[]>(() =>
    options().map((option) => ({
      id: option.value,
      label: option.label,
      selected: option.value === props.value,
      iconEnd: option.value === props.value ? <Check /> : undefined,
      onClick: () => {
        props.onChange(option.value);
        setOpen(false);
        trigger.focus();
      },
    })),
  );

  return (
    <Dropdown
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-start"
      minWidth={180}
      fitReferenceToContent
      trigger={
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          class={styles.trigger}
          aria-label={t('whereToSearch')}
          aria-haspopup="menu"
          aria-expanded={open()}
          iconEnd={<ChevronDown />}
          onClick={() => setOpen(!open())}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          {t(props.value === 'description' ? 'byDescription' : 'byTitle')}
        </Button>
      }
    >
      <Menu items={items()} />
    </Dropdown>
  );
}

export default SearchFieldSelect;
