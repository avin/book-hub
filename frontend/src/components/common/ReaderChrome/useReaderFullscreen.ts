import { createEffect, onCleanup, untrack, type Accessor } from 'solid-js';

function useReaderFullscreen(props: { visible: Accessor<boolean>; onExit: () => void }) {
  const root = document.documentElement;
  let owned = false;
  let transition: 'enter' | 'exit' | undefined;
  let disposed = false;

  const sync = () => {
    const wantsFullscreen = !disposed && !props.visible();

    if (transition) return;

    if (!wantsFullscreen) {
      if (!owned || document.fullscreenElement !== root) return;

      transition = 'exit';
      void document
        .exitFullscreen()
        .catch(() => undefined)
        .finally(() => {
          transition = undefined;
          owned = document.fullscreenElement === root;
          if (!owned) untrack(sync);
        });
      return;
    }

    if (
      !window.matchMedia?.('(pointer: coarse)').matches ||
      !document.fullscreenEnabled ||
      typeof root.requestFullscreen !== 'function' ||
      typeof document.exitFullscreen !== 'function' ||
      document.fullscreenElement ||
      navigator.userActivation?.isActive === false
    ) {
      return;
    }

    owned = true;
    transition = 'enter';
    void root.requestFullscreen({ navigationUI: 'hide' }).then(
      () => {
        transition = undefined;
        if (document.fullscreenElement !== root) {
          owned = false;
          if (!disposed) untrack(() => props.onExit());
          return;
        }
        untrack(sync);
      },
      () => {
        transition = undefined;
        owned = false;
      },
    );
  };

  const onFullscreenChange = () => {
    if (owned && !transition && document.fullscreenElement !== root) {
      owned = false;
      props.onExit();
    }
  };

  document.addEventListener('fullscreenchange', onFullscreenChange);
  createEffect(sync);

  onCleanup(() => {
    disposed = true;
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    sync();
  });

  return sync;
}

export default useReaderFullscreen;
