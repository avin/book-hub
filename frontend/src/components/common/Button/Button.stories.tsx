import { Plus } from 'lucide-solid';
import { createSignal } from 'solid-js';
import { I18nProvider } from '@/i18n/I18nProvider';
import type { ThemeId } from '@/styles/themes';
import TextInput from '@/components/common/TextInput/TextInput';
import InputContainer from '@/components/common/InputContainer/InputContainer';
import LanguageSelect from '@/components/common/LanguageSelect/LanguageSelect';
import TagsSelect from '@/components/common/TagsSelect/TagsSelect';
import ThemeSelect from '@/components/common/ThemeSelect/ThemeSelect';
import Button from './Button';

export default { component: Button };

export const Default = () => (
  <div style={{ display: 'flex', gap: '12px', 'align-items': 'center', 'flex-wrap': 'wrap' }}>
    <Button>Primary</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="ghost">Ghost</Button>
    <Button variant="danger">Danger</Button>
    <Button iconStart={<Plus />}>With icon</Button>
    <Button variant="secondary" iconStart={<Plus />} iconOnly aria-label="Add" />
    <Button variant="link">Inline link button</Button>
    <Button loading>Loading</Button>
  </div>
);

export const AsLink = () => (
  <div
    style={{
      display: 'flex',
      gap: '12px',
      'align-items': 'center',
      'flex-wrap': 'wrap',
      width: '320px',
    }}
  >
    <Button href="/upload" iconStart={<Plus />}>
      Upload book
    </Button>
    <Button href="/library" variant="secondary">
      Library
    </Button>
    <Button
      href="/settings"
      variant="ghost"
      size="sm"
      iconOnly
      iconStart={<Plus />}
      aria-label="Settings"
    />
    <Button href="https://example.com" variant="link" target="_blank" rel="noreferrer">
      External link
    </Button>
    <Button href="/upload" fullWidth>
      Full width link
    </Button>
  </div>
);

export const DesignSystem = () => {
  const [theme, setTheme] = createSignal<ThemeId>('light-sand');
  const [tags, setTags] = createSignal(['роман']);
  return (
    <I18nProvider>
      <div
        data-theme={theme()}
        style={{
          display: 'grid',
          gap: '24px',
          padding: '24px',
          background: 'var(--surface-page)',
          color: 'var(--text-primary)',
        }}
      >
        <ThemeSelect value={theme()} onChange={setTheme} />
        <div style={{ display: 'flex', gap: '16px', 'align-items': 'end', 'flex-wrap': 'wrap' }}>
          <div style={{ width: '220px' }}>
            <InputContainer label="Поле ввода">
              <TextInput placeholder="Название книги" />
            </InputContainer>
          </div>
          <div style={{ width: '220px' }}>
            <InputContainer label="Теги">
              <TagsSelect
                value={tags()}
                onChange={setTags}
                options={['роман', 'история', 'наука']}
              />
            </InputContainer>
          </div>
          <LanguageSelect />
          <Button>Сохранить</Button>
          <Button variant="secondary">Отмена</Button>
          <Button variant="secondary" iconOnly iconStart={<Plus />} aria-label="Добавить" />
        </div>
        <div style={{ display: 'flex', gap: '16px', 'align-items': 'end', 'flex-wrap': 'wrap' }}>
          <div style={{ width: '220px' }}>
            <InputContainer label="Ошибка" error="Введите название книги">
              <TextInput invalid placeholder="Название книги" />
            </InputContainer>
          </div>
          <div style={{ width: '220px' }}>
            <InputContainer label="Недоступное поле" subtext="Состояние disabled">
              <TextInput disabled value="Название книги" />
            </InputContainer>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '16px', 'align-items': 'center', 'flex-wrap': 'wrap' }}>
          <Button disabled>Сохранить</Button>
          <Button loading>Сохранение</Button>
          <Button variant="danger">Удалить</Button>
        </div>
        <div style={{ display: 'flex', gap: '8px', 'align-items': 'center', 'flex-wrap': 'wrap' }}>
          <Button size="sm">Компактная кнопка</Button>
          <Button size="sm" variant="secondary">
            Отмена
          </Button>
          <Button size="sm" variant="ghost">
            Действие
          </Button>
          <Button
            size="sm"
            variant="secondary"
            iconOnly
            iconStart={<Plus />}
            aria-label="Добавить"
          />
        </div>
      </div>
    </I18nProvider>
  );
};
