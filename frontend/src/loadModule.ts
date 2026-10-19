const reloadParameter = '__bh_reload';
const reloadStorageKey = 'book-hub-module-reload';

function entryUrl(html: Document, baseUrl: string) {
  const src = html
    .querySelector<HTMLScriptElement>('script[type="module"][src]')
    ?.getAttribute('src');
  return src ? new URL(src, baseUrl).href : undefined;
}

const runningEntryUrl = entryUrl(document, window.location.href);
let recovery: Promise<boolean> | undefined;

export function clearModuleReloadParameter() {
  const url = new URL(window.location.href);
  if (url.searchParams.has(reloadParameter)) {
    url.searchParams.delete(reloadParameter);
    window.history.replaceState(window.history.state, '', url);
  }
}

function isModuleLoadError(error: unknown) {
  return (
    error instanceof Error &&
    /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(
      error.message,
    )
  );
}

async function refreshChangedBuild() {
  if (!runningEntryUrl) {
    return false;
  }

  try {
    if (window.sessionStorage.getItem(reloadStorageKey) === runningEntryUrl) {
      return false;
    }

    const probeUrl = new URL(`${import.meta.env.BASE_URL}index.html`, window.location.origin);
    probeUrl.searchParams.set('__bh_check', `${Date.now()}`);
    const response = await fetch(probeUrl, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
      return false;
    }

    const html = new DOMParser().parseFromString(await response.text(), 'text/html');
    const latestEntryUrl = entryUrl(html, probeUrl.href);
    if (!latestEntryUrl || latestEntryUrl === runningEntryUrl) {
      return false;
    }

    window.sessionStorage.setItem(reloadStorageKey, runningEntryUrl);
    const destination = new URL(window.location.href);
    // A normal reload can reuse the stale document from a browser or proxy cache.
    destination.searchParams.set(reloadParameter, new URL(latestEntryUrl).pathname);
    window.location.replace(destination.href);
    return true;
  } catch {
    // Offline, unavailable storage and failed probes keep the original error UI.
    return false;
  }
}

export async function loadModule<T>(importer: () => Promise<T>): Promise<T> {
  try {
    return await importer();
  } catch (error) {
    if (isModuleLoadError(error)) {
      const attempt = (recovery ??= refreshChangedBuild());
      if (await attempt) {
        // Keep Suspense active until navigation replaces this obsolete document.
        return new Promise<T>(() => {});
      }
      if (recovery === attempt) {
        recovery = undefined;
      }
    }
    throw error;
  }
}
