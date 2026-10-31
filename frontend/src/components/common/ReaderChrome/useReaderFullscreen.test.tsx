import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useReaderFullscreen from './useReaderFullscreen';

const propertyRestorers: (() => void)[] = [];

function mockProperty(target: object, key: PropertyKey, descriptor: PropertyDescriptor) {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, ...descriptor });
  propertyRestorers.push(() => {
    if (original) Object.defineProperty(target, key, original);
    else Reflect.deleteProperty(target, key);
  });
}

afterEach(async () => {
  cleanup();
  await Promise.resolve();
  await Promise.resolve();
  for (const restore of propertyRestorers.reverse()) restore();
  propertyRestorers.length = 0;
  vi.unstubAllGlobals();
});

function setupFullscreen(options: { coarse?: boolean; active?: boolean; enabled?: boolean } = {}) {
  let fullscreenElement: Element | null = null;
  const activation = { isActive: options.active ?? true };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: options.coarse ?? true })),
  );
  mockProperty(navigator, 'userActivation', { value: activation });
  mockProperty(document, 'fullscreenEnabled', { value: options.enabled ?? true });
  mockProperty(document, 'fullscreenElement', { get: () => fullscreenElement });

  const changeFullscreen = (element: Element | null) => {
    fullscreenElement = element;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  const enter = vi.fn(async () => changeFullscreen(document.documentElement));
  const exit = vi.fn(async () => changeFullscreen(null));
  mockProperty(document.documentElement, 'requestFullscreen', { value: enter });
  mockProperty(document, 'exitFullscreen', { value: exit });

  const [visible, setVisible] = createSignal(false);
  const onExit = vi.fn(() => setVisible(true));
  let sync!: () => void;
  const reader = render(() => {
    sync = useReaderFullscreen({ visible, onExit });
    return <output>{visible() ? 'shown' : 'hidden'}</output>;
  });

  return { enter, exit, changeFullscreen, visible, setVisible, onExit, activation, sync, reader };
}

describe('полноэкранное чтение', () => {
  it('входит при скрытых панелях и выходит при их показе', async () => {
    const fullscreen = setupFullscreen();
    await waitFor(() => expect(document.fullscreenElement).toBe(document.documentElement));
    expect(fullscreen.enter).toHaveBeenCalledExactlyOnceWith({ navigationUI: 'hide' });

    fullscreen.setVisible(true);
    await waitFor(() => expect(document.fullscreenElement).toBeNull());
    expect(fullscreen.exit).toHaveBeenCalledOnce();
  });

  it.each([
    { name: 'мышь', coarse: false, active: true, enabled: true },
    { name: 'нет жеста пользователя', coarse: true, active: false, enabled: true },
    { name: 'API недоступен', coarse: true, active: true, enabled: false },
  ])('не запрашивает fullscreen: $name', async (options) => {
    const fullscreen = setupFullscreen(options);
    await Promise.resolve();
    expect(fullscreen.enter).not.toHaveBeenCalled();
    expect(fullscreen.visible()).toBe(false);
  });

  it('повторяет попытку после появления разрешённого жеста', async () => {
    const fullscreen = setupFullscreen({ active: false });
    expect(fullscreen.enter).not.toHaveBeenCalled();

    fullscreen.activation.isActive = true;
    fullscreen.sync();
    await waitFor(() => expect(document.fullscreenElement).toBe(document.documentElement));
  });

  it('показывает панели после системного выхода без повторного входа', async () => {
    const fullscreen = setupFullscreen();
    await waitFor(() => expect(document.fullscreenElement).toBe(document.documentElement));
    await Promise.resolve();

    fullscreen.changeFullscreen(null);

    expect(fullscreen.onExit).toHaveBeenCalledOnce();
    expect(fullscreen.visible()).toBe(true);
    expect(fullscreen.enter).toHaveBeenCalledOnce();
  });

  it('выходит при уходе из читалки', async () => {
    const fullscreen = setupFullscreen();
    await waitFor(() => expect(document.fullscreenElement).toBe(document.documentElement));

    fullscreen.reader.unmount();
    await waitFor(() => expect(document.fullscreenElement).toBeNull());
    expect(fullscreen.exit).toHaveBeenCalledOnce();
  });

  it('обрабатывает отказ браузера и повторяет запрос при следующем скрытии', async () => {
    const fullscreen = setupFullscreen({ active: false });
    fullscreen.enter.mockRejectedValueOnce(new TypeError('Fullscreen denied'));
    fullscreen.activation.isActive = true;
    fullscreen.sync();
    await Promise.resolve();
    expect(fullscreen.visible()).toBe(false);
    expect(document.fullscreenElement).toBeNull();

    fullscreen.setVisible(true);
    fullscreen.setVisible(false);
    await waitFor(() => expect(document.fullscreenElement).toBe(document.documentElement));
    expect(fullscreen.enter).toHaveBeenCalledTimes(2);
  });

  it.each(['показ панелей', 'уход из читалки'])(
    'завершает fullscreen, если запрос входа опоздал: %s',
    async (action) => {
      const fullscreen = setupFullscreen({ active: false });
      let resolveRequest!: () => void;
      fullscreen.enter.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveRequest = resolve;
          }),
      );
      fullscreen.activation.isActive = true;
      fullscreen.sync();

      if (action === 'показ панелей') fullscreen.setVisible(true);
      else fullscreen.reader.unmount();
      fullscreen.changeFullscreen(document.documentElement);
      resolveRequest();

      await waitFor(() => expect(document.fullscreenElement).toBeNull());
      expect(fullscreen.exit).toHaveBeenCalledOnce();
    },
  );

  it('не завершает чужой полноэкранный режим', async () => {
    const fullscreen = setupFullscreen({ active: false });
    const video = document.createElement('video');
    fullscreen.changeFullscreen(video);

    fullscreen.setVisible(true);
    fullscreen.reader.unmount();
    await Promise.resolve();

    expect(fullscreen.exit).not.toHaveBeenCalled();
    expect(document.fullscreenElement).toBe(video);
  });
});
