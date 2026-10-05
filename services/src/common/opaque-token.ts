import { createHash, randomBytes } from 'node:crypto';

// 256-bit random bearer secret, base64url encoded (43 characters).
// Used for staff sessions, QR codes, and guest sessions.
export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

// Only this hash is stored; the raw token is never persisted or logged.
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
