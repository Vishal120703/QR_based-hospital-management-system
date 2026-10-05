import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/modules/auth/password.js';
import { createSessionToken, hashSessionToken } from '../../src/modules/auth/session-token.js';

describe('staff credentials', () => {
  it('hashes passwords with a random salt and verifies the correct password', async () => {
    const first = await hashPassword('StrongPassword123!');
    const second = await hashPassword('StrongPassword123!');

    expect(first).not.toBe(second);
    expect(await verifyPassword('StrongPassword123!', first)).toBe(true);
    expect(await verifyPassword('wrong-password', first)).toBe(false);
  });

  it('generates unique opaque session tokens and hashes only the stored form', () => {
    const first = createSessionToken();
    const second = createSessionToken();

    expect(first).toHaveLength(43);
    expect(first).not.toBe(second);
    expect(hashSessionToken(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(first)).not.toBe(first);
  });
});
