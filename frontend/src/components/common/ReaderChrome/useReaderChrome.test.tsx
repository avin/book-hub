import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReaderFloatingChrome from '@/components/common/ReaderFloatingChrome/ReaderFloatingChrome';
import { I18nProvider } from '@/i18n/I18nProvider';
import useReaderChrome from './useReaderChrome';

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
  vi.restoreAllMocks();
});

const centerTouch = () => ({
  pointerType: 'touch',
  pointerId: 1,
  isPrimary: true,
  clientX: window.innerWidth / 2,
  clientY: window.innerHeight / 2,
});

function tap(target: HTMLElement, touch = centerTouch()) {
  fireEvent.pointerDown(target, touch);
  fireEvent.pointerUp(target, touch);
}

function TestReader() {
  const chrome = useReaderChrome({ keepVisible: () => false, onClose: () => undefined });

  return (
    <I18nProvider>
      <ReaderFloatingChrome visible={chrome.visible()} onShow={chrome.show} />
      <main
        data-testid="document"
        onPointerDown={chrome.onDocumentPointerDown}
        onPointerUp={chrome.onDocumentPointerUp}
        onPointerCancel={chrome.onDocumentPointerCancel}
        onClick={chrome.onDocumentClick}
      >
        <p>Текст книги</p>
        <a href="#chapter">Глава</a>
      </main>
    </I18nProvider>
  );
}

describe('сенсорное управление панелями читалки', () => {
  it('скрывает панели вторым тапом с небольшим движением пальца', () => {
    const reader = render(() => <TestReader />);
    const document = reader.getByTestId('document');
    const header = reader.getByTestId('reader-floating-header');
    const footer = reader.getByTestId('reader-floating-footer');
    const touch = centerTouch();

    fireEvent.pointerDown(document, touch);
    fireEvent.pointerUp(document, touch);
    expect(header.dataset.visible).toBe('true');

    fireEvent.pointerDown(document, touch);
    fireEvent.pointerMove(document, { ...touch, clientY: touch.clientY + 1 });
    fireEvent.pointerUp(document, { ...touch, clientY: touch.clientY + 1 });
    fireEvent.click(document);

    expect(header.dataset.visible).toBe('false');
    expect(footer.dataset.visible).toBe('false');
  });

  it('не показывает панели при движении пальца у краёв и сенсорном наведении', () => {
    const reader = render(() => <TestReader />);
    const header = reader.getByTestId('reader-floating-header');
    const touch = centerTouch();

    fireEvent.pointerMove(window, { ...touch, clientY: 1 });
    expect(header.dataset.visible).toBe('false');
    fireEvent.pointerMove(window, { ...touch, clientY: window.innerHeight - 1 });
    expect(header.dataset.visible).toBe('false');
    fireEvent.pointerEnter(header, touch);
    expect(header.dataset.visible).toBe('false');
  });

  it('сохраняет показ и скрытие панелей при движении мыши', () => {
    const reader = render(() => <TestReader />);
    const header = reader.getByTestId('reader-floating-header');

    fireEvent.pointerMove(window, { pointerType: 'mouse', clientY: 1 });
    expect(header.dataset.visible).toBe('true');
    fireEvent.pointerMove(window, { pointerType: 'mouse', clientY: window.innerHeight / 2 });
    expect(header.dataset.visible).toBe('false');
    fireEvent.pointerEnter(header, { pointerType: 'mouse' });
    expect(header.dataset.visible).toBe('true');
  });

  it.each([
    { sector: 'нижнему', x: 0.85, y: 0.875, direction: 1 },
    { sector: 'верхнему', x: 0.85, y: 0.125, direction: -1 },
    { sector: 'нижнему', x: 0.5, y: 0.7, direction: 1 },
    { sector: 'верхнему', x: 0.5, y: 0.3, direction: -1 },
  ])(
    'перелистывает по тапу в $sector правом секторе, сохраняя панели скрытыми',
    ({ x, y, direction }) => {
      const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
      const reader = render(() => <TestReader />);
      const touch = {
        ...centerTouch(),
        clientX: window.innerWidth * x,
        clientY: window.innerHeight * y,
      };

      tap(reader.getByTestId('document'), touch);

      expect(scrollBy).toHaveBeenCalledExactlyOnceWith({
        top: window.innerHeight * 0.9 * direction,
        behavior: 'instant',
      });
      expect(reader.getByTestId('reader-floating-header').dataset.visible).toBe('false');
    },
  );

  it.each([
    { x: 0.1, y: 1 / 3 },
    { x: 0.9, y: 1 / 3 },
    { x: 0.1, y: 2 / 3 },
    { x: 0.9, y: 2 / 3 },
  ])('переключает панели в средней трети при x=$x, y=$y', ({ x, y }) => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const reader = render(() => <TestReader />);
    const content = reader.getByTestId('document');
    const header = reader.getByTestId('reader-floating-header');
    const touch = {
      ...centerTouch(),
      clientX: window.innerWidth * x,
      clientY: window.innerHeight * y,
    };

    tap(content, touch);
    expect(header.dataset.visible).toBe('true');
    tap(content, touch);
    expect(header.dataset.visible).toBe('false');
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it.each([0.3, 0.7])('не реагирует на тап слева от зон прокрутки при y=%s', (y) => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const reader = render(() => <TestReader />);

    tap(reader.getByTestId('document'), {
      ...centerTouch(),
      clientX: window.innerWidth / 2 - 1,
      clientY: window.innerHeight * y,
    });

    expect(reader.getByTestId('reader-floating-header').dataset.visible).toBe('false');
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it.each(['свайп', 'отмена', 'мультитач', 'долгое нажатие', 'выделение'])(
    'не считает тапом жест: %s',
    (gesture) => {
      const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
      const reader = render(() => <TestReader />);
      const content = reader.getByTestId('document');
      const touch = centerTouch();
      const down = new PointerEvent('pointerdown', { ...touch, bubbles: true });
      const up = new PointerEvent('pointerup', { ...touch, bubbles: true });
      Object.defineProperty(down, 'timeStamp', { value: 0 });
      Object.defineProperty(up, 'timeStamp', { value: gesture === 'долгое нажатие' ? 600 : 50 });
      if (gesture === 'выделение') {
        window.getSelection()?.selectAllChildren(content);
      }
      fireEvent(content, down);

      if (gesture === 'свайп') {
        fireEvent.pointerMove(content, { ...touch, clientY: touch.clientY + 40 });
        fireEvent.pointerMove(content, touch);
      } else if (gesture === 'отмена') {
        fireEvent.pointerCancel(content, touch);
      } else if (gesture === 'мультитач') {
        fireEvent.pointerDown(content, { ...touch, pointerId: 2, isPrimary: false });
      }

      fireEvent(content, up);
      const touchEnd = new TouchEvent('touchend', { bubbles: true, cancelable: true });
      fireEvent(content, touchEnd);
      fireEvent.click(content);

      expect(reader.getByTestId('reader-floating-header').dataset.visible).toBe('false');
      expect(scrollBy).not.toHaveBeenCalled();
      expect(touchEnd.defaultPrevented).toBe(false);
      if (gesture === 'выделение') {
        expect(window.getSelection()?.isCollapsed).toBe(false);
      }
      window.getSelection()?.removeAllRanges();
    },
  );

  it.each([
    { y: 0.15, direction: -1 },
    { y: 0.85, direction: 1 },
  ])(
    'перелистывает и снимает выделение, появившееся при коротком тапе при y=$y',
    ({ y, direction }) => {
      const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
      const reader = render(() => <TestReader />);
      const content = reader.getByTestId('document');
      const touch = { ...centerTouch(), clientY: window.innerHeight * y };

      fireEvent.pointerDown(content, touch);
      window.getSelection()?.selectAllChildren(reader.getByText('Текст книги'));
      fireEvent.pointerUp(content, touch);

      expect(scrollBy).toHaveBeenCalledExactlyOnceWith({
        top: window.innerHeight * 0.9 * direction,
        behavior: 'instant',
      });
      expect(window.getSelection()?.isCollapsed).toBe(true);
    },
  );

  it('отменяет стандартное действие touchend и click только для обработанного тапа', () => {
    const reader = render(() => <TestReader />);
    const content = reader.getByTestId('document');
    tap(content);
    const touchEnd = new TouchEvent('touchend', { bubbles: true, cancelable: true });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });

    fireEvent(content, touchEnd);
    const nextTouchEnd = new TouchEvent('touchend', { bubbles: true, cancelable: true });
    fireEvent(window, nextTouchEnd);
    fireEvent(content, click);

    expect(touchEnd.defaultPrevented).toBe(true);
    expect(nextTouchEnd.defaultPrevented).toBe(false);
    expect(click.defaultPrevented).toBe(true);
    expect(reader.getByTestId('reader-floating-header').dataset.visible).toBe('true');
  });

  it('сохраняет выделение долгим нажатием и не отменяет его стандартные действия', () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const reader = render(() => <TestReader />);
    const content = reader.getByTestId('document');
    const touch = { ...centerTouch(), clientY: window.innerHeight * 0.85 };
    const down = new PointerEvent('pointerdown', { ...touch, bubbles: true });
    const up = new PointerEvent('pointerup', { ...touch, bubbles: true, cancelable: true });
    Object.defineProperty(down, 'timeStamp', { value: 0 });
    Object.defineProperty(up, 'timeStamp', { value: 600 });

    fireEvent(content, down);
    window.getSelection()?.selectAllChildren(reader.getByText('Текст книги'));
    fireEvent(content, up);
    const touchEnd = new TouchEvent('touchend', { bubbles: true, cancelable: true });
    fireEvent(content, touchEnd);

    expect(scrollBy).not.toHaveBeenCalled();
    expect(window.getSelection()?.toString()).toBe('Текст книги');
    expect(up.defaultPrevented).toBe(false);
    expect(touchEnd.defaultPrevented).toBe(false);
  });

  it('не перехватывает тап по ссылке внутри книги', () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const reader = render(() => <TestReader />);
    const link = reader.getByRole('link', { name: 'Глава' });
    const onClick = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener('click', onClick);

    tap(link);
    fireEvent.click(link);

    expect(onClick).toHaveBeenCalledOnce();
    expect(reader.getByTestId('reader-floating-header').dataset.visible).toBe('false');
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('после тапа игнорирует совместимый click, но обрабатывает следующий клик мышью', () => {
    const reader = render(() => <TestReader />);
    const content = reader.getByTestId('document');
    const header = reader.getByTestId('reader-floating-header');

    tap(content);
    fireEvent.click(content);
    expect(header.dataset.visible).toBe('true');

    fireEvent.pointerDown(content, { pointerType: 'mouse' });
    fireEvent.click(content);
    expect(header.dataset.visible).toBe('false');
  });
});
