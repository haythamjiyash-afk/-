// In-memory session token store (never stored in localStorage/sessionStorage)
let memoryToken: string | null = null;

export function setAuthToken(token: string | null): void {
  memoryToken = token;
}

export function getAuthToken(): string | null {
  return memoryToken;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new ApiError(
      'تعذر الاتصال بالخادم. يرجى التحقق من اتصال الإنترنت والمحاولة مرة أخرى.',
      0
    );
  }

  let data: unknown = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const errMsg =
      data &&
      typeof data === 'object' &&
      'error' in data &&
      typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `حدث خطأ غير متوقع (${response.status})`;
    throw new ApiError(errMsg, response.status);
  }

  return data as T;
}

export async function uploadAttachment(
  file: File
): Promise<{ filename: string; originalName: string; url: string }> {
  const form = new FormData();
  form.append('file', file);
  return apiRequest('/attachments', {
    method: 'POST',
    body: form,
  });
}

export async function fetchProtectedBlobUrl(url: string): Promise<string> {
  const headers = new Headers();
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error('تعذر تحميل المرفق');
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
