// Thin fetch helpers for the Face -> PPE -> Work-authorization workflow.
export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new ApiError('Backend unavailable. Make sure the FastAPI server is running on port 8000.', 'BACKEND_UNAVAILABLE', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const d = data?.detail;
    const message = typeof d === 'string' ? d : (d && d.message) || (Array.isArray(d) ? 'Invalid request.' : `Request failed (${res.status}).`);
    throw new ApiError(message, d?.code, res.status);
  }
  return data;
}

export const getWorkflowStatus = () => request('/api/workflow/status', { cache: 'no-store' });
export const registerPerson = (formData) => request('/api/persons/register', { method: 'POST', body: formData });
export const lookupPerson = (mobile) => request(`/api/persons/lookup?mobile=${encodeURIComponent(mobile)}`);
export const startVerification = (personId) => request('/api/verify/start', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ person_id: personId }),
});
export function sendFrame(sessionId, blob) {
  const body = new FormData();
  body.append('session_id', sessionId);
  body.append('file', blob, 'frame.jpg');
  return request('/api/verify/frame', { method: 'POST', body });
}

// ---- Registered workers (permanent registry) ----
export const listWorkers = () => request('/api/persons', { cache: 'no-store' });
export const deleteWorker = (id) => request(`/api/persons/${id}`, { method: 'DELETE' });

// ---- PPE alerts (violation history) ----
export const listAlerts = () => request('/api/alerts', { cache: 'no-store' });

// ---- Live verification (backend camera: face identification -> PPE -> alert) ----
export const getLiveState = () => request('/api/live-verify/state', { cache: 'no-store' });
export const nextPerson = () => request('/api/live-verify/next', { method: 'POST' });
