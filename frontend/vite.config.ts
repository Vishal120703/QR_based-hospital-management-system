import react from '@vitejs/plugin-react';
import { type ProxyOptions } from 'vite';
import { defineConfig } from 'vitest/config';

// The browser only talks to this app's origin; /api is forwarded to the
// backend, as the production reverse proxy will do.
const apiProxy: Record<string, ProxyOptions> = {
  '/api': {
    target: 'http://localhost:3001',
    rewrite: (path) => path.replace(/^\/api/, ''),
  },
};

export default defineConfig({
  plugins: [react()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
});
