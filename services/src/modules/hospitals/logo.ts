import { randomUUID } from 'node:crypto';
import { type Prisma } from '@prisma/client';
import { InvalidInputError } from '../../common/errors/app-error.js';
import { HospitalRepository } from './hospital.repository.js';

export const maxLogoBytes = 1024 * 1024;

export type LogoContentType = 'image/png' | 'image/jpeg' | 'image/webp';

// The type is taken from the file's own signature, never from the upload's
// declared Content-Type. SVG is refused because it can carry script.
export function detectLogoType(bytes: Uint8Array): LogoContentType | null {
  const starts = (...signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function logoUrl(publicId: string | null | undefined): string | null {
  return publicId ? `/public/logos/${publicId}` : null;
}

// Validates and stores a hospital logo inside the caller's transaction. A new
// publicId on every upload retires the old URL.
export async function storeLogo(
  transaction: Prisma.TransactionClient,
  hospitalId: string,
  bytes: Uint8Array,
): Promise<{ publicId: string; contentType: LogoContentType; byteSize: number }> {
  const contentType = detectLogoType(bytes);
  if (!contentType || bytes.length === 0 || bytes.length > maxLogoBytes) {
    throw new InvalidInputError('Upload a PNG, JPEG, or WebP image of up to 1 MB.');
  }
  const data = Buffer.from(bytes);
  const values = { publicId: randomUUID(), contentType, data, byteSize: data.length };
  await new HospitalRepository().upsertLogo(transaction, hospitalId, values);
  return { publicId: values.publicId, contentType, byteSize: values.byteSize };
}

// Removes a hospital's logo inside the caller's transaction. Returns false
// when the hospital had no logo.
export async function removeLogo(
  transaction: Prisma.TransactionClient,
  hospitalId: string,
): Promise<boolean> {
  return (await new HospitalRepository().deleteLogo(transaction, hospitalId)) > 0;
}
