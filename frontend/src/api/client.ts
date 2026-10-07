// Typed client for the CARE QR backend. All requests go to /api, which the
// dev server (and later the reverse proxy) forwards to the backend.

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// JSON bodies are serialised; a Blob (for example an image) is sent as is.
export async function call<T>(
  method: Method,
  path: string,
  token: string | null,
  body?: object | Blob,
) {
  const isFile = body instanceof Blob;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      signal: controller.signal,
      headers: {
        ...(body ? { 'content-type': isFile ? body.type : 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: isFile ? body : JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      controller.signal.aborted
        ? 'The hospital system took too long to respond. Please try again.'
        : 'Cannot reach the hospital system. Check your connection and try again.',
    );
  } finally {
    window.clearTimeout(timeout);
  }
  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const candidate =
      payload && typeof payload === 'object' && 'error' in payload ? payload.error : null;
    const error = candidate && typeof candidate === 'object' ? candidate : {};
    throw new ApiError(
      response.status,
      'code' in error && typeof error.code === 'string' ? error.code : 'UNKNOWN',
      'message' in error && typeof error.message === 'string'
        ? error.message
        : `Request failed (${response.status}).`,
    );
  }
  if (response.status !== 204 && payload === null) {
    throw new ApiError(
      502,
      'INVALID_RESPONSE',
      'The hospital system returned an unreadable response. Please try again.',
    );
  }
  // Response shapes are defined by the backend routes; this is the one place
  // the client trusts them.
  return payload as T;
}

// Credentials. Staff stay signed in across tabs until the 8-hour session ends;
// a guest session lives only in the tab that scanned the QR code.
const staffKey = 'careqr.staffToken';
const platformKey = 'careqr.platformToken';
const guestKey = 'careqr.guestToken';

const memory = new Map<string, string>();
const volatileKeys = new Set<string>();

function read(storage: () => Storage, key: string): string | null {
  if (volatileKeys.has(key)) return memory.get(key) ?? null;
  try {
    return storage().getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(storage: () => Storage, key: string, value: string | null): void {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
    volatileKeys.delete(key);
  } catch {
    volatileKeys.add(key);
    // Private browsers can block storage. Keep access only in memory until
    // refresh, rather than sending a successful login into a redirect loop.
  }
}

export const credentials = {
  staff: () => read(() => localStorage, staffKey),
  platform: () => read(() => localStorage, platformKey),
  setPlatform: (token: string | null) => write(() => localStorage, platformKey, token),
  setStaff: (token: string | null) => write(() => localStorage, staffKey, token),
  guest: () => read(() => sessionStorage, guestKey),
  setGuest: (token: string | null) => write(() => sessionStorage, guestKey, token),
};

// Server paths such as a logo URL, as the browser must request them.
export function assetUrl(path: string): string {
  return `/api${path}`;
}
