export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown };
};

export async function getHealth(): Promise<{ status: 'ok'; timestamp: string }> {
  const response = await fetch('/api/health');
  const body: unknown = await response.json();

  if (!response.ok) {
    const message = isApiError(body) ? body.error.message : 'The service could not be reached.';
    throw new Error(message);
  }

  return body as { status: 'ok'; timestamp: string };
}

function isApiError(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'error' in value;
}
