import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  codeSchema,
  emailSchema,
  nameSchema,
  newPasswordSchema,
  rangeInOrder,
  rangeInOrderMessage,
} from '../../src/common/validation.js';
import { describeValidationError } from '../../src/common/validation-errors.js';

function messageFor(schema: z.ZodTypeAny, input: unknown) {
  const result = schema.safeParse(input);
  if (result.success) throw new Error('Expected the input to be rejected.');
  return describeValidationError(result.error);
}

describe('validation messages', () => {
  const staff = z
    .object({ displayName: nameSchema, email: emailSchema, password: newPasswordSchema })
    .strict();

  it('names the field and says what is wrong in plain words', () => {
    expect(messageFor(staff, { email: 'a@b.co', password: 'x'.repeat(12) })).toEqual({
      message: 'Display name is required.',
      fields: ['displayName'],
    });
    expect(
      messageFor(staff, { displayName: 'Asha', email: 'nope', password: 'x'.repeat(12) }).message,
    ).toBe('Email must be a valid email address.');
    expect(
      messageFor(staff, { displayName: 'Asha', email: 'a@b.co', password: 'short' }).message,
    ).toBe('Password must be at least 12 characters.');
    expect(
      messageFor(staff, { displayName: 'Asha', email: 'a@b.co', password: 'x'.repeat(12), x: 1 })
        .message,
    ).toBe('Unknown field: x.');
  });

  it('lists every field that needs attention', () => {
    expect(messageFor(staff, {}).fields).toEqual(['displayName', 'email', 'password']);
  });

  it('describes enums, numbers, array items, and a body that is not an object', () => {
    const levels = z.object({
      levels: z.array(z.object({ afterMinutes: z.number().int().max(1440) })),
      status: z.enum(['ACTIVE', 'SUSPENDED']),
    });
    expect(messageFor(levels, { levels: [], status: 'GONE' }).message).toBe(
      'Status must be one of: ACTIVE, SUSPENDED.',
    );
    expect(
      messageFor(levels, {
        levels: [{ afterMinutes: 5 }, { afterMinutes: 9999 }],
        status: 'ACTIVE',
      }).message,
    ).toBe('After minutes (item 2) must be at most 1440.');
    expect(messageFor(levels, []).message).toBe('Send the details as a JSON object.');
  });

  it('keeps messages written in a schema', () => {
    const range = z
      .object({ from: z.coerce.date(), to: z.coerce.date() })
      .refine(rangeInOrder, rangeInOrderMessage);
    expect(messageFor(range, { from: '2026-10-10', to: '2026-01-01' }).message).toBe(
      'The start must be before the end.',
    );
  });
});

describe('shared field rules', () => {
  it('rejects control characters in names, which would break labels and CSV files', () => {
    expect(nameSchema.parse('  Bed A 01  ')).toBe('Bed A 01');
    expect(nameSchema.safeParse('Bed\nA 01').success).toBe(false);
    expect(nameSchema.safeParse('Bed\u0000').success).toBe(false);
    expect(nameSchema.parse('बिस्तर ०१')).toBe('बिस्तर ०१');
  });

  it('normalises emails and codes', () => {
    expect(emailSchema.parse('  Asha@Hospital.ORG ')).toBe('asha@hospital.org');
    expect(codeSchema.parse('gw-a')).toBe('GW-A');
    expect(codeSchema.safeParse('-GW').success).toBe(false);
    expect(codeSchema.safeParse('G W').success).toBe(false);
  });

  it('bounds new passwords', () => {
    expect(newPasswordSchema.safeParse('x'.repeat(11)).success).toBe(false);
    expect(newPasswordSchema.safeParse('x'.repeat(12)).success).toBe(true);
    expect(newPasswordSchema.safeParse('x'.repeat(201)).success).toBe(false);
  });
});
