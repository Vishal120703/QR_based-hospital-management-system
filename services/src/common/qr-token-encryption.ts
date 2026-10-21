import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const algorithm = 'aes-256-gcm';
const version = 'v1';
const ivBytes = 12;
const authenticationContext = Buffer.from('care-qr:bed-qr-token:v1');

// Used only by direct app construction in development and tests. Production
// startup requires QR_TOKEN_ENCRYPTION_KEY and never uses this known key.
export const developmentQrTokenEncryptionKey = Buffer.from(
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  'hex',
);

export function decodeQrTokenEncryptionKey(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  const key = Buffer.from(value, 'base64');
  return key.length === 32 ? key : null;
}

// The hash remains the lookup credential. This encrypted copy exists only so
// an authorized hospital manager can reopen and print the same active label.
export function encryptQrToken(token: string, key: Buffer): string {
  const iv = randomBytes(ivBytes);
  const cipher = createCipheriv(algorithm, key, iv);
  cipher.setAAD(authenticationContext);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [
    version,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptQrToken(value: string, key: Buffer): string {
  const [storedVersion, encodedIv, encodedTag, encodedToken, ...rest] = value.split('.');
  if (storedVersion !== version || !encodedIv || !encodedTag || !encodedToken || rest.length > 0) {
    throw new Error('Invalid encrypted QR token.');
  }
  const decipher = createDecipheriv(algorithm, key, Buffer.from(encodedIv, 'base64url'));
  decipher.setAAD(authenticationContext);
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedToken, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
