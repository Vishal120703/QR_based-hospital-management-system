import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from '../content-security-policy';

const directives = (policy: string) =>
  Object.fromEntries(
    policy.split(';').map((part) => {
      const [name = '', ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );

describe('Content Security Policy', () => {
  it('allows only this app and the API it was built for', () => {
    const policy = directives(contentSecurityPolicy('https://careqr-api.onrender.com/'));
    expect(policy['script-src']).toEqual(["'self'"]);
    expect(policy['style-src']).toEqual(["'self'"]);
    expect(policy['connect-src']).toEqual(["'self'", 'https://careqr-api.onrender.com']);
    expect(policy['img-src']).toContain('https://careqr-api.onrender.com');
    expect(policy['default-src']).toEqual(["'self'"]);
    expect(policy['base-uri']).toEqual(["'self'"]);
  });

  it('never allows inline or evaluated code, and adds no API for a same-site /api', () => {
    for (const api of ['https://api.example.test', '/api', undefined]) {
      const text = contentSecurityPolicy(api);
      expect(text).not.toContain('unsafe-inline');
      expect(text).not.toContain('unsafe-eval');
      expect(text).not.toContain('*');
    }
    expect(directives(contentSecurityPolicy('/api'))['connect-src']).toEqual(["'self'"]);
  });
});

describe('Production headers (vercel.json)', () => {
  const config = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as {
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  const everyPage = Object.fromEntries(
    config.headers
      .find((rule) => rule.source === '/(.*)')!
      .headers.map((header) => [header.key, header.value]),
  );

  it('keeps QR links private and the app out of other sites’ frames', () => {
    expect(everyPage['Referrer-Policy']).toBe('no-referrer');
    expect(everyPage['X-Frame-Options']).toBe('DENY');
    expect(everyPage['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(everyPage['X-Content-Type-Options']).toBe('nosniff');
  });

  it('lets only this site use the camera, and nothing else sensitive', () => {
    const permissions = everyPage['Permissions-Policy'] ?? '';
    expect(permissions).toContain('camera=(self)');
    for (const feature of ['microphone', 'geolocation', 'payment']) {
      expect(permissions).toContain(`${feature}=()`);
    }
  });
});
