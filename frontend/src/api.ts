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

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function call<T>(method: Method, path: string, token: string | null, body?: object) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      payload && typeof payload === 'object' && 'error' in payload
        ? (payload.error as { code?: string; message?: string })
        : {};
    throw new ApiError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.message ?? `Request failed (${response.status}).`,
    );
  }
  // Response shapes are defined by the backend routes; this is the one place
  // the client trusts them.
  return payload as T;
}

// Credentials. Staff stay signed in across tabs until the 8-hour session ends;
// a guest session lives only in the tab that scanned the QR code.
const staffKey = 'careqr.staffToken';
const guestKey = 'careqr.guestToken';

function read(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the user signs in again.
  }
}

export const credentials = {
  staff: () => read(localStorage, staffKey),
  setStaff: (token: string | null) => write(localStorage, staffKey, token),
  guest: () => read(sessionStorage, guestKey),
  setGuest: (token: string | null) => write(sessionStorage, guestKey, token),
};

// Shapes returned by the backend.

export interface Me {
  user: { id: string; email: string; displayName: string };
  tenant: { hospitalId: string; code: string; name: string };
  permissions: string[];
}
export interface Building {
  id: string;
  code: string;
  name: string;
  active: boolean;
}
export interface Floor extends Building {
  buildingId: string | null;
}
export interface Ward extends Building {
  floorId: string;
}
export interface Room extends Building {
  wardId: string;
}
export type BedStatus = 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE' | 'INACTIVE';
export interface Bed {
  id: string;
  wardId: string;
  roomId: string | null;
  code: string;
  displayName: string;
  status: BedStatus;
  active: boolean;
}
export interface QrCode {
  id: string;
  bedId: string;
  status: 'ACTIVE' | 'REVOKED';
  version: number;
  issuedAt: string;
}
export interface QrIssue {
  qrCode: QrCode;
  token: string;
  url: string;
}
export interface BedSession {
  id: string;
  bedId: string;
  status: 'ACTIVE' | 'CLOSED';
  startedAt: string;
  endedAt: string | null;
}
export interface GuestLocation {
  hospitalName: string;
  bed: { code: string; displayName: string };
  room: string | null;
  ward: string;
  floor: string;
  expiresAt: string;
}

export type LocationKind = 'buildings' | 'floors' | 'wards' | 'rooms' | 'beds';

export const staffApi = {
  login: (input: { hospitalCode: string; email: string; password: string }) =>
    call<{ token: string; expiresAt: string }>('POST', '/auth/staff/login', null, input),
  me: (token: string) => call<Me>('GET', '/auth/staff/me', token),
  logout: (token: string) => call<null>('POST', '/auth/staff/logout', token),

  async list<T>(token: string, kind: LocationKind | 'qr-codes' | 'bed-sessions', query = '') {
    const key = kind === 'qr-codes' ? 'qrCodes' : kind === 'bed-sessions' ? 'bedSessions' : kind;
    const body = await call<Record<string, T[]>>('GET', `/admin/${kind}${query}`, token);
    return body[key] ?? [];
  },
  create: (token: string, kind: LocationKind, input: object) =>
    call<unknown>('POST', `/admin/${kind}`, token, input),

  generateQr: (token: string, bedId: string) =>
    call<QrIssue>('POST', `/admin/beds/${bedId}/qr`, token, {}),
  rotateQr: (token: string, bedId: string) =>
    call<QrIssue>('POST', `/admin/beds/${bedId}/qr/rotate`, token, {}),
  revokeQr: (token: string, bedId: string) =>
    call<{ qrCode: QrCode }>('POST', `/admin/beds/${bedId}/qr/revoke`, token, {}),

  startSession: (token: string, bedId: string) =>
    call<{ bedSession: BedSession }>('POST', '/admin/bed-sessions', token, { bedId }),
  closeSession: (token: string, sessionId: string) =>
    call<{ bedSession: BedSession }>('POST', `/admin/bed-sessions/${sessionId}/close`, token, {}),
};

export const guestApi = {
  resolve: (qrToken: string) =>
    call<{ guestToken: string; expiresAt: string; location: GuestLocation }>(
      'POST',
      '/public/qr/resolve',
      null,
      { token: qrToken },
    ),
  session: (guestToken: string) =>
    call<{ location: GuestLocation }>('GET', '/public/session', guestToken),
};
