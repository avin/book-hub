export function installChunkRecovery(buildUrl: string) {
  const storageKey = 'book-hub-chunk-reload';
  let reloading = false;

  const onPreloadError = (event: Event) => {
    const error: unknown = (event as Event & { payload: unknown }).payload;
    if (
      reloading ||
      !(error instanceof Error) ||
      !/dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(
        error.message,
      )
    ) {
      return;
    }

    // Keep the marker across reloads: a persistent outage must not cause a loop.
    try {
      if (window.sessionStorage.getItem(storageKey) === buildUrl) {
        return;
      }
      window.sessionStorage.setItem(storageKey, buildUrl);
    } catch {
      // Without persistent storage we cannot safely limit automatic reloads.
      return;
    }

    reloading = true;
    event.preventDefault();
    window.location.reload();
  };

  window.addEventListener('vite:preloadError', onPreloadError);
  return () => window.removeEventListener('vite:preloadError', onPreloadError);
}
