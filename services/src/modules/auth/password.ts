import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(32);
  const hash = await derive(password, salt);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt' || !parts[1] || !parts[2]) {
    return false;
  }

  const salt = Buffer.from(parts[1], 'base64url');
  const expected = Buffer.from(parts[2], 'base64url');
  if (salt.length !== 32 || expected.length !== 64) {
    return false;
  }

  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | undefined;

// Checks a password even when the account does not exist, against a throwaway
// hash, so a failed sign-in takes the same time either way and does not reveal
// which hospital codes or emails are real.
export async function verifyPasswordOrDummy(
  password: string,
  stored: string | undefined,
): Promise<boolean> {
  dummyHash ??= hashPassword('not-a-real-password-for-timing-only');
  const valid = await verifyPassword(password, stored ?? (await dummyHash));
  return stored !== undefined && valid;
}
