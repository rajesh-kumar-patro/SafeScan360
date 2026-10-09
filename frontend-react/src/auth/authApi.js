// Thin fetch helpers for /api/auth/* (NEW). The session lives in an HttpOnly cookie set by the
// backend, so no token is ever handled (or stored) in JavaScript.
export class AuthApiError extends Error {
  constructor(message, code, status, fields = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;   // {fieldName: message} from server-side validation
  }
}

async function call(url, options = {}) {
  let res;
  try {
    res = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
  } catch {
    throw new AuthApiError('Cannot reach the server. Make sure the backend is running on port 8000.', 'BACKEND_UNAVAILABLE', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) {
    const d = data && data.detail;
    if (!d && res.status >= 500) {
      throw new AuthApiError('Cannot reach the server. Make sure the backend is running on port 8000.', 'BACKEND_UNAVAILABLE', res.status);
    }
    const message = (d && d.message) || (typeof d === 'string' ? d : `Request failed (${res.status}).`);
    throw new AuthApiError(message, d && d.code, res.status, (d && d.fields) || {});
  }
  return data;
}

export const getMe = () => call('/api/auth/me');
export const signUpRequest = (payload) => call('/api/auth/signup', { method: 'POST', body: JSON.stringify(payload) });
export const signInRequest = (payload) => call('/api/auth/signin', { method: 'POST', body: JSON.stringify(payload) });
export const signOutRequest = () => call('/api/auth/logout', { method: 'POST' });
