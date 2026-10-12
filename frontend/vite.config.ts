import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { type Plugin, type ProxyOptions } from 'vite';
import { defineConfig } from 'vitest/config';
import { contentSecurityPolicy } from './content-security-policy';

// The browser only talks to this app's origin; /api is forwarded to the
// backend, as the production reverse proxy will do.
const apiProxy: Record<string, ProxyOptions> = {
  '/api': {
    target: 'http://localhost:3001',
    rewrite: (path) => path.replace(/^\/api/, ''),
  },
};

function contentSecurityPolicyPlugin(): Plugin {
  let apiUrl: string | undefined;
  return {
    name: 'careqr-content-security-policy',
    apply: 'build',
    configResolved(config) {
      apiUrl = config.env.VITE_API_URL as string | undefined;
    },
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy(apiUrl) },
        injectTo: 'head-prepend',
      },
    ],
  };
}

// `vite preview` sends the same headers as Vercel (vercel.json), so local and
// end-to-end checks see what production sends.
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const productionHeaders = Object.fromEntries(
  vercel.headers
    .filter((rule) => rule.source === '/(.*)')
    .flatMap((rule) => rule.headers.map((header) => [header.key, header.value])),
);

export default defineConfig({
  plugins: [react(), contentSecurityPolicyPlugin()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy, headers: productionHeaders },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
});
