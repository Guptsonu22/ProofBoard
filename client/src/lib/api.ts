export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown };
};

export type PublicUser = { id: string; email: string; createdAt: string };
export type ColumnProfile = { id: string; originalName: string; displayName: string; type: 'number' | 'date' | 'category' | 'text'; rationale: string; missingCount: number; invalidCount: number; samples: string[] };
export type Dataset = { id: string; name: string; originalFileName: string | null; createdAt: string; sourceRecordCount: number; parsedRowCount: number; rejectedRowCount: number; columns: ColumnProfile[] };
export type PreviewRow = { ordinal: number; sourceRow: number; sourceLine: number; values: unknown; warnings: unknown; rejected: boolean; rejectionReason: string | null };

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(isApiError(body) ? body.error.message : 'The request could not be completed.');
  return body as T;
}

export async function getDatasets(): Promise<Dataset[]> {
  const result = await jsonRequest<{ datasets: Dataset[] }>('/api/datasets');
  return result.datasets;
}
export async function getDataset(id: string): Promise<Dataset> {
  const result = await jsonRequest<{ dataset: Dataset }>(`/api/datasets/${encodeURIComponent(id)}`);
  return result.dataset;
}
export async function getDatasetPreview(id: string): Promise<PreviewRow[]> {
  const result = await jsonRequest<{ rows: PreviewRow[] }>(`/api/datasets/${encodeURIComponent(id)}/preview?limit=50`);
  return result.rows;
}
export async function getDatasetWarnings(id: string): Promise<{ warnings: PreviewRow[]; total: number }> {
  return jsonRequest(`/api/datasets/${encodeURIComponent(id)}/warnings?limit=50`);
}
export function uploadDataset(file: File, onProgress: (percent: number) => void): Promise<Dataset> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/datasets');
    request.withCredentials = true;
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded * 100 / event.total)); };
    request.onerror = () => reject(new Error('The upload could not reach the server. Check your connection and try again.'));
    request.onload = () => {
      let body: unknown;
      try { body = JSON.parse(request.responseText); } catch { reject(new Error('The server returned an unreadable response.')); return; }
      if (request.status < 200 || request.status >= 300) { reject(new Error(isApiError(body) ? body.error.message : 'The upload could not be completed.')); return; }
      resolve((body as { dataset: Dataset }).dataset);
    };
    const form = new FormData();
    form.append('file', file);
    request.send(form);
  });
}

export async function getHealth(): Promise<{ status: 'ok'; timestamp: string }> {
  const response = await fetch('/api/health', { credentials: 'same-origin' });
  const body: unknown = await response.json();

  if (!response.ok) {
    const message = isApiError(body) ? body.error.message : 'The service could not be reached.';
    throw new Error(message);
  }

  return body as { status: 'ok'; timestamp: string };
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
  if (response.status === 401) return null;
  const body = await response.json() as { user: PublicUser } | ApiErrorBody;
  if (!response.ok) throw new Error(isApiError(body) ? body.error.message : 'Could not load your account.');
  return (body as { user: PublicUser }).user;
}

export async function authenticate(path: 'login' | 'register', email: string, password: string): Promise<PublicUser> {
  const response = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(isApiError(body) ? body.error.message : 'Authentication failed.');
  return (body as { user: PublicUser }).user;
}

export async function logout(): Promise<void> {
  const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  if (!response.ok) {
    const body: unknown = await response.json();
    throw new Error(isApiError(body) ? body.error.message : 'Could not sign out.');
  }
}

function isApiError(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'error' in value;
}
