// The limits the server enforces (services/src/common/validation.ts), so the
// browser catches a mistake before anything is sent.

// Codes such as "GW-A" or "F1": printed on QR labels, unique where they live.
export const codeInput = {
  maxLength: 32,
  pattern: '[A-Za-z0-9][A-Za-z0-9._\\-]*',
  title: 'Use letters, digits, dots, dashes, or underscores, starting with a letter or digit.',
} as const;

// A prefix for numbered beds or rooms ("GW-", "2"); it may be left empty.
export const prefixInput = { ...codeInput, maxLength: 16 } as const;

export const nameMaxLength = 120;
export const emailMaxLength = 320;
export const passwordInput = { minLength: 12, maxLength: 200 } as const;

// Browser limits for a text field, by what it holds.
export function textInputRules(
  name: string,
  type: 'text' | 'email' | 'password' | 'number' = 'text',
): { maxLength?: number; minLength?: number; pattern?: string; title?: string } {
  if (type === 'number') return {};
  if (type === 'email') return { maxLength: emailMaxLength };
  if (type === 'password') return passwordInput;
  return name === 'code' ? codeInput : { maxLength: nameMaxLength };
}

// Hospital and client codes, which staff type when they sign in.
export const hospitalCodeInput = {
  minLength: 2,
  maxLength: 32,
  pattern: '[A-Za-z0-9\\-]+',
  title: 'Use letters, digits, or dashes.',
} as const;

// Patterns are checked with the browser's "v" flag, where ( ) and - must be
// escaped inside [ ]; an invalid pattern would be silently ignored.
export const phoneInput = {
  minLength: 3,
  maxLength: 40,
  pattern: '[0-9+\\(\\)\\-. ]+',
  title: 'Use digits, spaces, and + ( ) - .',
} as const;
