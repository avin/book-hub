import { createMemoryHistory, MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppQueryClient } from '@/api/queryClient';
import { currentUserQueryKey } from '@/api/user';
import { I18nProvider } from '@/i18n/I18nProvider';
import AuthGate from './AuthGate';

const mocks = vi.hoisted(() => ({ apiClient: { GET: vi.fn() }, getCsrfToken: vi.fn() }));
vi.mock('@/api/client', () => mocks);

const user = { id: 'reader', login: 'reader' };
const unavailable = { code: 'service_unavailable', message: 'storage temporarily unavailable' };

function renderGate(cachedUser = false, requireAuth = true) {
  const queryClient = createAppQueryClient();
  if (cachedUser) {
    queryClient.setQueryData(currentUserQueryKey, user);
  }
  const history = createMemoryHistory();
  history.set({ value: '/protected' });
  const view = render(() => (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter history={history}>
          <Route
            path="/protected"
            component={() => (
              <AuthGate requireAuth={requireAuth} fallbackHref="/fallback">
                <p>Allowed content</p>
              </AuthGate>
            )}
          />
          <Route path="/fallback" component={() => <p>Fallback content</p>} />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>
  ));
  return { ...view, queryClient, history };
}

describe('AuthGate temporary storage failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([true, false])(
    'keeps the current route and offers retry without a cached session (requireAuth=%s)',
    async (requireAuth) => {
      mocks.apiClient.GET.mockResolvedValueOnce({ error: unavailable }).mockResolvedValueOnce({
        data: user,
      });
      const view = renderGate(false, requireAuth);

      await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
      expect(view.history.get()).toBe('/protected');
      expect(view.queryByText('Fallback content')).toBeNull();
      expect(view.queryByText('Allowed content')).toBeNull();
      expect(mocks.apiClient.GET).toHaveBeenCalledTimes(1);

      fireEvent.click(view.getByRole('button'));
      await waitFor(() =>
        expect(view.getByText(requireAuth ? 'Allowed content' : 'Fallback content')).toBeTruthy(),
      );
      expect(mocks.apiClient.GET).toHaveBeenCalledTimes(2);
    },
  );

  it('keeps cached access and private data when a session refresh fails temporarily', async () => {
    mocks.apiClient.GET.mockResolvedValue({ error: unavailable });
    const view = renderGate(true);
    view.queryClient.setQueryData(['books'], ['book']);

    await waitFor(() =>
      expect(view.queryClient.getQueryState(currentUserQueryKey)?.status).toBe('error'),
    );
    expect(view.getByText('Allowed content')).toBeTruthy();
    expect(view.history.get()).toBe('/protected');
    expect(view.queryClient.getQueryData(currentUserQueryKey)).toEqual(user);
    expect(view.queryClient.getQueryData(['books'])).toEqual(['book']);
  });

  it('redirects an invalid session even when a user was cached', async () => {
    mocks.apiClient.GET.mockResolvedValue({ error: { code: 'unauthorized' } });
    const view = renderGate(true);

    await waitFor(() => expect(view.getByText('Fallback content')).toBeTruthy());
    expect(view.history.get()).toBe('/fallback');
  });
});
