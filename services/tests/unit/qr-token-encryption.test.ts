import { randomBytes } from 'node:crypto';
import { type BedQrCode } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  decodeQrTokenEncryptionKey,
  decryptQrToken,
  encryptQrToken,
} from '../../src/common/qr-token-encryption.js';
import { QrTokenCodec } from '../../src/modules/qr/qr-code.js';

describe('QR token encryption', () => {
  it('recovers a token only with the configured key', () => {
    const key = randomBytes(32);
    const token = randomBytes(32).toString('base64url');
    const encrypted = encryptQrToken(token, key);

    expect(encrypted).not.toContain(token);
    expect(decryptQrToken(encrypted, key)).toBe(token);
    expect(() => decryptQrToken(encrypted, randomBytes(32))).toThrow();
  });

  it('uses a new authenticated ciphertext each time and rejects tampering', () => {
    const key = randomBytes(32);
    const first = encryptQrToken('same-token', key);
    const second = encryptQrToken('same-token', key);

    expect(first).not.toBe(second);
    const parts = first.split('.');
    const tag = parts[2]!;
    parts[2] = `${tag.startsWith('A') ? 'B' : 'A'}${tag.slice(1)}`;
    expect(() => decryptQrToken(parts.join('.'), key)).toThrow();
  });

  it('accepts only Base64 keys containing exactly 32 bytes', () => {
    const key = randomBytes(32);
    expect(decodeQrTokenEncryptionKey(key.toString('base64'))).toEqual(key);
    expect(decodeQrTokenEncryptionKey(key.toString('base64url'))).toEqual(key);
    expect(decodeQrTokenEncryptionKey(randomBytes(31).toString('base64'))).toBeNull();
    expect(decodeQrTokenEncryptionKey('not base64!')).toBeNull();
  });

  it('keeps QR storage and public issue formatting behind one codec', () => {
    const codec = new QrTokenCodec('https://patient.example', randomBytes(32));
    const created = codec.create();
    const now = new Date();
    const qrCode: BedQrCode = {
      id: 'qr',
      hospitalId: 'hospital',
      bedId: 'bed',
      tokenHash: created.stored.tokenHash,
      tokenCiphertext: created.stored.tokenCiphertext,
      status: 'ACTIVE',
      version: 1,
      issuedAt: now,
      rotatedAt: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    expect(codec.recover(qrCode)).toBe(created.token);
    expect(codec.toIssue(qrCode, created.token)).toMatchObject({
      token: created.token,
      url: `https://patient.example/q/${created.token}`,
      qrCode: { id: 'qr', printable: true },
    });
    expect(codec.toIssue(qrCode, created.token).qrCode).not.toHaveProperty('tokenHash');
    expect(codec.toIssue(qrCode, created.token).qrCode).not.toHaveProperty('tokenCiphertext');
  });
});
