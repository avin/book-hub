export const user = {
  id: '00000000-0000-0000-0000-000000000001',
  login: 'reader',
  is_active: true,
  quota_bytes: 1024 * 1024 * 1024,
  used_bytes: 8 * 1024 * 1024,
  created_at: '2025-01-01T00:00:00Z',
};

export const csrf = {
  csrf_token: 'test-csrf',
};

export const login = {
  user,
};

export const registration = {
  message: 'created',
};

export const req = {
  currentUser: { method: 'GET', path: '/v1/me' },
  csrf: { method: 'GET', path: '/v1/auth/csrf' },
  login: { method: 'POST', path: '/v1/auth/login' },
  register: { method: 'POST', path: '/v1/auth/register' },
  logout: { method: 'POST', path: '/v1/auth/logout' },
} as const;
