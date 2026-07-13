import { onCleanup, onMount } from 'solid-js';

const readerHistoryStateKey = '__bookHubReaderLocation';

type ReaderHistoryState<Location> = {
  readerId: string;
  location: Location;
};

function stateWithLocation<Location>(readerId: string, location: Location) {
  const currentState = window.history.state;
  const state =
    typeof currentState === 'object' && currentState !== null
      ? (currentState as Record<string, unknown>)
      : {};

  return {
    ...state,
    [readerHistoryStateKey]: { readerId, location } satisfies ReaderHistoryState<Location>,
  };
}

function useReaderNavigationHistory<Location>(props: {
  readerId: string;
  captureLocation: () => Location | undefined;
  restoreLocation: (location: Location) => void;
  isLocation: (value: unknown) => value is Location;
}) {
  const recordNavigation = (location: Location, previousLocation = props.captureLocation()) => {
    if (!previousLocation) {
      return;
    }

    window.history.replaceState(
      stateWithLocation(props.readerId, previousLocation),
      '',
      window.location.href,
    );
    window.history.pushState(stateWithLocation(props.readerId, location), '', window.location.href);
  };

  onMount(() => {
    const onPopState = (event: PopStateEvent) => {
      const state = event.state as Record<string, unknown> | null;
      const readerState = state?.[readerHistoryStateKey] as ReaderHistoryState<unknown> | undefined;

      if (readerState?.readerId !== props.readerId) {
        return;
      }

      const location = readerState.location;

      if (!props.isLocation(location)) {
        return;
      }

      requestAnimationFrame(() => props.restoreLocation(location));
    };

    window.addEventListener('popstate', onPopState);

    onCleanup(() => {
      window.removeEventListener('popstate', onPopState);
    });
  });

  return { recordNavigation };
}

export default useReaderNavigationHistory;
