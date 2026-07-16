import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Button from './Button/Button';
import Menu from './Menu/Menu';
import ModalDialog from './ModalDialog/ModalDialog';
import TextInput from './TextInput/TextInput';

afterEach(cleanup);

describe('общие Solid-компоненты', () => {
  it('блокирует загружаемую кнопку и рендерит ссылки', () => {
    const onClick = vi.fn();
    const { getByRole } = render(() => <Button onClick={onClick}>Сохранить</Button>);
    const button = getByRole('button', { name: 'Сохранить' });

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();

    const loading = render(() => (
      <Button loading onClick={onClick}>
        Загрузка
      </Button>
    ));
    expect((loading.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    expect(loading.getByRole('button').getAttribute('aria-busy')).toBe('true');

    const link = render(() => <Button href="https://example.com">Документация</Button>);
    expect(link.getByRole('link', { name: 'Документация' }).getAttribute('href')).toBe(
      'https://example.com',
    );
  });

  it('вызывает только доступные действия меню и корректно рисует ссылки', () => {
    const onClick = vi.fn();
    const action = vi.fn();
    const { getByRole, getByText } = render(() => (
      <Menu
        onClick={onClick}
        items={[
          {
            type: 'category',
            label: 'Раздел',
            items: [{ id: 'open', label: 'Открыть', onClick: action }],
          },
          { type: 'separator' },
          { type: 'link', label: 'Справка', href: '/help' },
          { id: 'disabled', label: 'Недоступно', disabled: true },
        ]}
      />
    ));

    fireEvent.click(getByRole('menuitem', { name: 'Открыть' }));
    fireEvent.click(getByRole('menuitem', { name: 'Недоступно' }));

    expect(action).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledOnce();
    expect(getByText('Справка').closest('a')?.getAttribute('href')).toBe('/help');
    expect(getByRole('separator')).not.toBeNull();
  });

  it('закрывает диалог только при нажатии, начатом на оверлее', () => {
    const onClose = vi.fn();
    const { getByRole, getByText } = render(() => (
      <ModalDialog
        contentClass="content"
        overlayClass="overlay"
        ariaLabel="Диалог"
        onClose={onClose}
      >
        <button type="button">Внутри</button>
      </ModalDialog>
    ));
    const dialog = getByRole('dialog');
    const overlay = dialog.parentElement!;

    fireEvent.pointerDown(getByText('Внутри'));
    fireEvent.click(overlay);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('передаёт доступные атрибуты текстового поля', () => {
    const { getByLabelText } = render(() => <TextInput aria-label="Название" value="Книга" />);
    expect((getByLabelText('Название') as HTMLInputElement).value).toBe('Книга');
  });
});
