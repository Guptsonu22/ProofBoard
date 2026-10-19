export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown };
};

export type PublicUser = { id: string; email: string; createdAt: string };

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
