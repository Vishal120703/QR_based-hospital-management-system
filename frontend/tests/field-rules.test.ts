import { describe, expect, it } from 'vitest';
import {
  codeInput,
  hospitalCodeInput,
  phoneInput,
  prefixInput,
  textInputRules,
} from '../src/lib/field-rules';

// Browsers check `pattern` as a whole-value match with the "v" flag, and
// silently skip a pattern that does not compile, so test exactly that.
function accepts(pattern: string, value: string) {
  return new RegExp(`^(?:${pattern})$`, 'v').test(value);
}

describe('Form field rules', () => {
  it('uses patterns that browsers can compile', () => {
    for (const rule of [codeInput, prefixInput, hospitalCodeInput, phoneInput]) {
      expect(() => new RegExp(`^(?:${rule.pattern})$`, 'v')).not.toThrow();
    }
  });

  it('accepts what the server accepts and refuses the rest', () => {
    expect(accepts(codeInput.pattern, 'GW-A.1_b')).toBe(true);
    expect(accepts(codeInput.pattern, '-GW')).toBe(false);
    expect(accepts(codeInput.pattern, 'G W')).toBe(false);
    expect(accepts(hospitalCodeInput.pattern, 'CAREQR-DEMO')).toBe(true);
    expect(accepts(hospitalCodeInput.pattern, 'CARE QR')).toBe(false);
    expect(accepts(phoneInput.pattern, '+91 (80) 4000-1000')).toBe(true);
    expect(accepts(phoneInput.pattern, 'call me')).toBe(false);
  });

  it('gives each kind of field the server’s length limits', () => {
    expect(textInputRules('code')).toMatchObject({ maxLength: 32 });
    expect(textInputRules('name')).toEqual({ maxLength: 120 });
    expect(textInputRules('email', 'email')).toEqual({ maxLength: 320 });
    expect(textInputRules('password', 'password')).toEqual({ minLength: 12, maxLength: 200 });
    expect(textInputRules('level', 'number')).toEqual({});
  });
});
