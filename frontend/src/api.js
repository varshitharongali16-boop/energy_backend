// ============================================================
// API CLIENT & AUTHENTICATION UTILITY
// ============================================================

export const DEFAULT_API_BASE = localStorage.getItem('API_BASE_URL') || '';

export function getApiBase() {
  return localStorage.getItem('API_BASE_URL') || DEFAULT_API_BASE;
}

export function setApiBase(url) {
  const sanitized = url.replace(/\/+$/, '');
  localStorage.setItem('API_BASE_URL', sanitized);
  return sanitized;
}

export function getToken() {
  return localStorage.getItem('auth_token');
}

export function getUser() {
  const u = localStorage.getItem('auth_user');
  return u ? JSON.parse(u) : null;
}

export function setAuth(token, user) {
  localStorage.setItem('auth_token', token);
  localStorage.setItem('auth_user', JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_user');
}

export async function fetchApi(endpoint, options = {}) {
  const token = getToken();
  const base = getApiBase();

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(`${base}${endpoint}`, {
    ...options,
    headers
  });

  if (response.status === 401 || response.status === 403) {
    clearAuth();
    window.location.reload();
  }

  return response;
}
